# === LightFlow v2 - Spectrogram Builder for TouchDesigner ===
#
# Run this in TouchDesigner's Textport:
#   exec(open('/Users/elijah/code/lightflow/v2/td_setup.py').read())

p = op('/project1')

# Clean slate - only destroy nodes we created (by name)
our_nodes = ['mic', 'spectrum', 'amplify', 'strip', 'fb', 'scroll',
             'spectrogram', 'level', 'colormap', 'colored', 'OUT']
for name in our_nodes:
    n = op('/project1/' + name)
    if n is not None:
        n.destroy()

print("Building spectrogram network...")

# =============================================
# AUDIO CHAIN (CHOPs)
# =============================================

# Microphone input
mic = p.create(audiodeviceinCHOP, 'mic')
mic.par.active = True
mic.par.rate = 44100
mic.nodeX, mic.nodeY = -600, 300
print("  [+] mic")

# FFT spectrum analysis (512 frequency bins, log scale)
spec = p.create(audiospectrumCHOP, 'spectrum')
spec.setInputs([mic])
spec.par.frequencylog = 1
spec.par.highfreqboost = 2
# Set output to 512 bins manually
try:
    spec.par.outputmenu = 1
    spec.par.outlength = 512
except:
    print("  [!] Could not set spectrum output length - set manually to 512")
spec.nodeX, spec.nodeY = -200, 300
print("  [+] spectrum")

# Normalize spectrum to 0-1 range
amp = p.create(mathCHOP, 'amplify')
amp.setInputs([spec])
# Try different parameter names for the multiply/gain
try:
    amp.par.gain = 200
except:
    try:
        amp.par.mult = 200
    except:
        print("  [!] Could not set gain - click 'amplify', set Multiply to 200")
amp.nodeX, amp.nodeY = 200, 300
print("  [+] amplify")

# =============================================
# SPECTROGRAM DISPLAY (TOPs)
# =============================================

# Spectrum data -> 1-pixel-tall image strip (512 x 1)
strip = p.create(choptoTOP, 'strip')
strip.par.chop = 'amplify'
strip.nodeX, strip.nodeY = -600, -100
print("  [+] strip (CHOP to TOP)")

# Previous frame capture (creates the scrolling trail)
fb = p.create(feedbackTOP, 'fb')
fb.par.top = 'spectrogram'
fb.nodeX, fb.nodeY = -200, -400
print("  [+] fb (feedback)")

# Scroll previous frame down each tick
scroll = p.create(transformTOP, 'scroll')
scroll.setInputs([fb])
scroll.par.ty = -0.003
try:
    scroll.par.extend = 'zero'
except:
    pass
scroll.nodeX, scroll.nodeY = 200, -400
print("  [+] scroll")

# Layer new spectrum line over scrolled history
comp = p.create(compositeTOP, 'spectrogram')
comp.setInputs([strip, scroll])
try:
    comp.par.operand = 0  # Over
except:
    pass
# Force 512x512 output resolution
try:
    comp.par.resx = 512
    comp.par.resy = 512
except:
    try:
        comp.par.resolutionw = 512
        comp.par.resolutionh = 512
    except:
        print("  [!] Could not set resolution - set spectrogram Common > Resolution to 512x512")
comp.nodeX, comp.nodeY = 200, -100
print("  [+] spectrogram (composite)")

# =============================================
# COLOR MAPPING (heat map look)
# =============================================

# Brightness/contrast adjustment
level = p.create(levelTOP, 'level')
level.setInputs([comp])
try:
    level.par.brightness1 = 1.2
    level.par.gamma1 = 0.6
except:
    pass
level.nodeX, level.nodeY = 500, -100
print("  [+] level")

# Color gradient: black -> blue -> magenta -> yellow -> white
ramp = p.create(rampTOP, 'colormap')
try:
    ramp.par.resx = 256
    ramp.par.resy = 1
except:
    try:
        ramp.par.resolutionw = 256
        ramp.par.resolutionh = 1
    except:
        pass
ramp.nodeX, ramp.nodeY = 500, -350
print("  [+] colormap (ramp)")

# Apply color gradient to spectrogram brightness
lookup = p.create(lookupTOP, 'colored')
lookup.setInputs([level, ramp])
lookup.nodeX, lookup.nodeY = 800, -100
print("  [+] colored (lookup)")

# Clean output node
out = p.create(nullTOP, 'OUT')
out.setInputs([lookup])
out.nodeX, out.nodeY = 1100, -100
print("  [+] OUT")

print("\n=== DONE ===")
print("Right-click 'OUT' > View to see spectrogram")
print("")
print("Manual tweaks needed:")
print("  1. Click 'mic' > set Device to your microphone")
print("  2. Click 'spectrogram' > Common tab > Output Resolution > 'Specific' > 512 x 512")
print("  3. Click 'colormap' > edit the gradient colors (black->blue->purple->yellow->white)")
print("  4. If too dim: click 'amplify' > increase Gain/Multiply")
print("  5. If too fast/slow: click 'scroll' > adjust Translate Y (try -0.001 to -0.01)")
