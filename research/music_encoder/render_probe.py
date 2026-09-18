"""Past-only prediction diagnostic; learned probabilities never drive the lights."""
from pathlib import Path
import argparse, colorsys, hashlib, json, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
ROOT = Path('/Volumes/ExtremePro/Code/lightflow/research')
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
TITLE = ImageFont.truetype(FONT, 28)
BODY = ImageFont.truetype(FONT, 21)
SMALL = ImageFont.truetype(FONT, 17)
COLORS = {'signal': (109, 213, 221), 'music': (186, 155, 249), 'hybrid': (244, 189, 103)}
BEGIN, DURATION, FPS, SR = 1860, 60, 30, 48000


def save(path, data):
    with path.open('x') as f:
        json.dump(data, f, indent=2, allow_nan=False)


def light_values(features):
    """Same direct, forecast-disabled mapping as public/scope-core.mjs."""
    amplitude, spread, texture, balance, bass, air, attack = features[:7]
    intensity = np.clip(amplitude + .12 * attack, 0, 1)
    hue = np.clip(.62 - .4 * bass + .15 * air, 0, 1)
    levels = []
    for i in range(8):
        center = .5 + balance * .36
        width = .1 + spread * .55
        envelope = np.exp(-.5 * (((i + .5) / 8 - center) / width) ** 2)
        detail = 1 - texture * .45 + (i % 2) * texture * .45
        levels.append(intensity * (.18 + .82 * envelope) * detail)
    return intensity, hue, levels


def hsl(hue, lightness):
    return tuple(round(255 * v) for v in colorsys.hls_to_rgb(float(hue), float(lightness), .55))


def graph(draw, prediction, times, now, index, head, top):
    left, width, height = 550, 843, 86
    name = 'Rise' if head == 0 else 'Release'
    draw.text((511, top - 27), name + ' probability', font=SMALL, fill=(211, 221, 224))
    for value in [0, .5, 1]:
        y = top + (1 - value) * height
        draw.line((left, y, left + width, y), fill=(44, 54, 63))
        draw.text((511, y - 9), f'{value:g}', font=SMALL, fill=(132, 153, 161))
    ids = np.flatnonzero((times >= now - 12) & (times <= now + 1e-7))
    assert len(ids) and ids[-1] <= index
    for kind, color in COLORS.items():
        pts = [(left + (times[i] - now + 12) / 12 * width,
                top + (1 - prediction[kind][i, head]) * height) for i in ids]
        if len(pts) > 1:
            draw.line(pts, fill=color, width=2)
        value = float(prediction[kind][index, head])
        j = list(COLORS).index(kind)
        draw.text((1045 + j * 111, top - 27), f'{value:.2f}', font=SMALL, fill=color)
    draw.line((left + width, top, left + width, top + height), fill=(155, 175, 180))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    run = ROOT / 'music_encoder/probe_v1'
    evaluation = json.loads((run / 'evaluation.json').read_text())
    assert all(v['threshold'] is None for h in evaluation['thresholds'].values() for v in h.values())
    cfg = json.loads((HERE.parent / 'wide_lights/sources.json').read_text())['sources']['forest']
    source = cfg['source']
    prediction = np.load(run / 'forest_1800.npz')
    times = prediction['time']
    signal = np.loadtxt(ROOT / 'wide_lights/audio_v1/forest_1800.csv', delimiter=',', skiprows=1)
    audio_begin = BEGIN - 1
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(audio_begin), '-i', source,
        '-t', str(DURATION + 1), '-vn', '-ac', '2', '-ar', str(SR), '-f', 'f32le', 'pipe:1'])
    audio = np.frombuffer(raw, '<f4').reshape(-1, 2)
    assert len(audio) >= (DURATION + 1) * SR and np.isfinite(audio).all()
    decoder = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', str(BEGIN), '-i', source,
        '-t', str(DURATION), '-vf', 'fps=30,scale=640:360', '-an', '-f', 'rawvideo',
        '-pix_fmt', 'rgb24', 'pipe:1'], stdout=subprocess.PIPE)
    dest = args.out / 'forest_31m_music_probe.mp4'
    encoder = subprocess.Popen(['ffmpeg', '-n', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
        '-s', '1440x980', '-r', str(FPS), '-i', 'pipe:0', '-ss', str(BEGIN), '-i', source,
        '-t', str(DURATION), '-map', '0:v', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'fast',
        '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
        str(dest)], stdin=subprocess.PIPE)
    samples = []
    for frame_id in range(DURATION * FPS):
        now = BEGIN + frame_id / FPS
        k = int(np.searchsorted(times, now + 1e-7, side='right') - 1)
        s = int(np.searchsorted(signal[:, 0], now + 1e-7, side='right') - 1)
        # Display the same last completed 20 ms block used for the direct features.
        endpoint = signal[s, 0]
        last_sample = round((endpoint - audio_begin) * SR)
        block = audio[last_sample - 960:last_sample]
        assert len(block) == 960 and endpoint <= now + 1e-7 and times[k] <= now + 1e-7
        feature_index = int(prediction['feature_index'][k])
        assert prediction['feature_ready_time'][feature_index] <= times[k] + 1e-7
        raw = decoder.stdout.read(640 * 360 * 3)
        assert len(raw) == 640 * 360 * 3
        canvas = Image.new('RGB', (1440, 980), (6, 13, 18))
        draw = ImageDraw.Draw(canvas)
        draw.text((23, 18), 'LIGHTFLOW / SCOPE + MUSIC-FEATURE DIAGNOSTIC', font=TITLE, fill=(224, 237, 232))
        draw.text((23, 62), f'Of The Trees / Forest   {int(now//60):02d}:{now%60:04.1f}   |   Fixed development-test minute; original recording audio', font=BODY, fill=(158, 181, 176))
        for box in [(20, 102, 704, 533), (724, 102, 1420, 533), (20, 551, 470, 900), (490, 551, 1420, 900)]:
            draw.rounded_rectangle(box, radius=12, fill=(17, 26, 33))
        draw.text((40, 116), 'Source footage', font=BODY, fill=(222, 233, 228))
        canvas.paste(Image.frombytes('RGB', (640, 360), raw), (42, 156))
        draw.text((744, 116), 'Stereo scope / immediate reference', font=BODY, fill=(222, 233, 228))
        scope = Image.new('RGB', (430, 360), (5, 10, 12))
        sd = ImageDraw.Draw(scope)
        unit = 360 * .44
        sd.line((215-unit, 180, 215+unit, 180), fill=(24, 39, 42))
        sd.line((215, 180-unit, 215, 180+unit), fill=(24, 39, 42))
        sd.line([(215 + float(l) * 1.5 * unit, 180 - float(r) * 1.5 * unit) for l, r in block], fill=(169, 255, 223), width=1)
        canvas.paste(scope, (744, 156))
        values = signal[s, 1:9]
        for j, (name, value) in enumerate(zip(['Amplitude', 'Spread', 'Texture'], values[:3])):
            draw.text((1194, 186+j*68), name, font=SMALL, fill=(153, 179, 171))
            draw.text((1194, 211+j*68), f'{value:.3f}', font=BODY, fill=(220, 235, 229))
        for j, line in enumerate(['20 ms window', 'Fixed gain 1.5', 'No persistence', '30 fps export']):
            draw.text((1194, 400+j*25), line, font=SMALL, fill=(153, 179, 171))
        draw.text((38, 565), 'Direct light signal', font=BODY, fill=(222, 233, 228))
        draw.text((38, 594), 'Procedural mapping of scope features', font=SMALL, fill=(153, 179, 171))
        intensity, hue, levels = light_values(values)
        draw.rectangle((38, 630, 452, 746), fill=hsl(hue, intensity*.75))
        for j, level in enumerate(levels):
            draw.rectangle((38+j*414/8+4, 770, 38+(j+1)*414/8-4, 870), fill=hsl(hue, level*.8))
        draw.text((510, 565), 'Learned predictions / diagnostic only', font=BODY, fill=(222, 233, 228))
        for j, (name, color) in enumerate(COLORS.items()):
            draw.text((510+j*250, 596), {'signal':'Signal features', 'music':'Music features', 'hybrid':'Combined features'}[name], font=SMALL, fill=color)
        graph(draw, prediction, times, now, k, 0, 658)
        graph(draw, prediction, times, now, k, 1, 798)
        draw.text((23, 922), 'No reliable trigger threshold: learned lighting cues OFF. Charts show probability of a stage event 0.2-1.0 seconds ahead.', font=BODY, fill=(227, 192, 137))
        draw.text((23, 956), 'Charts: trailing 12 seconds; fixed 0-1 scale. Source light/audio offset and physical capture-to-light latency are unmeasured.', font=SMALL, fill=(153, 179, 171))
        encoder.stdin.write(canvas.tobytes())
        if frame_id in [0, 900, 1770]:
            with (args.out / f'frame_{frame_id:04d}.jpg').open('xb') as f:
                canvas.save(f, format='JPEG', quality=92)
            samples.append({'time':now, 'scope_audio_endpoint':float(endpoint), 'prediction_endpoint':float(times[k]),
                            'intensity':float(intensity), 'hue':float(hue), 'zone_levels':[float(v) for v in levels],
                            'scope_features':values.tolist()})
        if frame_id % 300 == 0:
            print('FRAME', frame_id, flush=True)
    decoder.stdout.close()
    assert decoder.wait() == 0
    encoder.stdin.close()
    assert encoder.wait() == 0
    save(args.out / 'manifest.json', {'source':source, 'interval_seconds':[BEGIN, BEGIN+DURATION],
        'run':str(run), 'render_fps':FPS, 'audio_feature_fps':50, 'prediction_fps':10,
        'scope_window_ms':20, 'scope_gain':1.5, 'scope_persistence':0, 'learned_cues_enabled':False,
        'chart_y_range':[0,1], 'chart_history_seconds':12, 'physical_latency':'Unmeasured',
        'source_light_audio_offset':'Unmeasured; original recording retained', 'samples':samples,
        'code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})
    print('COMPLETE', dest, flush=True)


if __name__ == '__main__':
    main()
