"""Run from TouchDesigner Textport. Creates a new, standalone component."""
from pathlib import Path
import json
BASE = Path('/Users/elijah/studio/lightflow/research/touchdesigner/oscilloscope_library')
parent_op = op('/project1')
assert parent_op.op('lightflow_scopes') is None, 'Library already exists; do not overwrite it.'
root = parent_op.create(containerCOMP, 'lightflow_scopes')
root.nodeX = 0; root.nodeY = -700
root.par.w = 1100; root.par.h = 720
root.par.bgalpha = 1
root.par.bgcolorr = .018; root.par.bgcolorg = .024; root.par.bgcolorb = .034
modes = [
 ('waveform','01  Waveform','MONO WAVEFORM','Mid signal amplitude over the scope window. Rising zero-crossing trigger.'),
 ('stereo_xy','02  Stereo XY','STEREO XY','Left amplitude on X; right on Y. Mono becomes a diagonal line.'),
 ('mid_side','03  Mid / Side','MID / SIDE','Side on X, mid on Y. A narrow vertical trace indicates a centered signal.'),
 ('spectrum','04  Spectrum','LOG FREQUENCY SPECTRUM','20 Hz to 20 kHz (Nyquist limited), left to right. Display range: -72 to 0 dB.'),
 ('radial','05  Radial spectrum','RADIAL SPECTRUM','Log frequency wraps around the ring. Radius encodes spectral magnitude.'),
 ('bands','06  Band waveforms','THREE BAND WAVEFORMS','Top: 20-250 Hz / middle: 250 Hz-2 kHz / bottom: 2-20 kHz. Not separated stems.'),
 ('envelopes','07  Band envelopes','BAND ENERGY HISTORY','Mint: low / blue: mid / pink: high / gray: full-band RMS. Newest at right.'),
 ('spectrogram','08  Spectrogram','SPECTROGRAM','Time flows left to right. Log frequency rises bottom to top. Bright = stronger.'),
 ('onsets','09  Transients','TRANSIENT NOVELTY','Gold: positive spectral change / mint: RMS. Onset proxy, not a beat detector.'),
 ('stereo_history','10  Stereo history','STEREO HISTORY','Mint: correlation (-1 to +1) / pink: side share (0 to 1). Newest at right.')]
root.store('modes', modes)
page = root.appendCustomPage('Signal')
p=page.appendMenu('Source',label='Audio source')[0]; p.menuNames=['file','external']; p.menuLabels=['Audio file','External CHOP input']; p.val='file'; p.default='file'
p=page.appendFile('Audiofile',label='Song file')[0]; p.val='/Users/elijah/studio/lightflow/public/songs/visions.mp3'; p.default=p.val
for name,label,val in [('Play','Play audio',True),('Monitor','Hear audio',False),('Freeze','Freeze visuals',False),('Trigger','Trigger waveform',True),('Grid','Show grid',True)]:
 p=page.appendToggle(name,label=label)[0];p.val=val;p.default=val
page.appendPulse('Restart',label='Restart song')
p=page.appendMenu('Mode',label='Visual')[0]; p.menuNames=[m[0] for m in modes];p.menuLabels=[m[1] for m in modes];p.val='waveform';p.default='waveform'
for name,label,val,lo,hi in [('Gain','Visual gain',2.,.1,8.),('Windowms','Scope window (ms)',40.,5.,80.),('Linewidth','Line width',1.5,.5,5.)]:
 p=page.appendFloat(name,label=label)[0];p.val=val;p.default=val;p.min=lo;p.max=hi;p.normMin=lo;p.normMax=hi;p.clampMin=True;p.clampMax=True
src=root.create(audiofileinCHOP,'song');src.par.file.expr='parent().par.Audiofile';src.par.play.expr='parent().par.Play';src.par.repeat='on';src.nodeX=-650;src.nodeY=300
external=root.create(inCHOP,'external_audio');external.nodeX=-650;external.nodeY=180
sw=root.create(switchCHOP,'audio_signal');sw.inputConnectors[0].connect(src);sw.inputConnectors[1].connect(external);sw.par.index.expr='parent().par.Source.menuIndex';sw.nodeX=-420;sw.nodeY=300
monitor=root.create(audiodeviceoutCHOP,'audio_monitor');monitor.inputConnectors[0].connect(sw)
monitor.par.active.expr='parent().par.Monitor';monitor.nodeX=-180;monitor.nodeY=450
cb=root.create(textDAT,'signal_engine');cb.text=(BASE/'signal_engine.py').read_text();cb.nodeX=-420;cb.nodeY=100
tex=root.create(scriptTOP,'signal_texture');tex.par.callbacks=cb;tex.par.format='rgba32float';tex.nodeX=-180;tex.nodeY=300
shader=root.create(textDAT,'scope_shader');shader.text=(BASE/'scopes.frag').read_text();shader.nodeX=-180;shader.nodeY=100
for i,(name,label,title,desc) in enumerate(modes):
 comp=root.create(baseCOMP,name);comp.nodeX=80+(i%5)*190;comp.nodeY=300-(i//5)*180
 inp=comp.create(inTOP,'signal');inp.nodeX=-200
 gl=comp.create(glslTOP,'draw');gl.inputConnectors[0].connect(inp);gl.par.pixeldat=shader;gl.par.outputresolution='custom';gl.par.resolutionw=960;gl.par.resolutionh=540;gl.par.format='rgba8fixed'
 gl.par.vec0name='uSettings';gl.par.vec0valuex.expr='parent(2).par.Gain';gl.par.vec0valuey.expr='parent(2).par.Linewidth';gl.par.vec0valuez.expr='parent(2).par.Grid';gl.par.vec0valuew=i
 output=comp.create(outTOP,'out1');output.inputConnectors[0].connect(gl);output.nodeX=200
 comp.inputConnectors[0].connect(tex)
 comp.par.opviewer=output
 comp.comment=title+' | '+desc
select=root.create(switchTOP,'selected_visual');select.nodeX=1080;select.nodeY=300
for i,(name,*_) in enumerate(modes):select.inputConnectors[i].connect(root.op(name).outputConnectors[0])
select.par.index.expr='parent().par.Mode.menuIndex'
output=root.create(outTOP,'out1');output.inputConnectors[0].connect(select);output.nodeX=1300;output.nodeY=300

# Native panel controls; artwork output remains clean through out1.
def label(name,text,x,y,w,h,size=15,color=(.76,.82,.86)):
 t=root.create(textTOP,name+'_text');t.par.text=text;t.par.font='Inter';t.par.fontsizex=size;t.par.alignx='left';t.par.outputresolution='custom';t.par.resolutionw=w;t.par.resolutionh=h;t.par.fontcolorr,t.par.fontcolorg,t.par.fontcolorb=color
 panel=root.create(containerCOMP,name);panel.par.x=x;panel.par.y=y;panel.par.w=w;panel.par.h=h;panel.par.top=t
 return t
label('brand','LIGHTFLOW  /  SIGNAL LAB',24,655,800,45,26,(.5,1.,.81))
label('edition','10 AUDIO VIEWS    /    OSCILLOSCOPE LIBRARY 01',24,625,800,28,12)
viewer=root.create(containerCOMP,'display');viewer.par.x=236;viewer.par.y=155;viewer.par.w=840;viewer.par.h=472;viewer.par.top=select
label('view_title','',236,110,840,30,20,(.5,1.,.81)).par.text.expr="parent().fetch('modes')[parent().par.Mode.menuIndex][2]"
label('view_description','',236,78,840,28,12).par.text.expr="parent().fetch('modes')[parent().par.Mode.menuIndex][3]"
label('status','',236,42,840,26,12).par.text.expr="'GAIN %.1fx  |  WINDOW %.0f ms  |  %s  |  HISTORY 512 UPDATES' % (parent().par.Gain, parent().par.Windowms, 'FROZEN' if parent().par.Freeze else 'RUNNING')"
label('source_label','',236,16,840,24,11).par.text.expr="'SOURCE: ' + (parent().par.Audiofile.eval().split('/')[-1] if parent().par.Source == 'file' else 'EXTERNAL CHOP') + '   /   AUDIO ' + ('ON' if parent().par.Monitor else 'MUTED')"

def button(name,title,x,y,w,h,action,selected=None):
 b=root.create(buttonCOMP,name);b.par.label=title;b.par.buttontype='momentary';b.par.x=x;b.par.y=y;b.par.w=w;b.par.h=h;b.par.fontsize=14
 if selected:
  b.par.colorr.expr='.15 if '+selected+' else .065';b.par.colorg.expr='.50 if '+selected+' else .09';b.par.colorb.expr='.39 if '+selected+' else .12'
 else:b.par.colorr=.08;b.par.colorg=.13;b.par.colorb=.17
 e=root.create(parameterexecuteDAT,name+'_action');e.par.op=b;e.par.pars='value0';e.par.custom=False;e.par.builtin=True;e.text='def onValueChange(par, prev):\n    if par.eval():\n        '+action+'\n    return\n'
 return b
for i,(name,title,_,_) in enumerate(modes):
 button('choose_'+name,title,24,580-i*42,190,35,'parent().par.Mode = '+repr(name),'parent().par.Mode.menuIndex == '+str(i))
button('toggle_play','Play / pause',24,135,92,33,'parent().par.Play = not parent().par.Play.eval()')
button('toggle_freeze','Freeze',122,135,92,33,'parent().par.Freeze = not parent().par.Freeze.eval()')
button('gain_down','Gain -',24,94,92,33,'parent().par.Gain = max(.1,parent().par.Gain.eval()/1.25)')
button('gain_up','Gain +',122,94,92,33,'parent().par.Gain = min(8,parent().par.Gain.eval()*1.25)')
button('toggle_monitor','Hear audio',24,53,92,33,'parent().par.Monitor = not parent().par.Monitor.eval()')
button('restart_song','Restart',122,53,92,33,"parent().op('song').par.cuepulse.pulse()")
button('choose_file','Choose song...',24,12,190,33,"parent().op('panel_actions').module.choose_file()")
actions=root.create(textDAT,'panel_actions');actions.text="def choose_file():\n    path=ui.chooseFile(load=True, title='Choose an audio file')\n    if path:\n        parent().par.Audiofile=path\n        parent().par.Source='file'\n"
restart=root.create(parameterexecuteDAT,'restart_action');restart.par.op=root;restart.par.pars='Restart';restart.text="def onPulse(par):\n    parent().op('song').par.cuepulse.pulse()\n    return\n"
clock=root.create(executeDAT,'update_signal');clock.par.framestart=True;clock.text="def onFrameStart(frame):\n    parent().op('signal_texture').cook(force=True)\n    return\n"
helpdat=root.create(textDAT,'README');helpdat.text='LIGHTFLOW SIGNAL LAB\n\nOpen the component viewer for the instrument UI. Choose song loads local audio. Hear audio enables monitoring. The Signal custom page exposes source, gain, window, trigger, grid and line width.\n\nConnect stereo CHOP to the component and select External CHOP input for live routing. Each named base COMP is a separate visual, fed by signal_texture. out1 is clean 960x540 video.\n\nScope views use a decimated 5-80ms window; they are creative displays, not measurement-grade scopes. FFT is 4096 samples, Hann-windowed. Three bands are frequency ranges, not stems. Transients use positive spectral flux, not beat tracking. Histories cover 512 display updates, not a fixed time span. No RPMC data or model is used.'
root.par.opviewer=''
root.viewer=True
tex.cook(force=True)
select.cook(force=True)
root.save(str(BASE/'lightflow_scopes.tox'))
project.save(str(BASE/'lightflow_scopes.toe'))
print('LIBRARY CREATED',root.path)
root.openViewer()
