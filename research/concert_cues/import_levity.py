from pathlib import Path
import json,hashlib,subprocess,shutil,io
from PIL import Image,ImageDraw,ImageFont
DL=Path('/Users/elijah/Downloads');PROJECT=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research');OUT=PROJECT/'reference/9-16-26-evening'
source=DL/'YTDown.com_YouTube_LEVITY-at-COACHELLA-2026_Media_WCaZ6PalOsc_001_1080p.mp4';target=OUT/'concerts/levity_coachella_2026_WCaZ6PalOsc.mp4'
original_hash=hashlib.file_digest(source.open('rb'),'sha256').hexdigest();before=source.stat()
with source.open('rb') as a,target.open('xb') as b:shutil.copyfileobj(a,b,8*1024*1024)
assert hashlib.file_digest(target.open('rb'),'sha256').hexdigest()==original_hash
assert before.st_size==source.stat().st_size and before.st_mtime_ns==source.stat().st_mtime_ns
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_type,width,height,channels,r_frame_rate','-of','json',str(target)]))
duplicate=DL/'YTDown.com_YouTube_Whethan-Live-at-EDC-Las-Vegas-2026-Offic_Media_1Q-j11Nlm4k_001_1080p (1).mp4'
duplicate_hash=hashlib.file_digest(duplicate.open('rb'),'sha256').hexdigest();assert duplicate_hash=='c44e6100b4c7b0b2796933159e9b0fc11b4cceac42a9724778d841e36191510f'
manifest={'original':str(source),'copy':str(target),'sha256':original_hash,'probe':probe,'source_url':'https://www.youtube.com/watch?v=WCaZ6PalOsc','title_url_provenance':'download filename','rights':'UNKNOWN','status':'candidate; no labels accepted','duplicate_preserved':str(duplicate),'duplicate_sha256':duplicate_hash,'policy':'all originals retained; no deletion or overwrite'}
with (OUT/'levity_addendum.json').open('x') as f:json.dump(manifest,f,indent=2)
with (PROJECT/'SOURCES.md').open('a') as f:f.write(f'\n- `reference/9-16-26-evening/concerts/{target.name}` — https://www.youtube.com/watch?v=WCaZ6PalOsc; original `{source.name}`; rights UNKNOWN; SHA-256 `{original_hash}`; research candidate.\n- `reference/9-16-26-evening/review/levity_contact_sheet.jpg` — generated stills from Levity reference; rights UNKNOWN; camera-coverage review.\n')
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16);sheet=Image.new('RGB',(1600,820),(12,16,20));d=ImageDraw.Draw(sheet)
for j,start in enumerate([300,900,1800,2700]):
 d.text((10,j*205+3),f'LEVITY / {start//60:02d}:00–{start//60:02d}:08 / 2 s intervals',font=font,fill='white')
 for i in range(5):
  raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(start+2*i),'-i',str(target),'-frames:v','1','-vf','scale=320:180','-f','image2pipe','-c:v','mjpeg','pipe:1'])
  sheet.paste(Image.open(io.BytesIO(raw)),(i*320,j*205+25))
with (OUT/'review/levity_contact_sheet.jpg').open('xb') as f:sheet.save(f,format='JPEG')
print(json.dumps(manifest),flush=True)
