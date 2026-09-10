from PIL import Image
from pathlib import Path
import numpy as np,json
root=Path('scripts/director/artifacts');frames=[];report=[]
for p in sorted(root.glob('scene-*.png')):
 a=np.asarray(Image.open(p).convert('RGB'),dtype=float)[16:-16,16:-16];frames.append(a);report.append({'scene':p.stem,'mean':float(a.mean()),'lit_fraction':float((a.max(-1)>10).mean())})
assert len(frames)==10, 'Need all ten actual scene renders'
assert all(r['lit_fraction']>.002 for r in report),report
for i in range(10):
 for j in range(i):assert np.mean(abs(frames[i]-frames[j]))>.1, 'Indistinguishable scenes'
black=np.asarray(Image.open(root/'blackout.png').convert('RGB'))[16:-16,16:-16];assert black.max()==0, 'Blackout is not black'
(root/'visual-check.json').write_text(json.dumps({'scenes':report,'blackout_max':int(black.max())},indent=2));print('Ten distinct nonblank scenes; blackout is black.')
