"""Offline appearance decomposition for review, not causal model input or labels."""
from pathlib import Path
import argparse,json,hashlib
import numpy as np
import cv2
from PIL import Image,ImageDraw,ImageFont
from native_frames import frames,source_timestamps

def decompose(luma):
    base=np.quantile(luma,.2,axis=0).astype(np.float32)
    plus=np.maximum(luma-base,0);minus=np.maximum(base-luma,0)
    change=np.zeros_like(luma);change[1:]=np.abs(np.diff(luma,axis=0))
    return base,plus,minus,change

def summarize(luma,base,plus,change,mask):
    assert mask.any()
    yy,xx=np.where(mask);w=plus[:,mask];mass=w.sum(1);valid=mass>1e-8
    cx=np.divide(w@xx,max(1,luma.shape[2]-1)*mass,out=np.zeros(len(w)),where=valid)
    cy=np.divide(w@yy,max(1,luma.shape[1]-1)*mass,out=np.zeros(len(w)),where=valid)
    return dict(mean_luma=luma[:,mask].mean(1),persistent_mean=np.full(len(w),base[mask].mean()),excess_mean=w.mean(1),excess_fraction=(w>.08).mean(1),pixel_change=change[:,mask].mean(1),pixel_change_valid=np.arange(len(w))>0,centroid_x=cx,centroid_y=cy,centroid_valid=valid)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=False)
    root=Path('/Volumes/ExtremePro/Code/lightflow/research');review=json.loads((root/'native_cues/structure_review_v1/candidates.json').read_text());sources=json.loads(Path('research/wide_lights/sources.json').read_text())['sources'];font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16);reports=[]
    for item in review['selected']:
        key=item['clip'];show,starttext=key.rsplit('_',1);cfg=sources[show];start=item['start'];basegeom=np.load(root/'wide_lights/dataset_v1'/show/(starttext+'.npz'));labels=np.load(root/'native_cues/dataset_v1'/(key+'.npz'));mask=labels['masks'][0].any(0);images=[];times=[]
        for t,pts,tb,rgb in frames(cfg['source'],start,8):
            ix=int(np.floor((t-int(starttext))*10+1e-6));images.append(cv2.warpAffine(rgb,basegeom['transform'][ix],(640,360)));times.append(t)
        rgb=np.array(images);times=np.array(times);expected=source_timestamps(cfg['source'],start,8);assert len(times)==len(expected) and np.max(abs(times-expected))<1e-6
        lum=(rgb.astype(np.float32)/255)@np.array([.2126,.7152,.0722],np.float32);base,plus,minus,change=decompose(lum);err=float(np.max(abs(lum-(base+plus-minus))));assert err<1e-6
        # Broader context explicitly includes screens/structure; not a fixture target.
        context=np.zeros_like(mask);x0,y0,x1,y1=[round(v*2/3) for v in cfg['tracking_box']];context[y0:y1,x0:x1]=True;context&=~mask
        fields={name:summarize(lum,base,plus,change,m) for name,m in [('measured',mask),('scene_context',context)]}
        stem=key+'_'+str(int(start));
        with (a.out/(stem+'.npz')).open('xb') as f:np.savez_compressed(f,time=times,persistent_luma=base,measured_mask=mask,context_mask=context,**{name+'_'+k:v for name,values in fields.items() for k,v in values.items()})
        sheet=Image.new('RGB',(1280,3*215),(9,14,19));draw=ImageDraw.Draw(sheet)
        for row,offset in enumerate([0,3.5,7]):
            ix=int(np.searchsorted(times,start+offset));panels=[rgb[ix],np.repeat(base[:,:,None],3,axis=2)*255,np.repeat(np.clip(plus[ix]*3,0,1)[:,:,None],3,axis=2)*255,np.repeat(np.clip(change[ix]*5,0,1)[:,:,None],3,axis=2)*255]
            for col,(name,img) in enumerate(zip(['Source','Persistent 20%','Excess x3','Change x5'],panels)):
                arr=np.asarray(img,dtype=np.uint8).copy();contours,_=cv2.findContours(mask.astype('uint8'),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE);cv2.drawContours(arr,contours,-1,(90,255,120),1)
                sheet.paste(Image.fromarray(arr).resize((320,180)),(col*320,row*215+35));draw.text((col*320+3,row*215+2),f'{name} | {times[ix]:.2f}s',font=font,fill='white')
        with (a.out/(stem+'.jpg')).open('xb') as f:sheet.save(f,format='JPEG',quality=93)
        summary={}
        for name,v in fields.items():
            summary[name]={k:float(np.mean(v[k])) for k in ['mean_luma','persistent_mean','excess_mean','excess_fraction','pixel_change']}
            summary[name]['pixel_change']=float(v['pixel_change'][1:].mean())
            summary[name]['absolute_global_mean_change']=float(np.abs(np.diff(v['mean_luma'])).mean())
            summary[name]['early_excess']=float(v['excess_mean'][times<start+2].mean());summary[name]['late_excess']=float(v['excess_mean'][times>=start+6].mean())
        reports.append(dict(clip=key,start=start,frames=len(times),pts_max_error=float(np.max(abs(times-expected))),reconstruction_max_error=err,summary=summary,training_admitted=False));print(stem,summary,flush=True)
    with (a.out/'report.json').open('x') as f:json.dump(dict(clips=reports,code_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),semantics='Per-pixel temporal appearance, not fixture/background separation. Quantile uses entire 8s clip, offline review only. Context includes screens and structure. No human intent labels.'),f,indent=2)
if __name__=='__main__':main()
