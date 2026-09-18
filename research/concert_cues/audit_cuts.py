"""Create reproducible cut-audit sheets. Detections remain proposals until reviewed."""
from pathlib import Path
import argparse, hashlib, io, json, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scan', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--min-confidence', type=float, default=.5)
    args = parser.parse_args()
    scan_file = args.scan / 'boundaries.json'
    scan = json.loads(scan_file.read_text())
    boundaries = scan['boundaries']
    rng = np.random.default_rng(9162026)
    # Random rows estimate positive precision; challenging rows are a separate audit.
    eligible = [i for i,b in enumerate(boundaries) if b['probability'] >= args.min_confidence]
    random_ids = sorted(rng.choice(eligible, min(12, len(eligible)), replace=False).tolist())
    lowest = sorted(eligible, key=lambda i: boundaries[i]['probability'])
    challenge_ids = [i for i in lowest if i not in random_ids][:4]
    records = [dict(boundary_index=i, selection='random', **boundaries[i]) for i in random_ids]
    records += [dict(boundary_index=i, selection='lowest_confidence', **boundaries[i]) for i in challenge_ids]
    args.out.mkdir(parents=True, exist_ok=False)
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 16)
    for page in range((len(records) + 3) // 4):
        selected = records[page*4:page*4+4]
        sheet = Image.new('RGB', (960, len(selected)*210), (12, 16, 20))
        draw = ImageDraw.Draw(sheet)
        for row, record in enumerate(selected):
            record['sample_times'] = [max(0, record['start']-.3), record['peak'], min(scan['duration']-.04, record['end']+.3)]
            label = f"#{record['boundary_index']} {record['selection']} {record['peak']:.3f}s p={record['probability']:.3f} | before / boundary / after"
            draw.text((5, row*210+3), label, font=font, fill='white')
            for col, at in enumerate(record['sample_times']):
                raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-threads', '2', '-ss', str(at), '-i', scan['source'], '-frames:v', '1', '-vf', 'scale=320:180', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'])
                sheet.paste(Image.open(io.BytesIO(raw)), (col*320, row*210+27))
        with (args.out / f'audit_{page+1}.jpg').open('xb') as f:
            sheet.save(f, format='JPEG', quality=92)
        print('PAGE', page+1, args.out, flush=True)
    manifest = dict(source=scan['source'], detector_manifest=str(scan_file),
                    detector_manifest_sha256=hashlib.sha256(scan_file.read_bytes()).hexdigest(),
                    seed=9162026, minimum_confidence=args.min_confidence, eligible_candidates=len(eligible), records=records,
                    limitation='Three-frame review tests some positive detections only; it cannot establish recall or full-shot continuity.')
    with (args.out / 'manifest.json').open('x') as f:
        json.dump(manifest, f, indent=2)


if __name__ == '__main__':
    main()
