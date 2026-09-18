from pathlib import Path
import shutil,hashlib,json,subprocess,datetime,io
from PIL import Image,ImageDraw,ImageFont
DL=Path('/Users/elijah/Downloads')
PROJECT=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research')
OUT=PROJECT/'reference/9-16-26-evening'
ASSETS=[
('skrillex_ultra_ni2pGkTPLDo.mp4','YTDown.com_YouTube_SKRILLEX-LIVE-_-ULTRA-MUSIC-FESTIVAL-202_Media_ni2pGkTPLDo_001_1080p.mp4','ni2pGkTPLDo','8a239b1d12e3dc499264bd38f893de42ca0c8d0d519cc2a5da208c9ace36d713'),
('whethan_edc_las_vegas_2026_1Q-j11Nlm4k.mp4','YTDown.com_YouTube_Whethan-Live-at-EDC-Las-Vegas-2026-Offic_Media_1Q-j11Nlm4k_001_1080p.mp4','1Q-j11Nlm4k','c44e6100b4c7b0b2796933159e9b0fc11b4cceac42a9724778d841e36191510f')]
OUT.mkdir(exist_ok=False);(OUT/'concerts').mkdir();(OUT/'review').mkdir()
records=[]
for name,original,videoid,expected in ASSETS:
 source=DL/original;target=OUT/'concerts'/name
 before=source.stat()
 with source.open('rb') as a,target.open('xb') as b:shutil.copyfileobj(a,b,8*1024*1024)
 actual=hashlib.file_digest(target.open('rb'),'sha256').hexdigest()
 assert actual==expected and before.st_size==source.stat().st_size and before.st_mtime_ns==source.stat().st_mtime_ns
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_type,width,height,channels,r_frame_rate','-of','json',str(target)]))
 records.append({'file':name,'original':str(source),'sha256':actual,'source_url':f'https://www.youtube.com/watch?v={videoid}','title_url_provenance':'inferred from download filename','rights':'UNKNOWN','probe':probe,'training_status':'candidate; held out of initial forecast experiment'})
 print('VERIFIED',name,flush=True)
manifest={'created':datetime.datetime.now().astimezone().isoformat(),'copies':records,'duplicates_preserved':[str(DL/'YTDown.com_YouTube_SKRILLEX-LIVE-_-ULTRA-MUSIC-FESTIVAL-202_Media_ni2pGkTPLDo_001_1080p (1).mp4')],'incomplete_not_imported':[p.name for p in DL.glob('*.crdownload')],'policy':'copy only; originals retained; nothing deleted or overwritten'}
with (OUT/'manifest.json').open('x') as f:json.dump(manifest,f,indent=2)
with (OUT/'SHA256SUMS.txt').open('x') as f:
 for r in records:f.write(r['sha256']+'  concerts/'+r['file']+'\n')
lines=['\n## Additional concert references — 2026-09-16 evening\n']
for r in records:lines.append(f"- `reference/9-16-26-evening/concerts/{r['file']}` — {r['source_url']}; original `{Path(r['original']).name}`; rights UNKNOWN; SHA-256 `{r['sha256']}`; research candidate, no training labels accepted.\n")
lines.append('- `reference/9-16-26-evening/review/contact_sheet.jpg` — generated stills from these two sources; rights UNKNOWN; camera-coverage review.\n')
with (PROJECT/'SOURCES.md').open('a') as f:f.write(''.join(lines))
with (OUT/'SOURCES.md').open('x') as f:f.write('# Evening concert references\n\n' + ''.join(lines[1:])+'\nDuplicate Skrillex original retained in Downloads. Partial downloads untouched.\n')
# Review multiple moments across each full show. No media copies on the internal disk.
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16)
rows=[(r,t) for r in records for t in [300,900,1800,2700]]
sheet=Image.new('RGB',(1600,len(rows)*205),(12,16,20));d=ImageDraw.Draw(sheet)
for j,(r,start) in enumerate(rows):
 d.text((10,j*205+3),f'{r["file"].split("_")[0].upper()} / {start//60:02d}:00–{start//60:02d}:08 / 2 s intervals',font=font,fill='white')
 for i in range(5):
  raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(start+2*i),'-i',str(OUT/'concerts'/r['file']),'-frames:v','1','-vf','scale=320:180','-f','image2pipe','-c:v','mjpeg','pipe:1'])
  sheet.paste(Image.open(io.BytesIO(raw)),(i*320,j*205+25))
sheet.save(OUT/'review/contact_sheet.jpg')
print('COMPLETE',OUT,flush=True)
