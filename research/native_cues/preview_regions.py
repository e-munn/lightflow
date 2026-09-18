"""Review spatial proposals against native-timestamp registered source frames."""
from pathlib import Path
import argparse,hashlib,json
import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from native_frames import frames

HERE=Path(__file__).parent
ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research')


def main():
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);args=p.parse_args()
    args.out.mkdir(parents=True,exist_ok=False)
    proposals=json.loads((HERE/'region_candidates.json').read_text())
    sources=json.loads((HERE.parent/'wide_lights/sources.json').read_text())['sources']
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',18)
    evidence=[]
    for show,cfg in proposals['sources'].items():
        base=np.load(ROOT/'wide_lights/dataset_v1'/show/f'{cfg["clip_start"]:04d}.npz')
        valid=np.load(ROOT/'light_events/labels_v2'/f'{show}_{cfg["clip_start"]:04d}.npz')['geometry_valid']
        sheet=Image.new('RGB',(1280,len(cfg['sample_seconds'])*395),(7,14,19));draw=ImageDraw.Draw(sheet)
        for row,second in enumerate(cfg['sample_seconds']):
            decoded=list(frames(sources[show]['source'],second,.12));actual,pts,time_base,raw=decoded[0]
            ix=int(np.floor((actual-cfg['clip_start'])*10+1e-6))
            aligned=cv2.warpAffine(raw,base['transform'][ix],(640,360))
            original=Image.fromarray(aligned);overlay=original.convert('RGBA');ink=Image.new('RGBA',overlay.size);od=ImageDraw.Draw(ink)
            for field,rgba in [('screen_rectangles',(102,158,255,48)),('light_field_rectangles',(89,248,172,42))]:
                for box in cfg[field]:od.rectangle(tuple(box),fill=rgba,outline=rgba[:3]+(255,),width=2)
            overlay=Image.alpha_composite(overlay,ink).convert('RGB')
            draw.text((8,row*395+5),f'{show} / native PTS {actual:.6f}s / geometry {bool(valid[ix])} / green: light candidate / blue: screen candidate',font=font,fill=(224,237,230))
            sheet.paste(original,(0,row*395+30));sheet.paste(overlay,(640,row*395+30))
            evidence.append({'show':show,'requested_second':second,'source_pts':actual,'geometry_valid':bool(valid[ix]),'proposal_status':'pending visual review'})
        with (args.out/(show+'_mask_proposals.jpg')).open('xb') as f:sheet.save(f,format='JPEG',quality=94)
    with (args.out/'manifest.json').open('x') as f:json.dump({'evidence':evidence,'training_admission':False,'config_sha256':hashlib.sha256((HERE/'region_candidates.json').read_bytes()).hexdigest(),'code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},f,indent=2)
    print('COMPLETE',args.out,flush=True)


if __name__=='__main__':main()
