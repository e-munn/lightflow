from pathlib import Path
import json, numpy as np
from PIL import Image, ImageDraw, ImageFont
from analyze import features,occupancy
OUT=Path('/Volumes/ExtremePro/Code/lightflow/research/stereo_scope_analysis/9-16-26')
sr=44100;n=882;t=np.arange(n)/sr;rng=np.random.default_rng(20260916)
sine=np.sin(2*np.pi*200*t);noise=rng.normal(size=n)
cases=[('Mono tone',np.column_stack([sine,sine])),('Mono noise',np.column_stack([noise,noise])),('Quadrature tone',np.column_stack([sine,np.cos(2*np.pi*200*t)])),('Independent stereo noise',rng.normal(size=(n,2)))]
font='/System/Library/Fonts/Supplemental/Arial.ttf';f=ImageFont.truetype(font,20);small=ImageFont.truetype(font,15)
image=Image.new('RGB',(1440,420),(7,11,18));draw=ImageDraw.Draw(image);report=[]
for i,(name,a) in enumerate(cases):
 a=a*(.15/np.sqrt(np.mean(a*a)))
 measured=features(a[None],sr);entry={k:float(v[0]) for k,v in measured.items()};entry['name']=name;entry['lit_fraction']=occupancy(a);report.append(entry)
 x=i*360;draw.text((x+16,16),name,font=f,fill=(190,238,223))
 plot=Image.new('RGB',(328,280),(8,16,22));p=ImageDraw.Draw(plot);p.line([(164,0),(164,280)],fill=(32,49,56));p.line([(0,140),(328,140)],fill=(32,49,56))
 coords=np.column_stack([164+a[:,0]*1.5*125,140-a[:,1]*1.5*125]);p.line(list(map(tuple,coords.tolist())),fill=(70,255,197),width=1)
 image.paste(plot,(x+16,55))
 draw.text((x+16,345),'RMS %.3f | roundness %.2f'%(entry['rms'],entry['roundness']),font=small,fill=(178,193,209))
 draw.text((x+16,372),'Lit area %.2f%% | corr %.2f'%(entry['lit_fraction']*100,entry['correlation']),font=small,fill=(178,193,209))
image.save(OUT/'controlled_counterexamples.png')
with (OUT/'controlled_counterexamples.json').open('x') as f:json.dump(report,f,indent=2)
print(json.dumps(report,indent=2))
