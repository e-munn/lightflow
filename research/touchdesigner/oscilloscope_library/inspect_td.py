import json
from pathlib import Path
root=op('/project1/scope_probe')
info={}
for typ,name in [(audiofileinCHOP,'audio'),(scriptTOP,'data'),(glslTOP,'glsl'),(switchTOP,'switch'),(containerCOMP,'container'),(buttonCOMP,'button'),(textTOP,'text'),(parameterexecuteDAT,'parexec'),(executeDAT,'execute')]:
 n=root.op(name) or root.create(typ,name)
 info[name]=[{'name':p.name,'value':str(p.eval()),'menus':list(p.menuNames or [])} for p in n.pars()]
Path('/Users/elijah/studio/lightflow/research/touchdesigner/oscilloscope_library/td_parameters.json').write_text(json.dumps(info,indent=2))
print('PROBE READY')
