"""Create a deterministic timing stimulus, not a latency measurement."""
from pathlib import Path
import argparse,hashlib,json,wave
import numpy as np

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=False)
    sr=48000;rng=np.random.default_rng(17092026);times=45+np.r_[0,np.cumsum(rng.uniform(1.6,2.4,19))];audio=np.zeros((int((times[-1]+3)*sr),2),np.float32);events=[]
    n=int(.04*sr);phase=np.arange(n)/sr;envelope=np.minimum(1,np.arange(n)/(sr*.002))*np.minimum(1,np.arange(n)[::-1]/(sr*.002));burst=np.sin(2*np.pi*1000*phase)*envelope
    for i,t in enumerate(times):
        sample=round(t*sr);amp=[.15,.3,.6][i%3];audio[sample:sample+n]=burst[:,None]*amp;events.append(dict(sample=sample,nominal_seconds=sample/sr,amplitude=amp,duration_s=.04))
    wav=a.out/'timing-probe.wav'
    with wav.open('xb') as f:
        with wave.open(f,'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((np.clip(audio,-1,1)*32767).astype('<i2').tobytes())
    report=dict(provenance='synthetic_stimulus',sample_rate=sr,channels=2,lead_in_seconds=45,events=events,sha256=hashlib.sha256(wav.read_bytes()).hexdigest(),note='Nominal source sample times are NOT observed acoustic onsets. Forty-five seconds of initial silence allows the experimental model context to fill. No capture, playback or physical measurement performed.')
    with (a.out/'stimulus.json').open('x') as f:json.dump(report,f,indent=2)
    # Known synthetic edge intervals exercise calibration and ambiguity accounting.
    fixture=dict(provenance='synthetic',audio=[[float(t),float(t)] for t in times],light=[[float(t+.08),float(t+.09)] for t in times],pairing_window_s=[-.5,.75],calibration={'light_minus_audio_clock_offset_s':.02,'offset_uncertainty_s':.005,'method':'Synthetic known offset, not device calibration'})
    with (a.out/'synthetic-analysis-input.json').open('x') as f:json.dump(fixture,f,indent=2)
    print(wav)
if __name__=='__main__':main()
