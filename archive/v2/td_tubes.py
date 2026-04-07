# === LightFlow v2 - Titan Tube Preview ===
# Pure Python Script TOP — no GLSL, no Execute DATs, no uniforms.
#
# 3 layers:
#   1. Kick (bottom 8 pixels, white flash)
#   2. Snare (top 8 pixels, orange flash)
#   3. Melody node with trail (dances across 8x16 grid, takes precedence)
#
# Run in Textport:
#   exec(open('/Users/elijah/code/lightflow/v2/td_tubes.py').read())
#
STEMS_JSON = '/Users/elijah/code/lightflow/v2/Talk of the Town_stems.json'
AUDIO_FILE = '/Users/elijah/Desktop/Talk of the Town.mp3'

import json as _json

p = op('/project1')

for c in p.children:
    if c.name.startswith('_'):
        continue
    try:
        c.destroy()
    except:
        pass

print("Building Titan Tube preview...")

W, H = 1280, 720

# ── Load stems JSON into project storage ──
try:
    with open(STEMS_JSON) as _f:
        _sd = _json.load(_f)
    print("  Loaded: {} ({} frames, {:.1f}s)".format(
        _sd['song'], _sd['n_frames'], _sd['duration']))
except Exception as _e:
    print("  [!] " + str(_e))
    _sd = None

p.store('stem_states', _sd['states'] if _sd else [])
p.store('stem_fps', _sd['fps'] if _sd else 20)
p.store('stem_duration', _sd['duration'] if _sd else 0)
p.store('play_start', absTime.seconds)

# ══════════════════════════════════════════════
# 1. AUDIO PLAYBACK
# ══════════════════════════════════════════════

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

# ══════════════════════════════════════════════
# 2. CHOP-TO-TOP (forces Script TOP to cook every frame)
# ══════════════════════════════════════════════

pulse = p.create(choptoTOP, 'pulse')
for pn in ['chop', 'choppath']:
    try:
        setattr(pulse.par, pn, 'audio_in')
        break
    except:
        continue
try:
    pulse.par.resolutionw = 2
    pulse.par.resolutionh = 2
except:
    pass
pulse.nodeX, pulse.nodeY = 0, 200
print("  [+] pulse (force-cook)")

# ══════════════════════════════════════════════
# 3. SCRIPT TOP (renders everything in Python)
# ══════════════════════════════════════════════

render_code = p.create(textDAT, 'render_code')
render_code.text = r'''import numpy as np
import math

_img = None
_smooth = {}
_frame = 0
_trail = []
_TRAIL_MAX = 30
_node_x = 3.5
_node_y = 8.0

# Melody node color per dominant frequency band
_COLORS = [
    (0.9, 0.1, 0.4),   # 0: hot pink   (100-160 Hz)
    (1.0, 0.25, 0.1),  # 1: red        (160-250 Hz)
    (1.0, 0.6, 0.05),  # 2: orange     (250-400 Hz)
    (0.95, 0.95, 0.1), # 3: yellow     (400-630 Hz)
    (0.2, 0.95, 0.2),  # 4: green      (630-1 kHz)
    (0.1, 0.85, 0.9),  # 5: cyan       (1-1.6 kHz)
    (0.25, 0.35, 1.0), # 6: blue       (1.6-2.5 kHz)
    (0.7, 0.2, 0.95),  # 7: purple     (2.5-10 kHz)
]

def cook(scriptOp):
    global _img, _smooth, _frame, _trail, _node_x, _node_y
    W, H = 1280, 720

    if _img is None or _img.shape != (H, W, 4):
        _img = np.zeros((H, W, 4), dtype=np.float32)

    _img[:, :, :3] = [0.02, 0.02, 0.04]
    _img[:, :, 3] = 1.0

    proj = op('/project1')
    states = proj.fetch('stem_states', [])
    fps = proj.fetch('stem_fps', 20)
    t0 = proj.fetch('play_start', absTime.seconds)
    dur = proj.fetch('stem_duration', 0)
    _frame += 1

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

    # ── Smooth helper ──
    def sm(key, raw, atk, rel):
        prev = _smooth.get(key, 0.0)
        v = prev + (raw - prev) * (atk if raw > prev else rel)
        _smooth[key] = v
        return v

    kick = sm('kick', ch.get('kick_energy', 0.0), 0.95, 0.25)
    snare = sm('snare', ch.get('snare_energy', 0.0), 0.9, 0.2)
    centroid = ch.get('centroid', 500.0)

    # Mel bands (8, one per tube column)
    mel = []
    for i in range(8):
        mel.append(sm('mel_{}'.format(i), ch.get('mel_band_{}'.format(i), 0.0), 0.7, 0.12))

    mel_total = sum(mel)
    mel_prev = _smooth.get('_mel_prev', 0.0)
    mel_delta = mel_total - mel_prev
    _smooth['_mel_prev'] = mel_total

    # ── Melody node position ──
    # X = spectral center-of-mass → which tube
    # Y = centroid + energy → which pixel height
    if mel_total > 0.05:
        target_x = sum(i * mel[i] for i in range(8)) / mel_total
        c_norm = min(centroid / 5000.0, 1.0)
        target_y = c_norm * 10.0 + mel_total * 4.0
        target_y = max(0.0, min(15.0, target_y))
    else:
        target_x = _node_x
        target_y = _node_y

    # Multi-frequency noise (organic wobble, amplitude scales with energy)
    t = elapsed
    amp = 0.4 + mel_total * 1.8
    noise_x = (math.sin(t * 3.7) * 0.5
             + math.sin(t * 7.1 + 1.3) * 0.3
             + math.sin(t * 13.3 + 2.7) * 0.15) * amp
    noise_y = (math.cos(t * 2.9 + 0.5) * 0.5
             + math.cos(t * 5.3 + 0.7) * 0.3
             + math.cos(t * 11.7 + 1.9) * 0.15) * amp
    target_x = max(0.0, min(7.0, target_x + noise_x))
    target_y = max(0.0, min(15.0, target_y + noise_y))

    # Jump on melody transients, drift otherwise
    is_onset = mel_delta > 0.12
    lerp = 0.5 if is_onset else 0.08
    _node_x += (target_x - _node_x) * lerp
    _node_y += (target_y - _node_y) * lerp

    # Color from dominant mel band
    dom = 0
    dom_val = 0.0
    for i in range(8):
        if mel[i] > dom_val:
            dom_val = mel[i]
            dom = i
    cr, cg, cb = _COLORS[dom]
    intensity = min(mel_total * 2.5, 1.0)

    # Add to trail when melody is audible
    if intensity > 0.03:
        _trail.append((_node_x, _node_y, cr * intensity, cg * intensity, cb * intensity))
    if len(_trail) > _TRAIL_MAX:
        _trail = _trail[-_TRAIL_MAX:]

    # ── Build 8x16 pixel grid ──
    grid = np.zeros((8, 16, 3), dtype=np.float32)

    # Layer 1: Kick = bottom 8 pixels (white), Snare = top 8 pixels (orange)
    if kick > 0.05:
        k2 = kick * kick
        grid[:, :8, 0] = k2
        grid[:, :8, 1] = k2 * 0.98
        grid[:, :8, 2] = k2 * 0.95

    if snare > 0.05:
        s2 = snare * snare
        grid[:, 8:, 0] = s2
        grid[:, 8:, 1] = s2 * 0.5
        grid[:, 8:, 2] = s2 * 0.08

    # Layer 2: Melody trail (takes precedence via max blending)
    n_trail = len(_trail)
    for i in range(n_trail):
        tx, ty, tr, tg, tb = _trail[i]
        # Newest = brightest, oldest = faintest
        age_frac = i / max(n_trail - 1, 1)  # 0=oldest, 1=newest
        fade = age_frac * age_frac
        # Gaussian splat onto nearby pixels
        ix_lo = max(0, int(tx) - 1)
        ix_hi = min(8, int(tx) + 3)
        iy_lo = max(0, int(ty) - 1)
        iy_hi = min(16, int(ty) + 3)
        for ox in range(ix_lo, ix_hi):
            for oy in range(iy_lo, iy_hi):
                dx = tx - ox
                dy = ty - oy
                d2 = dx * dx + dy * dy
                w = fade * math.exp(-d2 * 1.0)
                if w > 0.015:
                    grid[ox, oy, 0] = max(grid[ox, oy, 0], tr * w)
                    grid[ox, oy, 1] = max(grid[ox, oy, 1], tg * w)
                    grid[ox, oy, 2] = max(grid[ox, oy, 2], tb * w)

    # Debug
    if _frame % 60 == 1:
        debug('t={:.1f} k={:.2f} s={:.2f} node=({:.1f},{:.1f}) mel={:.2f}'.format(
            elapsed, kick, snare, _node_x, _node_y, mel_total))

    # HUD
    t_sec = states[idx].get('time', 0.0)
    lbl = op('/project1/info_label')
    if lbl is not None:
        try:
            lbl.par.text = '[{:.0f}s] K={:.2f} S={:.2f} node=({:.1f},{:.1f})'.format(
                t_sec, kick, snare, _node_x, _node_y)
        except:
            pass

    # ── Render grid to image ──
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
            yc = bot + int((px + 0.5) * ph)
            y1 = max(0, yc - ph // 2 + gap)
            y2 = min(H, yc + ph // 2 - gap)

            # Outline
            _img[y1:y2, x1:x2, 0] = np.maximum(_img[y1:y2, x1:x2, 0], 0.06)
            _img[y1:y2, x1:x2, 1] = np.maximum(_img[y1:y2, x1:x2, 1], 0.06)
            _img[y1:y2, x1:x2, 2] = np.maximum(_img[y1:y2, x1:x2, 2], 0.08)

            r = min(float(grid[tube, px, 0]), 1.0)
            g = min(float(grid[tube, px, 1]), 1.0)
            b = min(float(grid[tube, px, 2]), 1.0)
            if max(r, g, b) > 0.02:
                ix1, ix2 = x1 + 1, x2 - 1
                iy1, iy2 = y1 + 1, y2 - 1
                if ix2 > ix1 and iy2 > iy1:
                    _img[iy1:iy2, ix1:ix2, 0] = r
                    _img[iy1:iy2, ix1:ix2, 1] = g
                    _img[iy1:iy2, ix1:ix2, 2] = b

    scriptOp.copyNumpyArray(_img)
'''
render_code.nodeX, render_code.nodeY = 0, 0
print("  [+] render_code")

tube_render = p.create(scriptTOP, 'tube_render')
tube_render.setInputs([pulse])
for pn in ['callbacks', 'callbackdat', 'dat']:
    try:
        setattr(tube_render.par, pn, 'render_code')
        print("  Script TOP callback param: par.{} = 'render_code'".format(pn))
        break
    except:
        continue
try:
    tube_render.par.resolutionw = W
    tube_render.par.resolutionh = H
except:
    pass
tube_render.nodeX, tube_render.nodeY = 200, 200
print("  [+] tube_render (Script TOP, {}x{})".format(W, H))

# ══════════════════════════════════════════════
# 4. HUD LABEL
# ══════════════════════════════════════════════

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
for rw, rh in [('resolutionw', 'resolutionh'), ('resx', 'resy')]:
    try:
        setattr(info_label.par, rw, W)
        setattr(info_label.par, rh, H)
        break
    except:
        continue
try:
    info_label.par.alignx = 0
    info_label.par.aligny = 2
except:
    pass
try:
    info_label.par.fontcolorr = 0.8
    info_label.par.fontcolorg = 0.8
    info_label.par.fontcolorb = 0.8
except:
    pass
try:
    info_label.par.bgcolorr = 0
    info_label.par.bgcolorg = 0
    info_label.par.bgcolorb = 0
    info_label.par.bgalpha = 0
except:
    pass
info_label.nodeX, info_label.nodeY = 200, -100
print("  [+] info_label")

# ══════════════════════════════════════════════
# 5. COMPOSITE + OUTPUT
# ══════════════════════════════════════════════

final_comp = p.create(compositeTOP, 'final_comp')
final_comp.setInputs([tube_render, info_label])
try:
    final_comp.par.operand = 0
except:
    pass
final_comp.nodeX, final_comp.nodeY = 400, 0

out = p.create(nullTOP, 'out')
out.setInputs([final_comp])
out.nodeX, out.nodeY = 600, 0
print("  [+] out")

print("""
=== READY ===
Right-click 'out' > View

Layers:
  1. Kick  → bottom 8 pixels (white flash)
  2. Snare → top 8 pixels (orange flash)
  3. Melody node + trail (colored, dances across grid, overrides 1&2)

Watch Textport for: t=... k=... s=... node=(x,y) mel=...
""")
