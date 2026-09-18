"""Audit local optical-flow bridges against independent reference anchors.

Candidate geometry only. Does not edit previously extracted labels or masks.
"""
from pathlib import Path
import argparse,json,subprocess,time
import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from extract_video import Geometry,read_frame,scaled,W,H

def compose(a,b):return (np.vstack([a,[0,0,1]])@np.vstack([b,[0,0,1]]))[:2].astype(np.float32)

def local_match(previous,current,reference_mask,previous_transform):
    # Express the reference's structure-only mask in the previous image.
    mask=cv2.warpAffine(reference_mask,cv2.invertAffineTransform(previous_transform),(W,H))
    points=cv2.goodFeaturesToTrack(previous,maxCorners=180,qualityLevel=.02,minDistance=8,mask=mask,blockSize=7)
    if points is None or len(points)<16:return None,0
    now,status,error=cv2.calcOpticalFlowPyrLK(previous,current,points,None,winSize=(21,21),maxLevel=3)
    back,back_status,back_error=cv2.calcOpticalFlowPyrLK(current,previous,now,None,winSize=(21,21),maxLevel=3)
    valid=(status[:,0]>0)&(back_status[:,0]>0)&(np.linalg.norm(back-points,axis=2)[:,0]<.6)
    before=points[valid,0];after=now[valid,0]
    if len(before)<12:return None,len(before)
    matrix,inliers=cv2.estimateAffinePartial2D(after,before,method=cv2.RANSAC,ransacReprojThreshold=1.2)
    if matrix is None or inliers is None:return None,0
    inside=inliers[:,0]>0;count=int(inside.sum());p=before[inside]
    if count<12 or count/len(before)<.7 or np.ptp(p[:,0])<80 or np.ptp(p[:,1])<30:return None,count
    scale=np.hypot(matrix[0,0],matrix[0,1]);angle=np.degrees(np.arctan2(matrix[1,0],matrix[0,0]))
    if not (.96<scale<1.04 and abs(angle)<3 and max(abs(matrix[:,2]))<25):return None,count
    return matrix.astype(np.float32),count

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);ap.add_argument('--show',default='levity_forest');ap.add_argument('--start',type=int,default=900);ap.add_argument('--duration',type=int,default=120);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=False);cv2.setNumThreads(2)
    cfg=json.loads(Path(__file__).with_name('sources.json').read_text())['sources'][args.show]
    reference=read_frame(cfg['source'],cfg['reference_second']);geometry=Geometry(reference,cfg)
    a,b,c,d=scaled(cfg['stage_box']);corners=np.array([[a,b,1],[c,b,1],[a,d,1],[c,d,1]]).T
    pipe=subprocess.Popen(['ffmpeg','-v','error','-ss',str(args.start),'-i',cfg['source'],'-t',str(args.duration),'-vf',f'fps=10,scale={W}:{H}','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE)
    previous=None;matrix=None;last_anchor=-999;baseline_anchor=-999;records=[];bracket=[];review=[];began=time.monotonic()
    for index in range(args.duration*10):
        raw=pipe.stdout.read(W*H*3)
        if len(raw)!=W*H*3:raise ValueError('Short tracking decode')
        frame=np.frombuffer(raw,np.uint8).reshape(H,W,3);gray=cv2.cvtColor(frame,cv2.COLOR_RGB2GRAY)
        flow=None;count=0
        if previous is not None and matrix is not None and index-last_anchor<=100:
            flow,count=local_match(previous,gray,geometry.mask,matrix)
        predicted=compose(matrix,flow) if flow is not None else None
        anchor,anchor_count=geometry.match(frame) if index%10==0 else (None,0)
        closure=None;closed=False
        if anchor is not None:
            baseline_anchor=index
            if predicted is not None:closure=float(np.linalg.norm((predicted-anchor)@corners,axis=0).max())
            closed=closure is not None and closure<2
            # A future anchor is used only to audit offline observation geometry,
            # never to build an audio input or a live predictive feature.
            for j in bracket:records[j]['bridge_verified']=bool(closed)
            bracket=[];matrix=anchor;last_anchor=index
        else:
            matrix=predicted
            if matrix is not None:bracket.append(index)
        baseline_valid=index-baseline_anchor<=10
        valid=matrix is not None and index-last_anchor<=100
        records.append({'time':args.start+index/10,'baseline_valid':baseline_valid,'local_candidate':valid,'bridge_verified':anchor is not None,
            'anchor_inliers':anchor_count,'flow_inliers':count,'closure_pixels':closure,'matrix':matrix.tolist() if matrix is not None else None})
        if valid and not baseline_valid and index%10==5 and len(review)<12:
            aligned=cv2.warpAffine(frame,matrix,(W,H));review.append((index,aligned.copy()))
        previous=gray
    pipe.stdout.close();assert pipe.wait()==0
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',17)
    sheet=Image.new('RGB',(960,max(1,(len(review)+2)//3)*210),(9,17,21));draw=ImageDraw.Draw(sheet)
    for k,(index,frame) in enumerate(review):
        img=Image.fromarray(frame);sub=ImageDraw.Draw(img);sub.rectangle((a,b,c,d),outline=(155,236,199),width=2)
        x=k%3*320;y=k//3*210;sheet.paste(img.resize((320,180)),(x,y+28));r=records[index]
        draw.text((x+4,y+4),f'{r["time"]:.1f}s bridge {r["bridge_verified"]}',font=font,fill=(224,237,228))
    with (args.out/'bridges.jpg').open('xb') as f:sheet.save(f,format='JPEG',quality=93)
    baseline=np.array([r['baseline_valid'] for r in records]);candidate=np.array([r['local_candidate'] for r in records]);verified=np.array([r['bridge_verified'] for r in records])
    accepted=baseline|(candidate&verified)
    closure=[r['closure_pixels'] for r in records if r['closure_pixels'] is not None]
    report={'show':args.show,'start':args.start,'duration':args.duration,'baseline_valid_fraction':float(baseline.mean()),
        'local_candidate_fraction':float(candidate.mean()),'baseline_or_verified_bridge_fraction':float(accepted.mean()),
        'recovered_seconds':float((accepted&~baseline).sum()/10),'anchor_closures':len(closure),
        'closure_pixel_quantiles':np.quantile(closure,[.5,.9,.95,1]).tolist() if closure else None,
        'note':'Candidate geometry audit, not accepted labels. Baseline hold rule is retained only for comparison. New bridges need closing anchor agreement <2 pixels. Sampled sheet review required.',
        'elapsed_seconds':time.monotonic()-began}
    with (args.out/'report.json').open('x') as f:json.dump(report,f,indent=2)
    with (args.out/'frames.json').open('x') as f:json.dump(records,f)
    print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__':main()
