"""Inspect exact decoded pose frames, including difficult frames; never certify identity."""
import argparse
import json
from pathlib import Path
import tempfile
import av
from PIL import Image, ImageDraw

BONES=((11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),(23,24),(23,25),(25,27),(24,26),(26,28))
BODY=(11,12,13,14,15,16,23,24,25,26,27,28)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('runs',nargs='+');args=parser.parse_args()
    root=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs')
    for run_id in args.runs:
        run=root/run_id
        frames=[f for p in sorted((run/'frames').glob('*.json')) for f in json.loads(p.read_text())]
        selected=list(dict.fromkeys(round((len(frames)-1)*i/8) for i in range(9)))
        def score(f):
            return min(f['poses'][f['primary']][j][3] for j in BODY) if f['primary'] is not None else -1
        difficult=[]
        for f in sorted(frames,key=score):
            if all(abs(f['t']-frames[i]['t'])>1.5 for i in difficult): difficult.append(f['index'])
            if len(difficult)==9: break
        wanted=set(selected+difficult);images={}
        with av.open(str(run/'preview.mp4')) as c:
            for i,decoded in enumerate(c.decode(video=0)):
                if i not in wanted: continue
                im=decoded.to_image(); im.thumbnail((320,180))
                d=ImageDraw.Draw(im)
                f=frames[i]
                for k,pose in enumerate(f['poses']):
                    color='#99ff55' if k==f['primary'] else '#ffb455'
                    for a,b in BONES:
                        if min(pose[a][3],pose[b][3])>=.5:
                            d.line((pose[a][0]*im.width,pose[a][1]*im.height,pose[b][0]*im.width,pose[b][1]*im.height),fill=color,width=2)
                    for j in BODY:
                        x,y=pose[j][0]*im.width,pose[j][1]*im.height
                        d.ellipse((x-2,y-2,x+2,y+2),fill=color if pose[j][3]>=.5 else '#ff3344')
                d.rectangle((0,0,320,18),fill='black');d.text((4,3),f"{f['t']:.3f}s #{i} | {len(f['poses'])} bodies | usable {f.get('poseUsable')}",fill='white')
                images[i]=im
        folder=Path(tempfile.mkdtemp(prefix='sample-review-',dir=run))
        for name,indices in [('uniform',selected),('difficult',sorted(difficult))]:
            sheet=Image.new('RGB',(960,590),'#111611');draw=ImageDraw.Draw(sheet)
            draw.text((5,4),run_id+' | '+name+' exact-frame samples; NOT full-span review',fill='white')
            for n,i in enumerate(indices):sheet.paste(images[i],((n%3)*320,24+(n//3)*187))
            with (folder/(name+'.jpg')).open('xb') as f:sheet.save(f,'JPEG',quality=90)
        low={str(j):sum(f['primary'] is not None and f['poses'][f['primary']][j][3]<.5 for f in frames) for j in BODY}
        audit={'runId':run_id,'reviewMethod':'sampled','uniformFrameIndices':selected,'difficultFrameIndices':sorted(difficult),'lowConfidenceFramesByJoint':low,'identityAccuracy':None}
        with (folder/'sampling.json').open('x') as f:json.dump(audit,f)
        print(json.dumps({'folder':str(folder),'lowConfidenceFramesByJoint':low}),flush=True)


if __name__=='__main__':main()
