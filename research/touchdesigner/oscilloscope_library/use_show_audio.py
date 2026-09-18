from pathlib import Path
root=op('/project1/lightflow_scopes')
base=Path('/Users/elijah/studio/lightflow/research/touchdesigner/oscilloscope_library')
audio=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/audio/9-16-26')
tracks=[('ultra','ULTRA MIAMI','of_the_trees_ultra_miami_2026_b3E9eB6Uw_E.m4a'),('forest','ELECTRIC FOREST','of_the_trees_electric_forest_-eVk7dh8dO4.m4a')]
root.par.Audiofile=str(audio/tracks[0][2]);root.par.Audiofile.default=str(audio/tracks[0][2]);root.par.Play=True
root.op('song').par.cuepulse.pulse()
root.op('source_label_text').par.text.expr="('SOURCE: OF THE TREES / ' + ('ULTRA MIAMI 2026' if 'ultra_miami' in parent().par.Audiofile.eval() else 'ELECTRIC FOREST') if 'of_the_trees_' in parent().par.Audiofile.eval() else 'SOURCE: '+parent().par.Audiofile.eval().split('/')[-1]) + '  /  AUDIO ' + ('ON' if parent().par.Monitor else 'MUTED')"
for i,(name,title,file) in enumerate(tracks):
 b=root.create(buttonCOMP,'show_'+name);b.par.label=title;b.par.buttontype='momentary';b.par.x=810+i*140;b.par.y=668;b.par.w=130;b.par.h=30;b.par.fontsize=11
 b.par.colorr=.08;b.par.colorg=.18;b.par.colorb=.20
 e=root.create(parameterexecuteDAT,'show_'+name+'_action');e.par.op=b;e.par.pars='value0';e.par.custom=False;e.text='def onValueChange(par, prev):\n    if par.eval():\n        parent().par.Audiofile = '+repr(str(audio/file))+"\n        parent().par.Source = 'file'\n        parent().op('song').par.cuepulse.pulse()\n    return\n"
root.op('README').text += '\n\nFULL SHOW AUDIO: Ultra Miami 2026 (60:15) and Electric Forest (78:15) live on ExtremePro in Movies/Assets/lightflow_research/audio/9-16-26. Show buttons select those files. No heavy media is embedded. Mount ExtremePro before opening. Never delete or overwrite anything on that drive.\n'
op('/project1/scope_probe').allowCooking=False
root.par.Mode='stereo_xy'
print('FULL SHOW AUDIO READY')
root.openViewer()
