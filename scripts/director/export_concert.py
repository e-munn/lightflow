"""Export the selected experiment checkpoint and fixed input transform."""
from train_concert import Director, OUT
import json
from pathlib import Path
import torch, librosa, numpy as np
model=Director();checkpoint=torch.load(OUT/'concert.pt',map_location='cpu',weights_only=True);model.load_state_dict(checkpoint['model']);model.eval()
root=Path('public/models');root.mkdir(exist_ok=True)
torch.onnx.export(model,torch.zeros(1,128,96),str(root/'concert.onnx'),input_names=['mel'],output_names=['lighting'],opset_version=17,dynamo=False)
bank=librosa.filters.mel(sr=22050,n_fft=2048,n_mels=128)
(root/'mel-bank.json').write_text(json.dumps([[[int(i),float(row[i])] for i in np.flatnonzero(row)] for row in bank]))
(root/'concert.json').write_text(json.dumps({'sampleRate':22050,'fftSize':2048,'fps':8,'contextFrames':96,'source':'RPMC-L2 / Zhao et al. / CC-BY-4.0','checkpointEpoch':checkpoint['epoch'],'metrics':checkpoint['metrics'],'status':'experimental; baseline evaluation complete','evaluation':json.loads((OUT/'evaluation.json').read_text())},indent=2))
print('exported epoch',checkpoint['epoch'])
