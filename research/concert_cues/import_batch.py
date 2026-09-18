"""Import explicitly selected completed downloads into an exclusive dated batch."""
from pathlib import Path
import argparse, datetime, hashlib, json, re, shutil, subprocess, io
from PIL import Image, ImageDraw, ImageFont
DL=Path('/Users/elijah/Downloads');PROJECT=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research')

def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--ids',nargs='+',required=True);args=ap.parse_args()
 sources=[]
 for videoid in args.ids:
  if not re.fullmatch(r'[\w-]{11}',videoid):raise ValueError('Invalid YouTube ID')
  matches=sorted(DL.glob(f'YTDown*_Media_{videoid}_*.mp4'))
  if not matches:raise FileNotFoundError(videoid)
  source=next((p for p in matches if not re.search(r' \(\d+\)\.mp4$',p.name)),matches[0]);sources.append((videoid,source,matches))
 batch=datetime.datetime.now().astimezone().strftime('%-m-%-d-%y-%H%M%S');out=PROJECT/'reference'/batch
 out.mkdir(exist_ok=False);(out/'concerts').mkdir();(out/'review').mkdir()
 manifest={'created':datetime.datetime.now().astimezone().isoformat(),'policy':'Copy only; all originals and existing external files preserved','copies':[]}
 font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16)
 for videoid,source,matches in sources:
  before=source.stat();sha=digest(source)
  title=source.name.split('YTDown.com_YouTube_',1)[-1].split('_Media_',1)[0]
  slug=re.sub(r'[^a-z0-9]+','_',title.lower()).strip('_')+'_'+videoid
  target=out/'concerts'/(slug+'.mp4')
  with source.open('rb') as a,target.open('xb') as b:shutil.copyfileobj(a,b,8*1024*1024)
  assert digest(target)==sha and before.st_size==source.stat().st_size and before.st_mtime_ns==source.stat().st_mtime_ns
  probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_type,width,height,channels,r_frame_rate','-of','json',str(target)]))
  record={'source':str(source),'file':str(target),'sha256':sha,'source_url':f'https://www.youtube.com/watch?v={videoid}','title':title,'metadata_provenance':'download filename; not independently verified','rights':'UNKNOWN','probe':probe,'training_status':'candidate; no labels accepted','other_downloads':[{'path':str(p),'sha256':digest(p)} for p in matches if p!=source]}
  manifest['copies'].append(record)
  duration=float(probe['format']['duration']);print('VERIFIED',title,round(duration,2),flush=True)
  sheet=Image.new('RGB',(1600,820),(12,16,20));d=ImageDraw.Draw(sheet)
  times=[int(duration*f)//10*10 for f in [.1,.3,.55,.8]]
  for j,start in enumerate(times):
   d.text((10,j*205+3),f'{title[:70]} / {start//60:02d}:{start%60:02d} / 2 s intervals',font=font,fill='white')
   for i in range(5):
    raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(start+i*2),'-i',str(target),'-frames:v','1','-vf','scale=320:180','-f','image2pipe','-c:v','mjpeg','pipe:1'])
    sheet.paste(Image.open(io.BytesIO(raw)),(320*i,j*205+25))
  review=out/'review'/(slug+'.jpg')
  with review.open('xb') as f:sheet.save(f,format='JPEG')
  with (PROJECT/'SOURCES.md').open('a') as f:
   f.write(f'\n- `{target.relative_to(PROJECT)}` — {record["source_url"]}; original `{source.name}`; rights UNKNOWN; verified SHA-256 `{sha}`; candidate only.\n')
   f.write(f'- `{review.relative_to(PROJECT)}` — sampled stills from the above video for camera-coverage review; rights UNKNOWN.\n')
 with (out/'manifest.json').open('x') as f:json.dump(manifest,f,indent=2)
 with (out/'SHA256SUMS.txt').open('x') as f:
  for r in manifest['copies']:f.write(r['sha256']+'  concerts/'+Path(r['file']).name+'\n')
 with (out/'SOURCES.md').open('x') as f:
  f.write('# Research reference batch\n\nAll originals retained. Rights UNKNOWN; see manifest.json for source paths, URLs and checksums. Titles/URLs inferred from filenames. No labels accepted for training. Review JPGs derive from the corresponding MP4.\n')
 print('COMPLETE',out,flush=True)
if __name__=='__main__':main()
