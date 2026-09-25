"""Compare immutable pose runs and make exact-frame before/after review sheets."""
import argparse
import json
import math
from pathlib import Path
import tempfile
import av
from PIL import Image, ImageDraw
from tracking import BODY, CORE, usable_pose

ROOT = Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs')
BONES = ((11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),(23,24),(23,25),(25,27),(24,26),(26,28),(27,29),(29,31),(28,30),(30,32))


def frames(run):
    return [f for p in sorted((ROOT/run/'frames').glob('*.json')) for f in json.loads(p.read_text())]


def point_valid(p):
    return p[3] >= .5 and all(math.isfinite(v) and 0 <= v <= 1 for v in p[:2])


def primary(f):
    return f['poses'][f['primary']] if f['primary'] is not None else None


def summarize(ff):
    n = len(ff)
    joint_coverage = {str(j): sum(primary(f) is not None and point_valid(primary(f)[j]) for f in ff)/n for j in BODY}
    groups = {name: sum(primary(f) is not None and all(point_valid(primary(f)[j]) for j in joints) for f in ff)/n
              for name,joints in [('arms',(11,12,13,14,15,16)),('legs',(23,24,25,26,27,28)),('body',BODY)]}
    return {'frames':n,'coverage':groups,'jointCoverage':joint_coverage,
            'multipleBodyFrames':sum(len(f['poses'])>1 for f in ff),
            'unassignedFrames':sum(f['primary'] is None for f in ff),
            'cutFlags':sum(f['cut'] for f in ff)}


def good_count(f):
    p=primary(f)
    return sum(point_valid(p[j]) for j in BODY) if p else 0


def difference(a,b,aspect):
    p,q=primary(a),primary(b)
    if not p or not q:
        return 0
    distances=[math.hypot((p[j][0]-q[j][0])*aspect,p[j][1]-q[j][1]) for j in BODY if point_valid(p[j]) and point_valid(q[j])]
    return sum(distances)/max(1,len(distances))


def panel(image,frame,label,color):
    im=image.copy();im.thumbnail((640,360))
    out=Image.new('RGB',(640,390),'#101510');out.paste(im,((640-im.width)//2,30+(360-im.height)//2))
    d=ImageDraw.Draw(out);dx=(640-im.width)//2;dy=30+(360-im.height)//2
    d.text((10,8),f'{label} | {frame["t"]:.3f}s | {len(frame["poses"])} bodies | {good_count(frame)}/12 usable joints',fill='white')
    for i,p in enumerate(frame['poses']):
        c=color if i==frame['primary'] else '#e9b85e'
        for a,b in BONES:
            if point_valid(p[a]) and point_valid(p[b]):
                d.line((dx+p[a][0]*im.width,dy+p[a][1]*im.height,dx+p[b][0]*im.width,dy+p[b][1]*im.height),fill=c,width=2)
        for j in BODY:
            if not all(0<=v<=1 for v in p[j][:2]):continue
            x,y=dx+p[j][0]*im.width,dy+p[j][1]*im.height
            d.ellipse((x-3,y-3,x+3,y+3),fill=c if point_valid(p[j]) else '#ff5050')
    return out


def main():
    parser=argparse.ArgumentParser();parser.add_argument('report');parser.add_argument('--label',choices=['Heavy','RTMW'],default='Heavy');args=parser.parse_args()
    report=json.loads(Path(args.report).read_text());study=Path(report['studyDirectory'])
    folder=Path(tempfile.mkdtemp(prefix='review-',dir=study));rows=[]
    for item in report['rows']:
        if item['exitCode']!=0:continue
        a,b=frames(item['baseline']),frames(item['candidate'])
        if len(a)!=len(b) or any((x['t'],x['index'])!=(y['t'],y['index']) for x,y in zip(a,b)):
            raise ValueError('Frame timestamps differ')
        with av.open(str(ROOT/item['baseline']/'preview.mp4')) as c:
            s=c.streams.video[0];aspect=s.width/s.height
        uniform=[round((len(a)-1)*(i+1)/5) for i in range(4)]
        ranked=sorted(range(len(a)),key=lambda i:(good_count(b[i])-good_count(a[i]),difference(a[i],b[i],aspect)),reverse=True)
        diagnostic=[]
        for i in ranked:
            if all(abs(a[i]['t']-a[j]['t'])>2 for j in diagnostic):diagnostic.append(i)
            if len(diagnostic)==4:break
        wanted=set(uniform+diagnostic);images={}
        with av.open(str(ROOT/item['baseline']/'preview.mp4')) as c:
            for i,f in enumerate(c.decode(video=0)):
                if i in wanted:images[i]=f.to_image()
        sheets={}
        for name,indices in [('uniform',uniform),('diagnostic',sorted(diagnostic))]:
            sheet=Image.new('RGB',(1280,1590),'#101510');d=ImageDraw.Draw(sheet)
            d.text((10,8),item['title']+' | '+name+' sampled frames; confidence/coverage is not joint-location accuracy',fill='white')
            for row,i in enumerate(indices):
                sheet.paste(panel(images[i],a[i],'FULL','#b7bfce'),(0,30+390*row))
                sheet.paste(panel(images[i],b[i],args.label.upper(),'#a2f4c3'),(640,30+390*row))
            path=folder/(item['candidate']+'-'+name+'.jpg')
            with path.open('xb') as f:sheet.save(f,format='JPEG',quality=95)
            sheets[name]=str(path)
        row={'title':item['title'],'baseline':item['baseline'],'candidate':item['candidate'],'reason':item['reason'],
             'before':summarize(a),'after':summarize(b),'timestampsIdentical':True,
             'uniformSamples':[{'index':i,'t':a[i]['t']} for i in uniform],
             'diagnosticSamples':[{'index':i,'t':a[i]['t'],'usableJointsBefore':good_count(a[i]),'usableJointsAfter':good_count(b[i])} for i in sorted(diagnostic)],
             'sheets':sheets,'model':item['candidateResult']['poseModel'],'candidateLabel':args.label,'extractionSeconds':item['candidateResult']['extractionSeconds']}
        rows.append(row)
        print(json.dumps({'title':row['title'],'before':row['before']['coverage'],'after':row['after']['coverage'],'sheets':sheets}),flush=True)
    output={'benchmark':str(Path(args.report).resolve()),'method':'Identical media, timestamps and identity policy. No added smoothing. Coverage measures confidence and in-frame positions, not anatomical accuracy. RTMW and MediaPipe confidence scales differ. Uniform samples and deliberately selected difficult/disagreement samples are separate; neither is full-span review.','rows':rows}
    with (folder/'quality.json').open('x') as f:json.dump(output,f,indent=2)
    target=Path(__file__).with_name(('rtmw-quality-study-' if args.label=='RTMW' else 'pose-quality-study-')+'2026-09-23.json')
    with target.open('x') as f:json.dump(output,f,indent=2)
    print(json.dumps({'report':str(target),'review':str(folder)}),flush=True)

if __name__=='__main__':main()
