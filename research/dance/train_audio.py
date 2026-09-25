"""Fit and compare small causal audio models on song-disjoint pilot data.

Outputs and all dataset/model artifacts are exclusively created on SanDisk.
Evaluation concerns authored proxy targets, never human lighting quality.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time
import numpy as np
import av
from audio_features import extract, fit_ridge, predict, brightness, NAMES, RATE, WINDOW, HOP, LAGS, EDGES

HERE = Path(__file__).resolve().parent
ROOT = Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance')
TARGETS = ('armSpeed','legSpeed','travel','extension','deceleration','holding')


def json_write(path, value):
    def default(v):
        if isinstance(v,np.ndarray): return v.tolist()
        if isinstance(v,np.generic): return v.item()
        raise TypeError(type(v).__name__)
    with path.open('x') as f:
        json.dump(value,f,default=default,allow_nan=False,separators=(',',':'))


def sample_targets(frames,times):
    """Use nearest measured teacher frame, never bridge an unavailable frame."""
    pts = np.asarray([f['t'] for f in frames])
    high = np.searchsorted(pts,times).clip(0,len(pts)-1)
    low = (high-1).clip(0,len(pts)-1)
    indices = np.where(abs(pts[low]-times)<abs(pts[high]-times),low,high)
    y = np.full((len(times),len(TARGETS)),np.nan)
    for i,index in enumerate(indices):
        row = frames[index]
        if abs(row['t']-times[i]) > .045 or row['speed'] is None:
            continue
        values = [row.get(k) for k in TARGETS]
        if any(v is None for v in values):
            continue
        y[i] = values
    # Nonfinite/missing observations remain a mask, never dark/still labels.
    return y


def metric(target, pred):
    target,pred = np.asarray(target),np.asarray(pred)
    mse = np.mean((pred-target)**2)
    variance = np.var(target)
    corr = float(np.corrcoef(target,pred)[0,1]) if min(np.std(target),np.std(pred))>1e-9 else None
    return {'mae':float(np.mean(abs(pred-target))), 'rmse':float(np.sqrt(mse)),
            'r2':float(1-mse/variance) if variance>1e-9 else None, 'correlation':corr,
            'predictionStd':float(np.std(pred)), 'targetStd':float(np.std(target))}


def load_data(plan):
    config = json.loads((HERE/'runtime.local.json').read_text())
    jobs = {}
    for run in (ROOT/'runs').iterdir():
        if not (run/'result.json').exists(): continue
        job=json.loads((run/'job.json').read_text())
        if job['sourceId'] in plan['splits'] and job.get('trackingMode')=='solo':
            jobs.setdefault(job['sourceId'],[]).append((job,run))
    data, audit = [], []
    for source,split in plan['splits'].items():
        choices = jobs.get(source,[])
        requested=plan.get('passages',{}).get(source)
        if requested:
            choices=[c for c in choices if all(c[0][k]==v for k,v in requested.items())]
        if not choices: raise ValueError(f'Missing planned source {source}; do not silently change the split')
        job,run = max(choices,key=lambda c:(c[0]['duration'],c[0]['createdAt']))
        analyses = [json.loads(p.read_text()) for p in (run/'analyses').glob('*.json')]
        analyses = [a for a in analyses if all('armSpeed' in f for f in a['frames'])]
        if not analyses: raise ValueError(f'Run needs v2 limb analysis: {job["id"]}')
        analysis = max(analyses,key=lambda a:a['createdAt'])
        result=json.loads((run/'result.json').read_text())
        multi=result['multipleBodyFrames']/result['frames']
        reasons=[]
        if analysis['coverage']<plan['minimum_movement_coverage']: reasons.append('insufficient valid movement coverage')
        if multi>plan['maximum_multiple_body_fraction']: reasons.append('multiple-body detections')
        if result['cutFlags']: reasons.append('possible cut: requires boundary review')
        reviews=[json.loads(p.read_text()) for p in (run/'reviews').glob('*.json')]
        if any(r['outcome']=='issue' and r['reviewer']!='automated' for r in reviews): reasons.append('visual review has unresolved issue')
        row={'sourceId':source,'runId':job['id'],'title':job['title'],'split':split,'sourceStart':job['start'],
             'seconds':job['duration'],'frames':result['frames'],'poseCoverage':result['poseCoverage'],
             'movementCoverage':analysis['coverage'],'multipleBodyFraction':multi,'cutFlags':result['cutFlags'],
             'analysisId':analysis['id'],'poseSha256':analysis['poseSha256'],'audioSha256':analysis['audioSha256'],
             'featureLookaheadSeconds':analysis['parameters']['measuredFeatureLookaheadSeconds'],
             'identityReview':'sampled only; no full-span identity certification','excludedReasons':reasons}
        audit.append(row)
        if reasons: continue
        with av.open(str(run/'audio.m4a')) as container:
            channels=container.streams.audio[0].codec_context.channels
        if channels not in (1,2): raise ValueError('Only mono/stereo sources are supported')
        audio=subprocess.check_output([config['ffmpeg'],'-v','error','-i',str(run/'audio.m4a'),'-ar',str(RATE),'-f','f32le','-'])
        samples=np.frombuffer(audio,dtype='<f4').reshape(-1,channels).mean(axis=1)
        x,t,rms=extract(samples)
        y=sample_targets(analysis['frames'],t)
        mask=np.isfinite(y).all(axis=1)&(t>=plan['warmup_seconds'])
        row.update({'usableTrainingSeconds':float(mask.sum()*HOP/RATE),'usableRows':int(mask.sum()),
                    'highDecelerationFrames':sum(f['deceleration'] is not None and f['deceleration']>50 for f in analysis['frames'])})
        data.append({'meta':row,'x':x,'raw':y,'times':t,'rms':rms,'mask':mask})
    return data,audit


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--plan',default=str(HERE/'experiment-plan-2026-09-22.json'))
    args=parser.parse_args()
    if not Path('/Volumes/ExtremePro').is_mount(): raise RuntimeError('SanDisk required')
    plan=json.loads(Path(args.plan).read_text())
    data,audit=load_data(plan)
    for split,minimum in [('train',3),('validation',1),('test',2)]:
        if sum(d['meta']['split']==split for d in data)<minimum:
            print(json.dumps({'qualityAudit':audit},indent=2))
            raise ValueError(f'Insufficient eligible {split} songs; review extraction instead of weakening gates')
    train_raw=np.concatenate([d['raw'][d['mask']] for d in data if d['meta']['split']=='train'])
    # Only training songs define target units. No per-test-clip stretching.
    low=np.quantile(train_raw,.05,axis=0)
    high=np.quantile(train_raw,.95,axis=0)
    low[[0,1,2,4,5]]=0; high[5]=1
    high=np.maximum(high,low+np.asarray([.5,.5,.2,.15,1,1]))
    for d in data:
        d['y']=np.clip((d['raw']-low)/(high-low),0,1)
        d['light']=brightness(d['y'])[:,None]
    train=[d for d in data if d['meta']['split']=='train']
    val=[d for d in data if d['meta']['split']=='validation']
    x=np.concatenate([d['x'][d['mask']] for d in train])
    y=np.concatenate([d['y'][d['mask']] for d in train])
    light=np.concatenate([d['light'][d['mask']] for d in train])
    rms_indices=[i for i,n in enumerate(NAMES) if n.startswith('log_rms_')]
    trials=[]; chosen={}
    for mode,target,indices in [('movement',y,list(range(len(NAMES)))),('direct',light,list(range(len(NAMES)))),('rms',light,rms_indices)]:
        candidates=[]
        for alpha in plan['ridge_alphas']:
            model=fit_ridge(x[:,indices],target,alpha)
            scores=[]
            for d in val:
                pred=predict(model,d['x'][d['mask']][:,indices])
                p=brightness(pred) if mode=='movement' else pred[:,0]
                scores.append(metric(d['light'][d['mask'],0],p)['mae'])
            score=float(np.mean(scores))
            trials.append({'mode':mode,'alpha':alpha,'validationMae':score})
            candidates.append((score,alpha,model))
        _,_,model=min(candidates,key=lambda c:c[0])
        chosen[mode]=dict(model,indices=indices)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')
    out=Path(tempfile.mkdtemp(prefix='audio-model-'+stamp+'-',dir=ROOT))
    constant=float(light.mean()); report_rows=[]
    for d in data:
        movement_pred=predict(chosen['movement'],d['x'])
        predictions={'movement':brightness(movement_pred),'direct':predict(chosen['direct'],d['x'])[:,0],
                     'rms':predict(chosen['rms'],d['x'][:,rms_indices])[:,0],
                     'constant':np.full(len(d['x']),constant)}
        d['predictions']=predictions
        m=d['mask']; target=d['light'][:,0]
        metrics={name:metric(target[m],p[m]) for name,p in predictions.items()}
        controls={}
        # Same scoring rows for aligned and delayed controls; no wrap or future audio.
        for lag in (10,50,150):
            valid=m.copy(); valid[:lag]=False
            valid[lag:] &= m[:-lag]
            if valid.sum():
                at=np.flatnonzero(valid)
                controls[f'delay_{lag*20}ms']={mode:{'aligned':metric(target[at],p[at]),'delayed':metric(target[at],p[at-lag])} for mode,p in predictions.items() if mode in ('movement','direct')}
        components={name:metric(d['y'][m,j],movement_pred[m,j]) for j,name in enumerate(TARGETS)}
        report_rows.append(dict(d['meta'],metrics=metrics,components=components,delayControls=controls))
        rows=[]
        for i,t in enumerate(d['times']):
            rows.append({'t':round(float(t),6),'validTeacher':bool(m[i]),'teacher':float(target[i]) if m[i] else None,
                         'movement':float(predictions['movement'][i]),'direct':float(predictions['direct'][i]),
                         'rms':float(predictions['rms'][i]),'constant':constant,
                         'components':movement_pred[i].tolist()})
        json_write(out/(d['meta']['runId']+'.json'),{'runId':d['meta']['runId'],'split':d['meta']['split'],'frames':rows})
        with (out/(d['meta']['sourceId']+'.npz')).open('xb') as f:
            np.savez_compressed(f,x=d['x'],y=d['y'],mask=m,t=d['times'],rms=d['rms'])
    # Wrong-song negative control, scored on exactly the same teacher rows.
    held_out=[d for d in data if d['meta']['split']=='test']
    wrong_audio=[]
    for i,d in enumerate(held_out):
        other=held_out[(i+1)%len(held_out)]
        length=min(len(d['x']),len(other['x']))
        mask=d['mask'][:length]
        wrong_audio.append({'teacherSource':d['meta']['sourceId'],'wrongAudioSource':other['meta']['sourceId'],
                            'scoredSeconds':float(mask.sum()*HOP/RATE),
                            'metrics':{mode:{'aligned':metric(d['light'][:length,0][mask],d['predictions'][mode][:length][mask]),
                                             'wrongSong':metric(d['light'][:length,0][mask],other['predictions'][mode][:length][mask])}
                                       for mode in ('movement','direct')}})
    validation={mode:float(np.mean([r['metrics'][mode]['mae'] for r in report_rows if r['split']=='validation'])) for mode in chosen}
    test={mode:float(np.mean([r['metrics'][mode]['mae'] for r in report_rows if r['split']=='test'])) for mode in (*chosen,'constant')}
    selected=min(('movement','direct'),key=lambda mode:validation[mode])
    model={'version':'dance-audio-ridge-v1','id':out.name,'createdAt':datetime.now(timezone.utc).isoformat(),
           'sampleRate':RATE,'window':WINDOW,'hop':HOP,'lags':LAGS,'bands':EDGES,'features':NAMES,'targets':TARGETS,
           'targetLow':low,'targetHigh':high,'models':chosen,'constant':constant,'selectedByValidation':selected,
           'warmupSeconds':plan['warmup_seconds'],'status':'experimental; not a validated lighting controller'}
    json_write(out/'model.json',model)
    start=time.perf_counter()
    for _ in range(1000): predict(chosen['movement'],x[:1])
    ms=(time.perf_counter()-start)
    report={'id':out.name,'createdAt':model['createdAt'],'plan':plan,'qualityAudit':audit,'passages':report_rows,
            'validationTrials':trials,'validationMacroMae':validation,'testMacroMae':test,'wrongAudioControls':wrong_audio,
            'selectedByValidation':selected,'trainSongs':len(train),'testSongs':sum(d['meta']['split']=='test' for d in data),
            'eligibleSeconds':sum(d['meta']['usableTrainingSeconds'] for d in data),
            'regressionInferenceMeanMs':ms,'latencyNote':'Regression only; excludes audio capture, FFT, browser scheduling and light hardware. Trailing 32 ms window, 20 ms updates; no future audio.',
            'claim':'Trained prototype tested against unvalidated, automatically extracted movement and authored brightness proxies. No perceptual success claim.',
            'hashes':{name:hashlib.sha256((HERE/name).read_bytes()).hexdigest() for name in ('train_audio.py','audio_features.py','analyze.py')},
            'planSha256':hashlib.sha256(Path(args.plan).read_bytes()).hexdigest()}
    json_write(out/'report.json',report)
    (HERE/'training.local.json').write_text(json.dumps({'directory':str(out)})+'\n')
    print(json.dumps({'directory':str(out),'testMacroMae':test,'selectedByValidation':selected,'eligibleSeconds':report['eligibleSeconds']}),flush=True)


if __name__=='__main__': main()
