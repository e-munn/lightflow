# === LightFlow v2 - Multi-Stem Reactive Visualizer ===
#
# Receives 6 stem energies via OSC from stem_server.py and drives
# 6 independent visual layers:
#   Bass:   Large pulsating circle, deep red/purple, slow attack
#   Kick:   Full-screen white flash, instant attack/fast decay
#   Snare:  Orange accent flash, slightly slower than kick
#   Hats:   Small bright particles, cyan/white, fast flicker
#   Vocals: Smooth flowing color band, blue/pink gradient
#   Other:  3D spectral dots (existing network), center of screen
#
# Run in Textport:
#   exec(open('/Users/elijah/code/lightflow/v2/td_stems.py').read())
#
# Then start the stem server:
#   python stem_server.py "Talk of the Town_stems.json" --audio "~/Desktop/Talk of the Town.mp3"

p = op('/project1')

# ── Nuke everything (except _watcher nodes for hot reload) ──
for c in p.children:
    if c.name.startswith('_'):
        continue
    try:
        c.destroy()
    except:
        pass

print("Building multi-stem visualizer...")

W, H = 1920, 1080

# ══════════════════════════════════════════════
# 1. OSC INPUT (receives from stem_server.py)
# ══════════════════════════════════════════════

oscin = p.create(oscinCHOP, 'osc_in')
try:
    oscin.par.port = 7000
except:
    pass
try:
    oscin.par.active = True
except:
    pass
oscin.nodeX, oscin.nodeY = -800, 600
print("  [+] osc_in (port 7000)")

# ── Parse OSC into named channels via Script CHOP ──
parse_code = p.create(textDAT, 'parse_code')
parse_code.text = r'''def cook(scriptOp):
    scriptOp.clear()
    scriptOp.numSamples = 1
    osc = op('/project1/osc_in')
    if osc is None or osc.numChans == 0:
        # Output zeros when no OSC data
        for name in ['bass','kick','snare','hat','vocals','other','centroid','time']:
            c = scriptOp.appendChan(name)
            c[0] = 0.0
        return
    # Map OSC addresses to channel names
    mapping = {
        '/stem/bass': 'bass',
        '/stem/kick': 'kick',
        '/stem/snare': 'snare',
        '/stem/hat': 'hat',
        '/stem/vocals': 'vocals',
        '/stem/other': 'other',
        '/stem/centroid': 'centroid',
        '/stem/time': 'time',
    }
    found = {}
    for i in range(osc.numChans):
        ch = osc[i]
        name = ch.name
        # OSC channels often come as address:0, address:1 etc
        for addr, short in mapping.items():
            clean = addr.replace('/', ':')
            if name.startswith(clean) or name == addr or short in name.lower():
                found[short] = ch[0]
                break
    for name in ['bass','kick','snare','hat','vocals','other','centroid','time']:
        c = scriptOp.appendChan(name)
        c[0] = found.get(name, 0.0)
'''
parse_code.nodeX, parse_code.nodeY = -600, 400

parse = p.create(scriptCHOP, 'stems')
parse.setInputs([oscin])
for pn in ['callbacks', 'callbackdat', 'dat']:
    try:
        setattr(parse.par, pn, 'parse_code')
        break
    except:
        continue
parse.nodeX, parse.nodeY = -400, 600
print("  [+] stems (parsed)")

# ══════════════════════════════════════════════
# 2. SMOOTHING (attack/release per stem)
# ══════════════════════════════════════════════

smooth_code = p.create(textDAT, 'smooth_code')
smooth_code.text = r'''# Attack/release smoothing for each stem
# attack = how fast it rises (1=instant), release = how fast it falls
import math

_state = {}
_config = {
    'bass':    {'attack': 0.4, 'release': 0.08},
    'kick':    {'attack': 0.95, 'release': 0.3},
    'snare':   {'attack': 0.9, 'release': 0.2},
    'hat':     {'attack': 0.85, 'release': 0.4},
    'vocals':  {'attack': 0.15, 'release': 0.05},
    'other':   {'attack': 0.3, 'release': 0.1},
}

def cook(scriptOp):
    global _state
    src = scriptOp.inputs[0]
    if src is None or src.numSamples == 0:
        return
    scriptOp.clear()
    scriptOp.numSamples = 1
    for name, cfg in _config.items():
        raw = 0.0
        try:
            raw = float(src[name][0])
        except:
            pass
        prev = _state.get(name, 0.0)
        if raw > prev:
            val = prev + (raw - prev) * cfg['attack']
        else:
            val = prev + (raw - prev) * cfg['release']
        _state[name] = val
        c = scriptOp.appendChan(name)
        c[0] = val
    # Pass through centroid and time unsmoothed
    for passthru in ['centroid', 'time']:
        v = 0.0
        try:
            v = float(src[passthru][0])
        except:
            pass
        c = scriptOp.appendChan(passthru)
        c[0] = v
'''
smooth_code.nodeX, smooth_code.nodeY = -200, 400

smooth = p.create(scriptCHOP, 'smooth')
smooth.setInputs([parse])
for pn in ['callbacks', 'callbackdat', 'dat']:
    try:
        setattr(smooth.par, pn, 'smooth_code')
        break
    except:
        continue
smooth.nodeX, smooth.nodeY = -200, 600
print("  [+] smooth (attack/release)")

# ══════════════════════════════════════════════
# 3. VISUAL LAYERS (one per stem)
# ══════════════════════════════════════════════

# ── 3a. BASS: Pulsating circle, deep red/purple ──
bass_code = p.create(textDAT, 'bass_glsl')
bass_code.text = r'''// Bass: pulsating circle, red/purple
uniform float energy;
out vec4 fragColor;
void main() {
    vec2 uv = vUV.st - 0.5;
    uv.y *= iResolution.y / iResolution.x;
    float r = length(uv);
    float pulse = 0.15 + energy * 0.35;
    float glow = smoothstep(pulse, pulse * 0.3, r);
    float outer = smoothstep(pulse * 1.5, pulse * 0.5, r) * 0.3;
    vec3 col = mix(vec3(0.3, 0.0, 0.5), vec3(0.8, 0.0, 0.2), energy);
    fragColor = vec4(col * (glow + outer) * energy, glow * energy);
}
'''
bass_code.nodeX, bass_code.nodeY = 0, 1000

bass_top = p.create(glslTOP, 'bass_layer')
try:
    bass_top.par.glslversion = '3.30'
except:
    pass
try:
    bass_top.par.dat = 'bass_glsl'
    bass_top.par.pixeldat = 'bass_glsl'
except:
    pass
try:
    bass_top.par.resolutionw = W
    bass_top.par.resolutionh = H
except:
    pass
bass_top.nodeX, bass_top.nodeY = 200, 1000
print("  [+] bass_layer (GLSL pulse)")

# ── 3b. KICK: Full-screen white flash ──
kick_code = p.create(textDAT, 'kick_glsl')
kick_code.text = r'''// Kick: full white flash
uniform float energy;
out vec4 fragColor;
void main() {
    float e = pow(energy, 0.5);
    fragColor = vec4(e, e, e * 0.95, e);
}
'''
kick_code.nodeX, kick_code.nodeY = 0, 800

kick_top = p.create(glslTOP, 'kick_layer')
try:
    kick_top.par.dat = 'kick_glsl'
    kick_top.par.pixeldat = 'kick_glsl'
except:
    pass
try:
    kick_top.par.resolutionw = W
    kick_top.par.resolutionh = H
except:
    pass
kick_top.nodeX, kick_top.nodeY = 200, 800
print("  [+] kick_layer (white flash)")

# ── 3c. SNARE: Orange accent flash ──
snare_code = p.create(textDAT, 'snare_glsl')
snare_code.text = r'''// Snare: orange accent flash
uniform float energy;
out vec4 fragColor;
void main() {
    vec2 uv = vUV.st - 0.5;
    float r = length(uv);
    float ring = smoothstep(0.3, 0.25, r) * smoothstep(0.15, 0.2, r);
    float flash = ring + smoothstep(0.2, 0.0, r) * 0.3;
    vec3 col = vec3(1.0, 0.5, 0.1) * flash * energy;
    fragColor = vec4(col, flash * energy);
}
'''
snare_code.nodeX, snare_code.nodeY = 0, 600

snare_top = p.create(glslTOP, 'snare_layer')
try:
    snare_top.par.dat = 'snare_glsl'
    snare_top.par.pixeldat = 'snare_glsl'
except:
    pass
try:
    snare_top.par.resolutionw = W
    snare_top.par.resolutionh = H
except:
    pass
snare_top.nodeX, snare_top.nodeY = 200, 600
print("  [+] snare_layer (orange ring)")

# ── 3d. HATS: Scattered particles, cyan/white ──
hat_code = p.create(textDAT, 'hat_glsl')
hat_code.text = r'''// Hats: scattered sparkle particles
uniform float energy;
uniform float time_val;
out vec4 fragColor;
void main() {
    vec2 uv = vUV.st;
    // Pseudo-random sparkle based on UV and time
    float t = time_val * 3.0;
    vec2 grid = floor(uv * 30.0);
    float rnd = fract(sin(dot(grid, vec2(12.9898, 78.233)) + t) * 43758.5453);
    float sparkle = step(1.0 - energy * 0.4, rnd);
    // Only in upper half of screen
    sparkle *= smoothstep(0.3, 0.7, uv.y);
    // Tiny dots
    vec2 cell_uv = fract(uv * 30.0) - 0.5;
    float dot_r = length(cell_uv);
    float dot_mask = smoothstep(0.15, 0.05, dot_r);
    float val = sparkle * dot_mask * energy;
    vec3 col = mix(vec3(0.5, 1.0, 1.0), vec3(1.0, 1.0, 1.0), rnd);
    fragColor = vec4(col * val, val);
}
'''
hat_code.nodeX, hat_code.nodeY = 0, 400

hat_top = p.create(glslTOP, 'hat_layer')
try:
    hat_top.par.dat = 'hat_glsl'
    hat_top.par.pixeldat = 'hat_glsl'
except:
    pass
try:
    hat_top.par.resolutionw = W
    hat_top.par.resolutionh = H
except:
    pass
hat_top.nodeX, hat_top.nodeY = 200, 400
print("  [+] hat_layer (sparkle particles)")

# ── 3e. VOCALS: Smooth flowing color band ──
vocal_code = p.create(textDAT, 'vocal_glsl')
vocal_code.text = r'''// Vocals: horizontal flowing band, blue/pink gradient
uniform float energy;
uniform float centroid;
uniform float time_val;
out vec4 fragColor;
void main() {
    vec2 uv = vUV.st;
    // Horizontal band in middle area
    float band = smoothstep(0.55, 0.5, abs(uv.y - 0.5));
    // Flowing wave
    float wave = sin(uv.x * 6.0 + time_val * 2.0) * 0.02 * energy;
    band *= smoothstep(0.08, 0.02, abs(uv.y - 0.5 + wave));
    // Color from centroid: low=blue, high=pink
    float t = clamp(centroid / 4000.0, 0.0, 1.0);
    vec3 col = mix(vec3(0.2, 0.3, 0.9), vec3(0.9, 0.2, 0.6), t);
    float alpha = band * energy * 0.8;
    fragColor = vec4(col * alpha, alpha);
}
'''
vocal_code.nodeX, vocal_code.nodeY = 0, 200

vocal_top = p.create(glslTOP, 'vocal_layer')
try:
    vocal_top.par.dat = 'vocal_glsl'
    vocal_top.par.pixeldat = 'vocal_glsl'
except:
    pass
try:
    vocal_top.par.resolutionw = W
    vocal_top.par.resolutionh = H
except:
    pass
vocal_top.nodeX, vocal_top.nodeY = 200, 200
print("  [+] vocal_layer (flowing band)")

# ── 3f. OTHER/MELODY: Background glow with spectral color ──
other_code = p.create(textDAT, 'other_glsl')
other_code.text = r'''// Other/melody: ambient background glow
uniform float energy;
uniform float centroid;
uniform float time_val;
out vec4 fragColor;
void main() {
    vec2 uv = vUV.st - 0.5;
    float r = length(uv);
    // Soft ambient glow from center
    float glow = smoothstep(0.8, 0.0, r) * 0.4;
    // Color follows centroid
    float t = clamp(centroid / 5000.0, 0.0, 1.0);
    vec3 col;
    if (t < 0.33) {
        col = mix(vec3(0.1, 0.0, 0.3), vec3(0.0, 0.2, 0.5), t * 3.0);
    } else if (t < 0.66) {
        col = mix(vec3(0.0, 0.2, 0.5), vec3(0.3, 0.1, 0.0), (t - 0.33) * 3.0);
    } else {
        col = mix(vec3(0.3, 0.1, 0.0), vec3(0.5, 0.3, 0.0), (t - 0.66) * 3.0);
    }
    float alpha = glow * energy;
    fragColor = vec4(col * alpha, alpha);
}
'''
other_code.nodeX, other_code.nodeY = 0, 0

other_top = p.create(glslTOP, 'other_layer')
try:
    other_top.par.dat = 'other_glsl'
    other_top.par.pixeldat = 'other_glsl'
except:
    pass
try:
    other_top.par.resolutionw = W
    other_top.par.resolutionh = H
except:
    pass
other_top.nodeX, other_top.nodeY = 200, 0
print("  [+] other_layer (ambient glow)")

# ══════════════════════════════════════════════
# 4. UNIFORM DRIVER (Script CHOP → GLSL uniforms)
# ══════════════════════════════════════════════

# We need a Script DAT that runs every frame to push stem values
# into GLSL uniform parameters. Use an Execute DAT for this.

driver_code = p.create(textDAT, 'driver_code')
driver_code.text = r'''# Runs every frame to push stem values into GLSL uniforms
def onFrameStart(frame):
    s = op('/project1/smooth')
    if s is None or s.numChans == 0:
        return
    def val(name):
        try:
            return float(s[name][0])
        except:
            return 0.0
    bass = val('bass')
    kick = val('kick')
    snare = val('snare')
    hat = val('hat')
    vocals = val('vocals')
    other = val('other')
    centroid = val('centroid')
    t = val('time')
    # Push to GLSL TOPs
    layers = {
        'bass_layer': {'energy': bass},
        'kick_layer': {'energy': kick},
        'snare_layer': {'energy': snare},
        'hat_layer': {'energy': hat, 'time_val': t},
        'vocal_layer': {'energy': vocals, 'centroid': centroid, 'time_val': t},
        'other_layer': {'energy': other, 'centroid': centroid, 'time_val': t},
    }
    for node_name, uniforms in layers.items():
        node = op('/project1/' + node_name)
        if node is None:
            continue
        for uname, uval in uniforms.items():
            pname = 'value' + uname.title().replace('_','')
            try:
                setattr(node.par, pname, uval)
            except:
                pass
'''
driver_code.nodeX, driver_code.nodeY = -600, 0

driver = p.create(executeDAT, 'driver')
try:
    driver.par.onframestart = True
    driver.par.onframeend = False
except:
    pass
for pn in ['dat', 'executedat']:
    try:
        setattr(driver.par, pn, 'driver_code')
        break
    except:
        continue
driver.nodeX, driver.nodeY = -600, -200
print("  [+] driver (uniform pusher)")

# ══════════════════════════════════════════════
# 5. COMPOSITE ALL LAYERS
# ══════════════════════════════════════════════

# Background
bg = p.create(constantTOP, 'bg')
try:
    bg.par.colorr = 0.02
    bg.par.colorg = 0.02
    bg.par.colorb = 0.05
except:
    pass
try:
    bg.par.resolutionw = W
    bg.par.resolutionh = H
except:
    pass
bg.nodeX, bg.nodeY = 600, 1000
print("  [+] bg")

# Layer compositing chain: bg + other + bass + vocals + snare + kick + hats
# Using Add blend for light-on-dark compositing
layer_order = ['other_layer', 'bass_layer', 'vocal_layer', 'snare_layer', 'kick_layer', 'hat_layer']

prev = bg
y_pos = 800
for i, layer_name in enumerate(layer_order):
    comp = p.create(compositeTOP, 'mix_{}'.format(i))
    layer_node = op('/project1/' + layer_name)
    comp.setInputs([prev, layer_node])
    try:
        comp.par.operand = 1  # Add
    except:
        pass
    comp.nodeX, comp.nodeY = 600, y_pos
    prev = comp
    y_pos -= 150

print("  [+] composite chain (6 layers)")

# ── Text overlay with stem levels ──
info_code = p.create(textDAT, 'info_code')
info_code.text = r'''# Generate stem level readout text
def onFrameStart(frame):
    s = op('/project1/smooth')
    if s is None or s.numChans == 0:
        return
    def val(name):
        try:
            return float(s[name][0])
        except:
            return 0.0
    t = val('time')
    lines = []
    for name, label, color in [
        ('bass', 'BASS', 'red'),
        ('kick', 'KICK', 'white'),
        ('snare', 'SNARE', 'orange'),
        ('hat', 'HATS', 'cyan'),
        ('vocals', 'VOCAL', 'pink'),
        ('other', 'OTHER', 'purple'),
    ]:
        v = val(name)
        bar = '#' * int(v * 20)
        lines.append('{:5s} {:20s} {:.2f}'.format(label, bar, v))
    txt = 'STEMS  [{:.1f}s]\n'.format(t) + '\n'.join(lines)
    label = op('/project1/info_label')
    if label is not None:
        try:
            label.par.text = txt
        except:
            pass
'''
info_code.nodeX, info_code.nodeY = 400, -400

info_exec = p.create(executeDAT, 'info_exec')
try:
    info_exec.par.onframestart = True
    info_exec.par.onframeend = False
except:
    pass
for pn in ['dat', 'executedat']:
    try:
        setattr(info_exec.par, pn, 'info_code')
        break
    except:
        continue
info_exec.nodeX, info_exec.nodeY = 400, -600

info_label = p.create(textTOP, 'info_label')
try:
    info_label.par.text = 'STEMS  [waiting for OSC...]'
except:
    pass
try:
    info_label.par.fontsizex = 14
except:
    try:
        info_label.par.fontsize = 14
    except:
        pass
try:
    info_label.par.resolutionw = W
    info_label.par.resolutionh = H
except:
    pass
try:
    info_label.par.alignx = 0
    info_label.par.aligny = 2  # top
except:
    pass
try:
    info_label.par.fontcolorr = 0.7
    info_label.par.fontcolorg = 0.7
    info_label.par.fontcolorb = 0.7
except:
    pass
try:
    info_label.par.bgcolorr = 0
    info_label.par.bgcolorg = 0
    info_label.par.bgcolorb = 0
    info_label.par.bgalpha = 0
except:
    pass
info_label.nodeX, info_label.nodeY = 600, -400
print("  [+] info_label (HUD)")

# Overlay info on composite
final_comp = p.create(compositeTOP, 'final_comp')
final_comp.setInputs([prev, info_label])
try:
    final_comp.par.operand = 0  # Over
except:
    pass
final_comp.nodeX, final_comp.nodeY = 800, -200

out = p.create(nullTOP, 'out')
out.setInputs([final_comp])
out.nodeX, out.nodeY = 1000, -200
print("  [+] out")

print("""
=== MULTI-STEM VISUALIZER READY ===

Right-click 'out' > View

Then start the stem server:
  cd /Users/elijah/code/lightflow/v2
  python stem_server.py "Talk of the Town_stems.json" --audio "~/Desktop/Talk of the Town.mp3"

Layers:
  BASS   - Red/purple pulsating circle (bottom)
  KICK   - Full white flash
  SNARE  - Orange ring accent
  HATS   - Cyan sparkle particles (top)
  VOCALS - Flowing blue/pink band (middle)
  OTHER  - Ambient background glow

Note: GLSL uniforms are pushed via the 'driver' Execute DAT.
If uniforms don't connect automatically, manually set them:
  - Each GLSL TOP needs uniform0name = 'energy', uniform0value = 0
  - hat/vocal/other also need 'time_val' and/or 'centroid'
""")
