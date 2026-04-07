# Titan Tube Preview — Pure Python rendering, no GLSL
import json as _json
import numpy as _np

STEMS_JSON = '/Users/elijah/code/lightflow/v2/Talk of the Town_stems.json'
AUDIO_FILE = '/Users/elijah/Desktop/Talk of the Town.mp3'

p = op('/project1')
for c in p.children:
    if c.name.startswith('_'):
        continue
    try:
        c.destroy()
    except:
        pass

print("Building tubes...")
W, H = 1280, 720

# Load stems
try:
    with open(STEMS_JSON) as _f:
        _sd = _json.load(_f)
    print("  Song: {} ({:.0f}s)".format(_sd['song'], _sd['duration']))
except:
    _sd = None

p.store('stem_states', _sd['states'] if _sd else [])
p.store('stem_fps', _sd['fps'] if _sd else 20)
p.store('stem_duration', _sd['duration'] if _sd else 0)
p.store('play_start', absTime.seconds)

# Audio
audio_in = p.create(audiofileinCHOP, 'audio_in')
for pn in ['file', 'fileinname']:
    try:
        setattr(audio_in.par, pn, AUDIO_FILE)
        break
    except:
        continue
try:
    audio_in.par.play = True
except:
    pass
audio_in.nodeX, audio_in.nodeY = -400, 400

audio_out = p.create(audiodeviceoutCHOP, 'audio_out')
audio_out.setInputs([audio_in])
try:
    audio_out.par.active = True
except:
    pass
audio_out.nodeX, audio_out.nodeY = -200, 400
print("  [+] audio")

# Script TOP — renders everything in Python
render_code = p.create(textDAT, 'render_code')
render_code.text = r'''import numpy as np

_img = None
_smooth = {}
_cfg = {
    'kick':  (0.95, 0.3),
    'snare': (0.9, 0.2),
    'bass':  (0.4, 0.08),
    'hat':   (0.85, 0.4),
    'vocals':(0.15, 0.05),
    'other': (0.3, 0.1),
}
_stem_keys = {
    'kick': 'kick_energy', 'snare': 'snare_energy',
    'bass': 'bass_energy', 'hat': 'hat_energy',
    'vocals': 'vocals_energy', 'other': 'other_energy',
}

def cook(scriptOp):
    global _img, _smooth
    W, H = 1280, 720

    # Preallocate
    if _img is None or _img.shape != (H, W, 4):
        _img = np.zeros((H, W, 4), dtype=np.float32)

    # Background
    _img[:, :, 0] = 0.02
    _img[:, :, 1] = 0.02
    _img[:, :, 2] = 0.04
    _img[:, :, 3] = 1.0

    # Read stem data from storage
    proj = op('/project1')
    states = proj.fetch('stem_states', [])
    fps = proj.fetch('stem_fps', 20)
    t0 = proj.fetch('play_start', absTime.seconds)
    dur = proj.fetch('stem_duration', 0)

    if not states:
        scriptOp.copyNumpyArray(_img)
        return

    elapsed = absTime.seconds - t0
    if dur > 0 and elapsed >= dur:
        proj.store('play_start', absTime.seconds)
        elapsed = 0.0

    n = len(states)
    idx = max(0, min(int(elapsed * fps), n - 1))
    ch = states[idx]['channels']

    # Smooth stems
    stems = {}
    for name, (atk, rel) in _cfg.items():
        raw = ch.get(_stem_keys[name], 0.0)
        prev = _smooth.get(name, 0.0)
        if raw > prev:
            val = prev + (raw - prev) * atk
        else:
            val = prev + (raw - prev) * rel
        _smooth[name] = val
        stems[name] = val

    kick = stems['kick']
    snare = stems['snare']

    # Update HUD
    t = states[idx].get('time', 0.0)
    lbl = op('/project1/info_label')
    if lbl is not None:
        try:
            lbl.par.text = 'TUBES [{:.1f}s/{:.0f}s]  KICK {:.2f}  SNARE {:.2f}'.format(t, dur, kick, snare)
        except:
            pass

    # Tube layout
    sp = int(W * 0.08)
    x0 = W // 2 - sp * 4 + sp // 2
    tw = int(W * 0.022)
    bot = int(H * 0.10)
    ph = int(H * 0.05)
    gap = 2

    for tube in range(8):
        cx = x0 + tube * sp
        x1 = max(0, cx - tw)
        x2 = min(W, cx + tw)

        for px in range(16):
            pn = px / 15.0
            yc = bot + int((px + 0.5) * ph)
            y1 = max(0, yc - ph // 2 + gap)
            y2 = min(H, yc + ph // 2 - gap)

            # Bottom half = kick (white), top half = snare (orange)
            if pn < 0.5:
                r, g, b = kick, kick * 0.98, kick * 0.95
            else:
                r, g, b = snare, snare * 0.5, snare * 0.08

            # Outline (always visible)
            _img[y1:y2, x1:x2, 0] = np.maximum(_img[y1:y2, x1:x2, 0], 0.06)
            _img[y1:y2, x1:x2, 1] = np.maximum(_img[y1:y2, x1:x2, 1], 0.06)
            _img[y1:y2, x1:x2, 2] = np.maximum(_img[y1:y2, x1:x2, 2], 0.08)

            # Lit pixel
            br = max(r, g, b)
            if br > 0.02:
                ix1, ix2 = x1 + 1, x2 - 1
                iy1, iy2 = y1 + 1, y2 - 1
                if ix2 > ix1 and iy2 > iy1:
                    _img[iy1:iy2, ix1:ix2, 0] = r
                    _img[iy1:iy2, ix1:ix2, 1] = g
                    _img[iy1:iy2, ix1:ix2, 2] = b

    scriptOp.copyNumpyArray(_img)
'''
render_code.nodeX, render_code.nodeY = 0, 200

tube_render = p.create(scriptTOP, 'tube_render')
for pn in ['callbacks', 'callbackdat', 'dat']:
    try:
        setattr(tube_render.par, pn, 'render_code')
        break
    except:
        continue
try:
    tube_render.par.resolutionw = W
    tube_render.par.resolutionh = H
except:
    pass
tube_render.nodeX, tube_render.nodeY = 200, 200
print("  [+] tube_render (Script TOP)")

# HUD
info_label = p.create(textTOP, 'info_label')
try:
    info_label.par.text = 'TUBES [starting...]'
except:
    pass
try:
    info_label.par.fontsizex = 16
except:
    try:
        info_label.par.fontsize = 16
    except:
        pass
try:
    info_label.par.resolutionw = W
    info_label.par.resolutionh = H
except:
    pass
try:
    info_label.par.alignx = 0
    info_label.par.aligny = 2
    info_label.par.fontcolorr = 0.8
    info_label.par.fontcolorg = 0.8
    info_label.par.fontcolorb = 0.8
    info_label.par.bgalpha = 0
except:
    pass
info_label.nodeX, info_label.nodeY = 200, 0
print("  [+] info_label")

# Composite + output
final_comp = p.create(compositeTOP, 'final_comp')
final_comp.setInputs([tube_render, info_label])
try:
    final_comp.par.operand = 0
except:
    pass
final_comp.nodeX, final_comp.nodeY = 400, 100

out = p.create(nullTOP, 'out')
out.setInputs([final_comp])
out.nodeX, out.nodeY = 600, 100
print("  [+] out\n=== READY ===")
