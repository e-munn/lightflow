"""Strict checkpoint load and trailing-window music-encoder feasibility."""
from pathlib import Path
import argparse,hashlib,json,subprocess,time
import numpy as np
import torch
import torchaudio
from transformers import HubertConfig,HubertModel

def load_model(folder,device):
    settings=json.loads((folder/'config.json').read_text())
    assert not settings['feature_extractor_cqt'] and not settings['deepnorm']
    assert settings['attention_relax']<0 and settings['feat_proj_layer_norm']
    settings.pop('model_type',None);settings.pop('auto_map',None);settings.pop('architectures',None)
    config=HubertConfig(**settings);config._attn_implementation='eager'
    model=HubertModel(config)
    state=torch.load(folder/'pytorch_model.bin',map_location='cpu',weights_only=True)
    conversions=[]
    for old,new in [('encoder.pos_conv_embed.conv.weight_g','encoder.pos_conv_embed.conv.parametrizations.weight.original0'),('encoder.pos_conv_embed.conv.weight_v','encoder.pos_conv_embed.conv.parametrizations.weight.original1')]:
        if old in state and new in model.state_dict():state[new]=state.pop(old);conversions.append([old,new])
    model.load_state_dict(state,strict=True)
    return model.eval().to(device),conversions

def past_window(audio,end,sample_rate):
    count=5*sample_rate
    if end<count or end>len(audio):raise ValueError('Window lacks five seconds of received audio')
    raw=torch.from_numpy(audio[end-count:end].copy())
    # All filtering and normalization sees only the received window.
    if sample_rate!=24000:raw=torchaudio.functional.resample(raw,sample_rate,24000)
    raw=(raw-raw.mean())/torch.sqrt(raw.var(unbiased=False)+1e-7)
    return raw[None]

def encode(model,audio,end,sample_rate,device):
    started=time.perf_counter();window=past_window(audio,end,sample_rate).to(device)
    if device=='mps':torch.mps.synchronize()
    with torch.inference_mode():hidden=model(window,output_hidden_states=True).hidden_states
    features=torch.cat([part for i in [6,12] for part in [hidden[i].mean(1),hidden[i][:,-38:].mean(1)]],dim=1)[0]
    result=features.cpu().numpy().copy()
    if device=='mps':torch.mps.synchronize()
    return result,time.perf_counter()-started

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--model',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--device',default='mps');args=ap.parse_args()
    assert (args.model/'PROVENANCE.json').exists(),'Wait for verified complete download'
    torch.set_num_threads(4)
    cfg=json.loads(Path(__file__).parent.parent.joinpath('wide_lights/sources.json').read_text())['sources']['alleycvt']
    source=cfg['source'];probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','a:0','-show_entries','stream=sample_rate,channels','-of','json',source]))['streams'][0]
    sr=int(probe['sample_rate']);assert probe['channels']==2
    # No resampling at decode: preserve source sample rate, then slice before
    # resampling. A fixed left channel avoids stereo cancellation in this branch.
    raw=subprocess.check_output(['ffmpeg','-v','error','-ss','600','-i',source,'-t','15','-vn','-af','pan=mono|c0=c0','-f','f32le','pipe:1'])
    audio=np.frombuffer(raw,np.float32).copy();assert len(audio)==15*sr
    model,conversions=load_model(args.model,args.device)
    args.out.mkdir(parents=True,exist_ok=False)
    values=[];timings=[]
    for endpoint in np.arange(5,15.01,.5):
        value,elapsed=encode(model,audio,round(endpoint*sr),sr,args.device)
        assert np.isfinite(value).all();values.append(value);timings.append(elapsed)
        print('WINDOW',round(float(endpoint),1),'processing_ms',round(elapsed*1000,1),flush=True)
    altered=audio.copy();altered[10*sr:]=np.random.default_rng(96).normal(0,.1,len(audio)-10*sr)
    a,_=encode(model,audio,10*sr,sr,args.device);b,_=encode(model,altered,10*sr,sr,args.device)
    error=float(np.max(abs(a-b)));assert error<1e-6
    assert np.array_equal(past_window(audio,10*sr,sr).numpy(),past_window(altered,10*sr,sr).numpy())
    report={'source':source,'source_start':600,'duration':15,'source_sample_rate':sr,'channel':'left','window_seconds':5,'hop_seconds':.5,
        'device':args.device,'strict_state_dict_load':True,'key_conversions':conversions,'upstream_output_parity':'Not independently verified; architecture/config/state compatibility only',
        'input_endpoint_future_change_max_error':error,'feature_dimensions':len(values[0]),'warm_first_window_ms':timings[0]*1000,
        'processing_ms_p50_p95_max':np.quantile(np.array(timings[1:])*1000,[.5,.95,1]).tolist(),
        'two_hz_processing_deadline_misses':int((np.array(timings[1:])>.5).sum()),
        'physical_latency':'Unmeasured; this benchmark measures local preprocessing+inference only',
        'layers':[6,12],'pooling':['whole received 5s window','last 38 representation frames'],
        'model_folder':str(args.model),'license':'CC-BY-NC-4.0 research candidate','code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    with (args.out/'report.json').open('x') as f:json.dump(report,f,indent=2,allow_nan=False)
    with (args.out/'features.npz').open('xb') as f:np.savez_compressed(f,time=np.arange(605,615.01,.5),features=np.array(values))
    print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__':main()
