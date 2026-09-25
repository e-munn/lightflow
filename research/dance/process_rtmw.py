"""Offline RTMW extraction into a new run; original media and PTS preserved."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
import time
import traceback
from process import copy_exclusive, save
from tracking import PrimaryTracker, usable_pose

# Exact landmark correspondences only. Unmapped MediaPipe face points stay missing.
COCO_TO_MP={0:0,1:2,2:5,3:7,4:8,5:11,6:12,7:13,8:14,9:15,10:16,11:23,12:24,13:25,14:26,15:27,16:28,17:31,19:29,20:32,22:30,95:21,99:19,111:17,116:22,120:20,132:18}

def map_pose(kpts,scores,width,height):
    pose=[[0.,0.,0.,0.] for _ in range(33)]
    for coco,mp in COCO_TO_MP.items():
        pose[mp]=[round(float(kpts[coco][0]/width),5),round(float(kpts[coco][1]/height),5),0.,round(float(scores[coco]),4)]
    return pose


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',required=True);parser.add_argument('--runtime',required=True);parser.add_argument('--replay-from',required=True);parser.add_argument('--backend',choices=['cpu','coreml'],default='cpu');args=parser.parse_args()
    root=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs').resolve();run=Path(args.run).resolve();baseline=(root/args.replay_from).resolve()
    if run.parent!=root or baseline.parent!=root or run==baseline or not Path('/Volumes/ExtremePro').is_mount():raise ValueError('Distinct SanDisk runs required')
    job=json.loads((run/'job.json').read_text());old=json.loads((baseline/'job.json').read_text());config=json.loads(Path(args.runtime).read_text())
    if any(job[k]!=old[k] for k in ('sourceId','start','duration')):raise ValueError('Source interval mismatch')
    sequence=0
    def event(stage,message,t=None,**extra):
        nonlocal sequence
        save(run/'events'/f'{sequence:06d}.json',{'id':sequence,'wallTime':time.time(),'stage':stage,'message':message,'t':t,**extra});sequence+=1
    try:
        event('prepare','Loading RTMW whole-body estimator and human detector. No coordinate smoothing or interpolation.')
        import av
        import numpy as np
        import onnxruntime as ort
        from rtmlib import RTMPose, YOLOX
        for name in ('preview.mp4','audio.m4a','waveform.json'):copy_exclusive(baseline/name,run/name)
        event('audio','Byte-identical original video and audio copied into the new run.')
        def model(cls,key,size):
            path=config['assets'][key]['path']
            engine=cls(path,model_input_size=size,backend='onnxruntime',device='cpu')
            options=ort.SessionOptions();options.intra_op_num_threads=4;options.inter_op_num_threads=1
            options.add_session_config_entry('session.intra_op.allow_spinning','0');options.add_session_config_entry('session.inter_op.allow_spinning','0')
            providers=['CPUExecutionProvider']
            if args.backend=='coreml':
                if 'CoreMLExecutionProvider' not in ort.get_available_providers():raise RuntimeError('CoreML unavailable')
                cache=run/('coreml-'+key);cache.mkdir()
                providers=[('CoreMLExecutionProvider',{'ModelFormat':'MLProgram','MLComputeUnits':'ALL','ModelCacheDirectory':str(cache)}),'CPUExecutionProvider']
            engine.session=ort.InferenceSession(path,sess_options=options,providers=providers)
            return engine
        detector=model(YOLOX,'detector',(640,640));estimator=model(RTMPose,'pose',(288,384))
        tracker=PrimaryTracker(solo=True);chunk=[];chunk_index=0;count=tracked=usable=single=multiple=cuts=gated=0;last_state=None;previous_small=None;last_ms=-1;started=time.monotonic()
        event('pose','RTMW-l 133 landmarks; detector every frame. Score >=0.5 is an uncalibrated compatibility threshold, not MediaPipe visibility.',model='RTMW-l 384x288',modelSha256=config['assets']['pose']['sha256'])
        with av.open(str(run/'preview.mp4')) as container:
            stream=container.streams.video[0];fps=float(stream.average_rate)
            for frame in container.decode(stream):
                if (run/'cancel.json').exists():event('cancelled','Cancelled; partial artifacts retained.');return
                if frame.pts is None:raise ValueError('Missing source timestamp')
                t=float(frame.pts*frame.time_base);ms=round(t*1000)
                if ms<=last_ms:raise ValueError('Non-increasing timestamps')
                last_ms=ms;bgr=frame.to_ndarray(format='bgr24');height,width=bgr.shape[:2]
                small=bgr[::24,::24].astype(np.float32)/255
                cut=previous_small is not None and float(np.mean(np.abs(small-previous_small)))>.30;previous_small=small
                if cut:tracker.scene_cut();cuts+=1
                boxes=detector(bgr)
                # RTMPose's empty-box fallback means whole-image pose. Explicitly
                # avoid it: missing person detections must remain missing data.
                if len(boxes):
                    kpts,scores=estimator(bgr,bboxes=boxes)
                    if kpts.shape[1]!=133:raise ValueError('Unexpected whole-body topology')
                    poses=[map_pose(k,s,width,height) for k,s in zip(kpts,scores)]
                    whole=[[[round(float(x/width),5),round(float(y/height),5),round(float(s),4)] for (x,y),s in zip(k,ss)] for k,ss in zip(kpts,scores)]
                else:poses=[];whole=[]
                primary,track,state,reason=tracker.select(poses,t)
                ok=primary is not None and usable_pose(poses[primary]);tracked+=primary is not None;usable+=ok;single+=len(poses)==1;multiple+=len(poses)>1;gated+=state=='review_required'
                if state!=last_state:event('decision',reason,t,kind=state,candidates=len(poses))
                last_state=state
                chunk.append({'t':round(t,6),'index':count,'poses':poses,'wholebody':whole,'topology':'coco-wholebody-133','primary':primary,'track':track if primary is not None else None,'state':state,'speed':None,'cut':cut,'poseUsable':ok})
                count+=1
                if len(chunk)==48:save(run/'frames'/f'{chunk_index:06d}.json',chunk);chunk=[];chunk_index+=1
                if count%120==0:event('progress',f'Processed {count} frames.',t,frames=count,progress=min(.99,t/job['duration']));print(json.dumps({'frames':count,'t':round(t,2),'elapsed':round(time.monotonic()-started,1)}),flush=True)
            if chunk:save(run/'frames'/f'{chunk_index:06d}.json',chunk)
        result={'frames':count,'tracked':tracked,'fps':fps,'duration':t+1/fps,'coverage':tracked/count,'poseModel':'RTMW-l 384x288 + YOLOX-m','poseModelSha256':config['assets']['pose']['sha256'],'comparisonSourceRun':args.replay_from,'extractionSeconds':time.monotonic()-started,'trackingMode':'solo','usableFrames':usable,'poseCoverage':usable/count,'singleBodyFrames':single,'multipleBodyFrames':multiple,'cutFlags':cuts,'reviewRequiredFrames':gated,'identityAccuracy':None,'versions':{'av':av.__version__,'onnxruntime':ort.__version__},'lightingModel':None,'coordinateSystem':'2D; compatibility z=0 is a placeholder, not estimated depth. Native 133 x/y/score points retained in wholebody.','scoreCaveat':'RTMW keypoint scores and MediaPipe visibility/presence are not calibrated to each other. Coverage at 0.5 is diagnostic, not positional accuracy.','limitations':['Framewise 2D model; no explicit temporal consistency or occlusion recovery.','Unmapped MediaPipe landmarks have zero confidence.','Strict solo gate remains; observed image positions require visual checking.']}
        result['backend']=args.backend
        if args.backend=='coreml':result['runtimeNote']='ONNX/CoreML teardown crashed after a successful standalone comparison on this host. This short-lived worker flushes completed artifacts and exits without interpreter teardown.'
        save(run/'result.json',result);event('complete','RTMW extraction complete. Original MediaPipe runs remain unchanged.',frames=count,progress=1)
        if args.backend=='coreml':
            # The isolated CoreML parity check produced valid results and then
            # aborted during interpreter teardown. Artifacts above are already
            # closed; skip that native finalizer only on successful completion.
            sys.stdout.flush();sys.stderr.flush();os._exit(0)
    except Exception as e:event('error',str(e));traceback.print_exc();raise

if __name__=='__main__':main()
