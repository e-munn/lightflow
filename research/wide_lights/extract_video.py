"""Tracked, confidence-bearing stage observations from immutable wide-shot sources."""
from pathlib import Path
import argparse,json,subprocess,time
import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from pixels import observe

W,H=640,360


def scaled(box):return tuple(round(x*2/3) for x in box)


def read_frame(source,second):
    raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(second),'-i',source,'-frames:v','1','-vf',f'scale={W}:{H}','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
    return np.frombuffer(raw,np.uint8).reshape(H,W,3).copy()


class Geometry:
    def __init__(self,reference,config):
        self.sift=cv2.SIFT_create(nfeatures=600);self.matcher=cv2.BFMatcher()
        self.mask=np.zeros((H,W),np.uint8)
        x0,y0,x1,y1=scaled(config['tracking_box']);self.mask[y0:y1,x0:x1]=255
        # Prefer the surrounding structure over the changing light regions.
        a,b,c,d=scaled(config['stage_box']);self.mask[b:d,a:c]=0
        self.key,self.des=self.sift.detectAndCompute(cv2.cvtColor(reference,cv2.COLOR_RGB2GRAY),self.mask)
        if self.des is None:raise ValueError('No reference geometry descriptors')
    def match(self,frame):
        key,des=self.sift.detectAndCompute(cv2.cvtColor(frame,cv2.COLOR_RGB2GRAY),self.mask)
        if des is None:return None,0
        pairs=self.matcher.knnMatch(self.des,des,k=2)
        good=[a for pair in pairs if len(pair)==2 for a,b in [pair] if a.distance<.7*b.distance]
        if len(good)<6:return None,len(good)
        ref=np.float32([self.key[a.queryIdx].pt for a in good]);now=np.float32([key[a.trainIdx].pt for a in good])
        matrix,inliers=cv2.estimateAffinePartial2D(now,ref,method=cv2.RANSAC,ransacReprojThreshold=2.5)
        count=int(inliers.sum()) if inliers is not None else 0
        if matrix is None or count<6:return None,count
        scale=float(np.hypot(matrix[0,0],matrix[0,1]));angle=float(np.degrees(np.arctan2(matrix[1,0],matrix[0,0])))
        points=ref[inliers[:,0]>0]
        if not (.85<scale<1.18 and abs(angle)<8 and max(abs(matrix[:,2]))<W*.15 and np.ptp(points[:,0])>60):return None,count
        return matrix.astype(np.float32),count


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--show',required=True);ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
    catalog=json.loads(Path(__file__).with_name('sources.json').read_text());cfg=catalog['sources'][args.show]
    args.out.mkdir(parents=True,exist_ok=False)
    reference=read_frame(cfg['source'],cfg['reference_second']);tracker=Geometry(reference,cfg)
    x0,y0,x1,y1=scaled(cfg['stage_box']);edges=np.linspace(x0,x1,5).round().astype(int)
    masks=[]
    for a,b in zip(edges[:-1],edges[1:]):
        mask=np.zeros((H,W),bool);mask[y0:y1,a:b]=True
        for box in cfg['exclude']:
            e,f,g,h=scaled(box);mask[f:h,e:g]=False
        masks.append(mask)
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16)
    sheet=Image.new('RGB',(1280,len(cfg['starts'])*4*205),(10,16,19));draw=ImageDraw.Draw(sheet);review_row=0
    records=[];started=time.monotonic()
    for start in cfg['starts']:
        process=subprocess.Popen(['ffmpeg','-v','error','-threads','2','-ss',str(start),'-i',cfg['source'],'-t',str(catalog['duration_per_clip']),'-vf',f'fps={catalog["fps"]},scale={W}:{H}','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE)
        times=[];targets=[];weights=[];extras=[];transforms=[];inliers=[];last=None;last_at=-100;frame_index=0
        try:
            while True:
                raw=process.stdout.read(W*H*3)
                if not raw:break
                frame=np.frombuffer(raw,np.uint8).reshape(H,W,3)
                if frame_index%10==0:
                    matrix,count=tracker.match(frame)
                    if matrix is not None:last,last_at=matrix,frame_index
                geometry_ok=last is not None and frame_index-last_at<=10
                aligned=cv2.warpAffine(frame,last,(W,H)) if last is not None else frame
                values=[observe(aligned[m]) for m in masks]
                peak=[v['p99_luma'] for v in values];coverage=[v['lit_coverage'] for v in values];energy=[v['intensity'] for v in values]
                color_weights=np.array([v['color_valid']*v['intensity'] for v in values]);total=float(color_weights.sum())
                chroma=np.average([v['chroma'] for v in values],axis=0,weights=color_weights) if total>.02 else np.ones(3)/3
                color_ok=total>.02
                target=peak+coverage+energy+chroma.tolist();weight=[float(geometry_ok)]*12+[float(geometry_ok and color_ok)]*3
                times.append(start+frame_index/catalog['fps']);targets.append(target);weights.append(weight)
                extras.append([[v['clipped_pixel_fraction'],v['color_support'],v['color_valid']] for v in values]);transforms.append(last.tolist() if last is not None else [[1,0,0],[0,1,0]]);inliers.append(count if frame_index%10==0 else inliers[-1])
                if frame_index in [0,600,1200,1800]:
                    small=Image.fromarray(aligned).resize((640,360));d=ImageDraw.Draw(small)
                    for a,b in zip(edges[:-1],edges[1:]):d.rectangle((int(a),y0,int(b),y1),outline=(141,242,202),width=2)
                    for box in cfg['exclude']:d.rectangle(scaled(box),outline=(255,173,102),width=2)
                    # 2x smaller source and enlarged observation strip per row.
                    draw.text((8,review_row*205+4),f'{args.show} {start+frame_index/catalog["fps"]:.1f}s / geometry valid {geometry_ok} / matches {inliers[-1]}',font=font,fill='white')
                    sheet.paste(small.resize((320,180)),(0,review_row*205+25))
                    for j,v in enumerate(values):
                        for k,(field,label) in enumerate([('top_rgb','peak'),('area_rgb','area'),('intensity_color_rgb','color')]):
                            x=340+k*312+j*75;y=review_row*205+45
                            draw.rectangle((x,y,x+67,y+105),fill=tuple(int(255*np.clip(c,0,1)) for c in v[field]))
                            if j==0:draw.text((x,y+115),label,font=font,fill=(176,198,189))
                    review_row+=1
                frame_index+=1
            process.stdout.close();assert process.wait()==0
        finally:
            if process.poll() is None:process.terminate();process.wait()
        with (args.out/f'{start:04d}.npz').open('xb') as f:np.savez_compressed(f,time=np.array(times),target=np.array(targets,np.float32),weight=np.array(weights,np.float32),quality=np.array(extras,np.float32),transform=np.array(transforms,np.float32),inliers=np.array(inliers))
        summary={'start':start,'frames':len(times),'geometry_valid_fraction':float(np.mean(np.array(weights)[:,0])),'color_valid_fraction':float(np.mean(np.array(weights)[:,-1]))}
        records.append(summary);print(args.show,summary,'wall',round(time.monotonic()-started,1),flush=True)
    with (args.out/'review.jpg').open('xb') as f:sheet.save(f,format='JPEG',quality=92)
    with (args.out/'reference.png').open('xb') as f:Image.fromarray(reference).save(f,format='PNG')
    with (args.out/'manifest.json').open('x') as f:json.dump({'source_config':cfg,'clips':records,'fps':catalog['fps'],'targets':['peak_0','peak_1','peak_2','peak_3','coverage_0','coverage_1','coverage_2','coverage_3','energy_0','energy_1','energy_2','energy_3','chroma_r','chroma_g','chroma_b'],'target_provenance':'Observed image controls, not desk commands. Registration and color masks encode partial uncertainty; exposure and audio/light delay unresolved.','review_status':'pending sampled source/target review before experiment admission'},f,indent=2)
    print('COMPLETE',args.out,flush=True)


if __name__=='__main__':main()
