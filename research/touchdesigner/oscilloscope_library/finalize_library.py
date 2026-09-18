from pathlib import Path
import json
root=op('/project1/lightflow_scopes')
base=Path('/Users/elijah/studio/lightflow/research/touchdesigner/oscilloscope_library')
# Watch both native and custom parameters: default Button COMP exposes value0 as custom.
for n in root.findChildren(depth=1,type=parameterexecuteDAT):
 n.par.custom=True;n.par.builtin=True
for n in root.findChildren(depth=1,type=buttonCOMP):
 n.par.buttontype='toggledown'
for n in root.findChildren(depth=1,type=parameterexecuteDAT):
 if 'if par.eval():' in n.text:n.text=n.text.replace('if par.eval():','if par.eval() != prev:')
# Store the updated source/labels and use fresh versioned filenames.
root.par.Mode='bands'
root.save(str(base/'lightflow_scopes_v2.tox'))
project.save(str(base/'lightflow_scopes_v2.toe'))
print('SAVED V2',[(n.name,n.par.value0.isCustom) for n in root.findChildren(depth=1,type=buttonCOMP)])
root.openViewer()
