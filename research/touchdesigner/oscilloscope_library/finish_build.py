from pathlib import Path
BASE=Path('/Users/elijah/studio/lightflow/research/touchdesigner/oscilloscope_library')
root=op('/project1/lightflow_scopes')
modes=root.fetch('modes')
select=root.op('selected_visual')
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
