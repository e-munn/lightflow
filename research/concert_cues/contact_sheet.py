from pathlib import Path
import subprocess,json,io
from PIL import Image,ImageDraw,ImageFont
BASE=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/reference/9-16-26/concerts')
OUT=Path('/Volumes/ExtremePro/Code/lightflow/research/concert_cues/shot_review_2026-09-16')
SOURCES={'ultra':BASE/'of_the_trees_ultra_miami_2026_b3E9eB6Uw_E.mp4','forest':BASE/'of_the_trees_electric_forest_-eVk7dh8dO4.mp4'}
OUT.mkdir(parents=True,exist_ok=False)
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16)
rows=[(show,start) for show in SOURCES for start in [600,1200,1800,2400]]
canvas=Image.new('RGB',(1600,len(rows)*205),(12,16,20));d=ImageDraw.Draw(canvas)
records=[]
for j,(show,start) in enumerate(rows):
 d.text((10,j*205+3),f'{show.upper()} / {start//60:02d}:00–{start//60:02d}:08 / 2 s intervals',font=font,fill='white')
 for i in range(5):
  at=start+2*i
  raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(at),'-i',str(SOURCES[show]),'-frames:v','1','-vf','scale=480:-1','-f','image2pipe','-c:v','mjpeg','pipe:1'])
  file=OUT/f'{show}_{at:04d}.jpg';file.write_bytes(raw)
  im=Image.open(io.BytesIO(raw)).resize((320,180));canvas.paste(im,(320*i,j*205+25))
 records.append({'show':show,'source':str(SOURCES[show]),'start':start,'duration':10,'status':'unreviewed','frames':[start+2*i for i in range(5)]})
canvas.save(OUT/'contact_sheet.jpg')
with (OUT/'manifest.json').open('x') as f:json.dump(records,f,indent=2)
print(OUT/'contact_sheet.jpg')
