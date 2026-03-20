# === LightFlow v2 - 3D Spectral Network (Arese-style) ===
#
# Run in Textport:
#   exec(open('/Users/elijah/code/lightflow/v2/td_network.py').read())

p = op('/project1')

# ── Nuke everything (except _watcher nodes for hot reload) ──
for c in p.children:
    if c.name.startswith('_'):
        continue
    try:
        c.destroy()
    except:
        pass

print("Building spectral network...")

# ══════════════════════════════════════════════
# 1. AUDIO INPUT (file playback + speaker output)
# ══════════════════════════════════════════════

AUDIO_FILE = '/Users/elijah/Desktop/hi_bich_2.wav'

audio = p.create(audiofileinCHOP, 'audio')
audio.par.file = AUDIO_FILE
try:
    audio.par.playmode = 2  # Sequential (independent of timeline)
except:
    pass
try:
    audio.par.play = True
except:
    pass
try:
    audio.par.volume = 0.8
except:
    pass
audio.nodeX, audio.nodeY = -800, 400
print("  [+] audio")

audio_out = p.create(audiodeviceoutCHOP, 'audio_out')
audio_out.setInputs([audio])
audio_out.nodeX, audio_out.nodeY = -800, 200
print("  [+] audio_out")

spec = p.create(audiospectrumCHOP, 'spectrum')
spec.setInputs([audio])
spec.par.frequencylog = 0
try:
    spec.par.outputmenu = 1
    spec.par.outlength = 256
except:
    pass
spec.nodeX, spec.nodeY = -400, 400
print("  [+] spectrum")

# ══════════════════════════════════════════════
# 2. FEATURE EXTRACTION (Script CHOP)
# ══════════════════════════════════════════════

features_code = p.create(textDAT, 'features_code')
features_code.text = r'''import math

def cook(scriptOp):
    spec = scriptOp.inputs[0]
    if spec is None or spec.numSamples == 0:
        return

    n = spec.numSamples
    sr = 44100.0
    max_freq = sr / 2.0
    bin_hz = max_freq / n

    mags = []
    for i in range(n):
        mags.append(abs(spec['chan1'][i]))

    total = sum(mags) + 1e-10

    # Spectral Centroid (Hz)
    centroid = 0.0
    for i in range(n):
        centroid += (i * bin_hz) * mags[i]
    centroid /= total

    # Spectral Spread (Hz)
    spread = 0.0
    for i in range(n):
        spread += mags[i] * ((i * bin_hz) - centroid) ** 2
    spread = math.sqrt(spread / total)

    # RMS (energy)
    rms = math.sqrt(sum(m * m for m in mags) / max(n, 1))

    # Spectral Flatness (0=tonal, 1=noise)
    log_sum = sum(math.log(m + 1e-10) for m in mags)
    geo_mean = math.exp(log_sum / n)
    arith_mean = total / n
    flatness = geo_mean / (arith_mean + 1e-10)

    # ── Map to 3D (centered around origin) ──
    x = max(-5.0, min(5.0, (centroid / 3000.0 - 1.0) * 4.0))
    y = max(-4.0, min(4.0, (spread / 3000.0 - 0.5) * 8.0))
    z = (flatness - 0.5) * 6.0

    # Size varies with energy (RMS) - wide dynamic range
    size = min(1.0, max(0.05, rms * 20.0))

    # Color: centroid -> blue -> magenta -> red -> yellow
    t = min(1.0, max(0.0, centroid / 5000.0))
    if t < 0.25:
        cr, cg, cb = 0.15 + t*2, 0.05, 0.7 + t*1.2
    elif t < 0.5:
        cr, cg, cb = 0.7 + (t-0.25)*1.2, 0.05, 1.0 - (t-0.25)*4
    elif t < 0.75:
        cr, cg, cb = 1.0, (t-0.5)*4, 0.0
    else:
        cr, cg, cb = 1.0, 1.0, (t-0.75)*4

    scriptOp.clear()
    scriptOp.numSamples = 1
    for name, val in [('tx',x),('ty',y),('tz',z),
                      ('sx',size),('sy',size),('sz',size),
                      ('cr',cr),('cg',cg),('cb',cb)]:
        c = scriptOp.appendChan(name)
        c[0] = val
'''
features_code.nodeX, features_code.nodeY = 0, 200

features = p.create(scriptCHOP, 'features')
features.setInputs([spec])
for pn in ['callbacks', 'callbackdat', 'dat']:
    try:
        setattr(features.par, pn, 'features_code')
        break
    except:
        continue
features.nodeX, features.nodeY = 0, 400
print("  [+] features")

# ══════════════════════════════════════════════
# 3. TRAIL (3 seconds of history - short & responsive)
# ══════════════════════════════════════════════

trail = p.create(trailCHOP, 'trail')
trail.setInputs([features])
try:
    trail.par.wlength = 3
except:
    pass
trail.nodeX, trail.nodeY = 400, 400
print("  [+] trail (3s)")

# ══════════════════════════════════════════════
# 4. MATERIALS
# ══════════════════════════════════════════════

sphere_mat = p.create(phongMAT, 'sphere_mat')
try:
    sphere_mat.par.colorr = 1.0
    sphere_mat.par.colorg = 1.0
    sphere_mat.par.colorb = 1.0
except:
    pass
sphere_mat.nodeX, sphere_mat.nodeY = -200, -200
print("  [+] sphere_mat")

line_mat = p.create(phongMAT, 'line_mat')
try:
    line_mat.par.colorr = 0.3
    line_mat.par.colorg = 0.3
    line_mat.par.colorb = 0.5
except:
    pass
line_mat.nodeX, line_mat.nodeY = -200, -400
print("  [+] line_mat")

axis_mat = p.create(phongMAT, 'axis_mat')
try:
    axis_mat.par.colorr = 0.4
    axis_mat.par.colorg = 0.4
    axis_mat.par.colorb = 0.4
except:
    pass
axis_mat.nodeX, axis_mat.nodeY = -200, -600
print("  [+] axis_mat")

# ══════════════════════════════════════════════
# 5. POINT GEOMETRY (instanced boxes as dots)
# ══════════════════════════════════════════════

geo = p.create(geometryCOMP, 'spheres')
geo.nodeX, geo.nodeY = 200, -200

# Delete the default torus
for c in geo.children:
    try:
        c.destroy()
    except:
        pass

box = geo.create(boxSOP, 'dot')
box.par.sizex = 0.12
box.par.sizey = 0.12
box.par.sizez = 0.12
try:
    box.display = True
    box.render = True
except:
    try:
        box.displayFlag = True
        box.renderFlag = True
    except:
        pass
print("  [+] dot (box)")

geo.par.material = '/project1/sphere_mat'
geo.par.instancing = 1
geo.par.instanceop = '/project1/trail'
geo.par.instancetx = 'tx'
geo.par.instancety = 'ty'
geo.par.instancetz = 'tz'
geo.par.instancesx = 'sx'
geo.par.instancesy = 'sy'
geo.par.instancesz = 'sz'
geo.par.instancer = 'cr'
geo.par.instanceg = 'cg'
geo.par.instanceb = 'cb'
print("  [+] spheres (instanced)")

# ══════════════════════════════════════════════
# 6. CONNECTING LINES (Script SOP)
# ══════════════════════════════════════════════

lines_geo = p.create(geometryCOMP, 'lines')
lines_geo.nodeX, lines_geo.nodeY = 200, -400

for c in lines_geo.children:
    try:
        c.destroy()
    except:
        pass

lines_code = lines_geo.create(textDAT, 'lines_code')
lines_code.text = r'''def cook(scriptSOP):
    scriptSOP.clear()
    trail = op('/project1/trail')
    if trail is None or trail.numSamples < 2:
        return
    n = trail.numSamples
    points = []
    for i in range(n):
        pt = scriptSOP.appendPoint()
        pt.x = trail['tx'][i]
        pt.y = trail['ty'][i]
        pt.z = trail['tz'][i]
        points.append(pt)
    poly = scriptSOP.appendPoly(n, closed=False)
    for i in range(n):
        poly[i].point = points[i]
'''

lines_sop = lines_geo.create(scriptSOP, 'line_draw')
for pn in ['callbacks', 'callbackdat', 'dat']:
    try:
        setattr(lines_sop.par, pn, 'lines_code')
        break
    except:
        continue
try:
    lines_sop.display = True
    lines_sop.render = True
except:
    pass

lines_geo.par.material = '/project1/line_mat'
print("  [+] lines")

# ══════════════════════════════════════════════
# 7. 3D AXIS LINES + LABELS
# ══════════════════════════════════════════════

axes_geo = p.create(geometryCOMP, 'axes')
axes_geo.nodeX, axes_geo.nodeY = 200, -600

for c in axes_geo.children:
    try:
        c.destroy()
    except:
        pass

axes_code = axes_geo.create(textDAT, 'axes_code')
axes_code.text = r'''def cook(scriptSOP):
    scriptSOP.clear()

    # X axis: Spectral Centroid (-5 to 5)
    p0 = scriptSOP.appendPoint(); p0.x, p0.y, p0.z = -5, -4, -3
    p1 = scriptSOP.appendPoint(); p1.x, p1.y, p1.z = 5, -4, -3
    line = scriptSOP.appendPoly(2, closed=False)
    line[0].point = p0; line[1].point = p1

    # Y axis: Spectral Spread (-4 to 4)
    p2 = scriptSOP.appendPoint(); p2.x, p2.y, p2.z = -5, -4, -3
    p3 = scriptSOP.appendPoint(); p3.x, p3.y, p3.z = -5, 4, -3
    line2 = scriptSOP.appendPoly(2, closed=False)
    line2[0].point = p2; line2[1].point = p3

    # Z axis: Flatness (-3 to 3)
    p4 = scriptSOP.appendPoint(); p4.x, p4.y, p4.z = -5, -4, -3
    p5 = scriptSOP.appendPoint(); p5.x, p5.y, p5.z = -5, -4, 3
    line3 = scriptSOP.appendPoly(2, closed=False)
    line3[0].point = p4; line3[1].point = p5

    # Tick marks on X axis
    for i in range(-4, 5, 2):
        t0 = scriptSOP.appendPoint(); t0.x, t0.y, t0.z = i, -4, -3
        t1 = scriptSOP.appendPoint(); t1.x, t1.y, t1.z = i, -3.8, -3
        tick = scriptSOP.appendPoly(2, closed=False)
        tick[0].point = t0; tick[1].point = t1

    # Tick marks on Y axis
    for i in range(-3, 4, 2):
        t0 = scriptSOP.appendPoint(); t0.x, t0.y, t0.z = -5, i, -3
        t1 = scriptSOP.appendPoint(); t1.x, t1.y, t1.z = -4.8, i, -3
        tick = scriptSOP.appendPoly(2, closed=False)
        tick[0].point = t0; tick[1].point = t1
'''

axes_sop = axes_geo.create(scriptSOP, 'axes_draw')
for pn in ['callbacks', 'callbackdat', 'dat']:
    try:
        setattr(axes_sop.par, pn, 'axes_code')
        break
    except:
        continue
try:
    axes_sop.display = True
    axes_sop.render = True
except:
    pass

axes_geo.par.material = '/project1/axis_mat'
print("  [+] axes (3D lines + ticks)")

# ══════════════════════════════════════════════
# 8. CAMERA + LIGHT + RENDER
# ══════════════════════════════════════════════

cam = p.create(cameraCOMP, 'cam')
cam.par.tx = 0
cam.par.ty = 0
cam.par.tz = 20
cam.par.rx = 0
cam.par.ry = 5
cam.nodeX, cam.nodeY = -400, -800
print("  [+] cam")

light = p.create(lightCOMP, 'light')
light.par.tx = 5
light.par.ty = 10
light.par.tz = 10
try:
    light.par.dimmer = 1.5
except:
    pass
light.nodeX, light.nodeY = -200, -800
print("  [+] light")

light2 = p.create(lightCOMP, 'light2')
light2.par.tx = -5
light2.par.ty = -3
light2.par.tz = 15
try:
    light2.par.dimmer = 0.8
except:
    pass
light2.nodeX, light2.nodeY = -100, -800
print("  [+] light2")

render = p.create(renderTOP, 'render')
try:
    render.par.camera = '/project1/cam'
except:
    pass
try:
    render.par.resolutionop = 'custom'
except:
    pass
try:
    render.par.resolution1 = 1280
    render.par.resolution2 = 720
except:
    pass
try:
    render.par.resx = 1280
    render.par.resy = 720
except:
    pass
try:
    render.par.resolutionw = 1280
    render.par.resolutionh = 720
except:
    pass
render.nodeX, render.nodeY = 0, -800
print("  [+] render")

# ── 2D text overlay for axis labels ──
label = p.create(textTOP, 'labels')
try:
    label.par.text = 'X: CENTROID   Y: SPREAD   Z: FLATNESS'
except:
    pass
try:
    label.par.fontsizex = 9
except:
    try:
        label.par.fontsize = 9
    except:
        pass
# Match render resolution
try:
    label.par.resolutionw = 1280
    label.par.resolutionh = 720
except:
    pass
try:
    label.par.alignx = 0  # left
    label.par.aligny = 0  # bottom
except:
    pass
try:
    label.par.fontcolorr = 0.5
    label.par.fontcolorg = 0.5
    label.par.fontcolorb = 0.5
except:
    try:
        label.par.colorr = 0.5
        label.par.colorg = 0.5
        label.par.colorb = 0.5
    except:
        pass
try:
    label.par.bgcolorr = 0
    label.par.bgcolorg = 0
    label.par.bgcolorb = 0
    label.par.bgalpha = 0
except:
    pass
label.nodeX, label.nodeY = 200, -800
print("  [+] labels")

# Composite labels over render
comp = p.create(compositeTOP, 'comp')
comp.setInputs([render, label])
try:
    comp.par.operand = 0  # Over
except:
    pass
comp.nodeX, comp.nodeY = 400, -800
print("  [+] comp (overlay)")

out = p.create(nullTOP, 'out')
out.setInputs([comp])
out.nodeX, out.nodeY = 600, -800
print("  [+] out")

print("""
=== DONE ===
Right-click 'out' > View

Changes:
  - Trail: 3s (was 10s) - less clutter, more responsive
  - Dot size: varies with RMS energy (loud=big, quiet=small)
  - 3D axis lines with tick marks
  - Axis labels overlay
  - Data centered around origin
  - Camera at slight angle for depth
""")
