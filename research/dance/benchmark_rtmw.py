"""Three new RTMW runs; artifacts exclusively created on SanDisk."""
from datetime import datetime,timezone
import json,os,subprocess,tempfile,uuid
from pathlib import Path
from benchmark_pose_quality import protected_hashes,digest,SOURCES,ROOT,RUNS,save,HERE

config_path=HERE/'rtmw-runtime-2026-09-23.local.json';config=json.loads(config_path.read_text())
study=Path(tempfile.mkdtemp(prefix='rtmw-quality-',dir=ROOT));rows=[]
# Hard arm case first, then clean control, then duplicate-detection case.
for original_id,title,reason in [SOURCES[1],SOURCES[0],SOURCES[2]]:
 original=RUNS/original_id;before=protected_hashes(original);old=json.loads((original/'job.json').read_text());run_id=str(uuid.uuid4());run=RUNS/run_id;run.mkdir()
 for sub in ('events','frames','notes','reviews'):(run/sub).mkdir()
 save(run/'job.json',{**old,'id':run_id,'title':old['title']+' · RTMW comparison','createdAt':datetime.now(timezone.utc).isoformat(),'comparisonSourceRun':original_id,'poseModel':'RTMW-l 384x288 + YOLOX-m'})
 env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1',PYTHONUNBUFFERED='1')
 with (run/'worker.log').open('x') as log:
  worker=subprocess.Popen([config['python'],str(HERE/'process_rtmw.py'),'--run',str(run),'--runtime',str(config_path),'--replay-from',original_id,'--backend','coreml'],env=env,stdout=log,stderr=log)
  save(run/'worker.json',{'pid':worker.pid});print(json.dumps({'started':run_id,'title':title,'study':str(study)}),flush=True);code=worker.wait()
 if protected_hashes(original)!=before:raise RuntimeError('Original artifacts changed')
 row={'baseline':original_id,'candidate':run_id,'title':title,'reason':reason,'exitCode':code}
 if code==0:
  result=json.loads((run/'result.json').read_text());old_result=json.loads((original/'result.json').read_text());identical=all(digest(run/n)==before[n] for n in ('preview.mp4','audio.m4a','waveform.json'));assert identical
  row.update({'baselineResult':old_result,'candidateResult':result,'identicalMedia':identical});print(json.dumps({'complete':run_id,'coverage':result['poseCoverage'],'seconds':result['extractionSeconds']}),flush=True)
 else:print(json.dumps({'failed':run_id,'log':str(run/'worker.log')}),flush=True)
 rows.append(row);save(study/f'comparison-{len(rows):02d}.json',row)
report={'createdAt':datetime.now(timezone.utc).isoformat(),'studyDirectory':str(study),'model':config['assets'],'rows':rows,'policy':'Different detector and keypoint model; same media, timestamp and strict identity policy. Scores are not calibrated across models.'}
save(study/'comparison.json',report);file=HERE/('rtmw-quality-benchmark-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json');save(file,report);print(json.dumps({'report':str(file)}),flush=True)
