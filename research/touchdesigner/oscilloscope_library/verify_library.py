from pathlib import Path
import json, numpy as np
root=op('/project1/lightflow_scopes')
base=Path('/Users/elijah/studio/lightflow/research/touchdesigner/oscilloscope_library')
(base/'previews').mkdir(exist_ok=True)
report={'metrics':root.fetch('metrics',{}),'audio_shape':list(root.op('audio_signal').numpyArray().shape),'views':[]}
old=root.par.Mode.eval()
for name,label,title,desc in root.fetch('modes'):
 root.par.Mode=name
 out=root.op('out1');out.cook(force=True)
 pixels=out.numpyArray(delayed=False)
 out.save(str(base/'previews'/f'{name}.png'))
 report['views'].append({'name':name,'shape':list(pixels.shape),'std':float(pixels[:,:,:3].std()),'max':float(pixels[:,:,:3].max())})
root.par.Mode=old
report['errors']=[{'path':n.path,'error':n.errors()} for n in root.findChildren() if n.errors()]
(base/'verification.json').write_text(json.dumps(report,indent=2))
root.save(str(base/'lightflow_scopes.tox'))
project.save(str(base/'lightflow_scopes.toe'))
print('VERIFIED',json.dumps(report))
root.openViewer()
