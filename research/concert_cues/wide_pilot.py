"""Source/observation replay for a wide stage view; no inferred fixture commands."""
from pathlib import Path
import csv, json, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SOURCE=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/reference/9-16-26-194931/concerts/of_the_trees_electric_forest_25_Cxb4TCmXG1c.mp4')
OUT=Path('/Volumes/ExtremePro/Code/lightflow/research/concert_cues/wide_pilot_forest_v1')
START=2560;DURATION=60;FPS=30;W=640;H=360
# Coordinates selected from the inspected 960×540 frame; stage interior excludes
# side LED panels, the header, the audience and the bright foreground totem.
REGIONS=[(310+i*80,212,390+i*80,328) for i in range(4)]
GRAPHICS=[(228,240,289,386),(637,240,691,386)]


def main():
    if not (OUT/'source_frame.png').exists():raise ValueError('Inspect the source frame before this pilot')
    target=OUT/'source_and_regions.mp4'
    if target.exists():raise FileExistsError(target)
    decoder=subprocess.Popen(['ffmpeg','-v','error','-threads','2','-ss',str(START),'-i',str(SOURCE),'-t',str(DURATION),'-vf',f'fps={FPS},scale={W}:{H}','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE)
    encoder=subprocess.Popen(['ffmpeg','-v','error','-n','-f','rawvideo','-pix_fmt','rgb24','-s','1280x720','-r',str(FPS),'-i','pipe:0','-ss',str(START),'-i',str(SOURCE),'-t',str(DURATION),'-map','0:v','-map','1:a','-c:v','libx264','-threads','2','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(target)],stdin=subprocess.PIPE)
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',17)
    big=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',25)
    observations=[];regions=[tuple(round(c*2/3) for c in box) for box in REGIONS+GRAPHICS]
    try:
        while True:
            raw=decoder.stdout.read(W*H*3)
            if not raw:break
            rgb=np.frombuffer(raw,np.uint8).reshape(H,W,3)
            index=len(observations);values=[]
            for x0,y0,x1,y1 in regions:
                pixels=rgb[y0:y1,x0:x1].reshape(-1,3).astype(np.float32)/255
                luma=pixels@np.array([.2126,.7152,.0722]);threshold=np.quantile(luma,.98)
                bright=pixels[luma>=max(threshold,.025)]
                color=np.mean(bright,axis=0) if len(bright) else np.zeros(3)
                values.append({'luma_mean':float(luma.mean()),'luma_p99':float(np.quantile(luma,.99)),
                               'coverage_above_0.1':float(np.mean(luma>.1)),
                               'clipped_channel_fraction':float(np.mean(pixels>=250/255)),
                               'bright_pixel_rgb':color.tolist()})
            row={'source_seconds':START+index/FPS,'stage_regions':values[:4],'graphics_regions':values[4:],
                 'training_accepted':False,'flags':['exposure_not_calibrated','audio_light_offset_unverified','camera_continuity_not_fully_reviewed']}
            observations.append(row)
            canvas=Image.new('RGB',(1280,720),(8,14,18));draw=ImageDraw.Draw(canvas)
            draw.text((24,18),'LIGHTFLOW / WIDE-SHOT OBSERVATION PILOT',font=big,fill=(224,244,235))
            draw.text((24,58),f'Of The Trees / {int(row["source_seconds"])//60:02d}:{row["source_seconds"]%60:05.2f} / original recording audio',font=font,fill=(141,167,166))
            canvas.paste(Image.fromarray(rgb),(24,112))
            for j,(x0,y0,x1,y1) in enumerate(regions):
                draw.rectangle((24+x0,112+y0,24+x1,112+y1),outline=(122,246,206) if j<4 else (247,186,107),width=1)
            draw.text((704,112),'STAGE INTERIOR / FOUR REGIONS',font=font,fill=(159,233,208))
            for j,value in enumerate(values[:4]):
                color=tuple(int(np.clip(c,0,1)*255) for c in value['bright_pixel_rgb'])
                draw.rectangle((704+j*134,153,826+j*134,314),fill=color)
                draw.text((704+j*134,328),f'{value["luma_p99"]:.2f}',font=font,fill=(223,238,231))
                draw.text((704+j*134,359),f'{100*value["coverage_above_0.1"]:.1f}% lit',font=font,fill=(137,163,161))
            draw.text((704,408),'Side LED panels measured separately',font=font,fill=(247,186,107))
            draw.text((24,496),'Observed light and pixel behavior — not calibrated fixture intensity',font=big,fill=(209,228,222))
            draw.text((24,537),'Tiles show average RGB of the brightest 2% above a fixed floor. No per-frame gain normalization.',font=font,fill=(155,180,178))
            draw.text((24,567),'Interior boxes exclude the header, side screens, audience and foreground totem in the inspected frame.',font=font,fill=(155,180,178))
            draw.text((24,621),'CANDIDATE ONLY / camera, exposure, remaining occlusion and timing need review before training.',font=font,fill=(244,188,130))
            if index in [0,450,900,1350]:
                with (OUT/f'replay_frame_{index:04d}.jpg').open('xb') as f:canvas.save(f,format='JPEG',quality=90)
            encoder.stdin.write(canvas.tobytes())
        decoder.stdout.close();assert decoder.wait()==0
        encoder.stdin.close();assert encoder.wait()==0
    finally:
        for process in [decoder,encoder]:
            if process.poll() is None:process.terminate();process.wait()
    with (OUT/'observations.json').open('x') as f:json.dump(observations,f,indent=2,allow_nan=False)
    manifest={'source':str(SOURCE),'source_start':START,'duration':len(observations)/FPS,'fps':FPS,
              'stage_boxes_960x540':REGIONS,'graphics_boxes_960x540':GRAPHICS,'training_accepted_seconds':0,
              'provenance':'Observed video pixels; stage interior may still contain graphics/haze; not isolated fixture signals',
              'timing':'Original source audio. Separate matching recording found; physical audio-light delay remains unknown',
              'split_constraint':'Same performance as the original Of The Trees Forest reference: group together and retain as holdout'}
    with (OUT/'manifest.json').open('x') as f:json.dump(manifest,f,indent=2)
    print('COMPLETE',target,flush=True)


if __name__=='__main__':main()
