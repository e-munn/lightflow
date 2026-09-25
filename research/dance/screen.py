"""Timestamped contact sheets. Sampling is not full-span visual approval."""
import argparse
from io import BytesIO
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw


def main():
    p = argparse.ArgumentParser()
    p.add_argument('videos', nargs='+')
    p.add_argument('--start', type=float, default=20)
    p.add_argument('--step', type=float, default=5)
    args = p.parse_args()
    for file in map(Path, args.videos):
        sheet = Image.new('RGB', (960, 610), '#101510')
        draw = ImageDraw.Draw(sheet)
        draw.text((10, 7), file.stem + ' — sampled source frames; not continuous audit', fill='white')
        for i in range(9):
            t = args.start + i * args.step
            data = subprocess.check_output(['/Users/elijah/miniconda3/bin/ffmpeg', '-v', 'error', '-ss', str(t), '-i', str(file), '-frames:v', '1', '-vf', 'scale=320:180:force_original_aspect_ratio=decrease', '-f', 'image2pipe', '-vcodec', 'png', '-'])
            if not data:
                continue
            im = Image.open(BytesIO(data))
            x, y = (i % 3) * 320, 30 + (i // 3) * 192
            sheet.paste(im, (x, y))
            draw.rectangle((x, y, x+90, y+17), fill='black')
            draw.text((x+4, y+2), f'{t:.1f} sec', fill='white')
        target = file.parent / f'screen-{args.start:g}-{args.step:g}.jpg'
        with target.open('xb') as f:
            sheet.save(f, 'JPEG', quality=88)
        print(target, flush=True)


if __name__ == '__main__':
    main()
