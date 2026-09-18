"""Audit listener observations without converting them into precise training labels."""
from pathlib import Path
import argparse,json,hashlib,math,uuid

def inspect(moment):
 issues=[]
 try:uuid.UUID(moment.get('id',''));uuid.UUID(moment.get('source',{}).get('sessionId',''))
 except (ValueError,TypeError,AttributeError):issues.append('invalid mark or session identity')
 if moment.get('tag') not in ('follows_music','missed_detail','stays_bright'):issues.append('unknown observation tag')
 if moment.get('source',{}).get('kind') not in ('url','file','mic','system'):issues.append('unknown source type')
 if moment.get('automated') is not False:issues.append('automated or unknown interaction provenance')
 if moment.get('modelEnabled') is not False:issues.append('unexpected model condition')
 if moment.get('baseline')!='scope-coverage-256-soft-v1':issues.append('unknown baseline')
 frames=moment.get('frames',[])
 if len(frames)<2:return issues+['missing observation window'],{}
 try:
  times=[float(f['at']) for f in frames]
  if any(not math.isfinite(t) for t in times) or any(b<=a for a,b in zip(times,times[1:])):issues.append('invalid frame times')
  duration=times[-1]-times[0]
  visible=sum(min(.06,max(0,times[i]-times[i-1])) for i in range(1,len(times)) if frames[i]['pageVisible'] and frames[i-1]['pageVisible'] and frames[i]['visibleFraction']>=.5 and frames[i-1]['visibleFraction']>=.5 and times[i]-times[i-1]<=.1)
  if duration<2:issues.append('less than two seconds of context')
  if visible<1:issues.append('insufficient visible brightness context')
  if len({(f['exposure'],f['softCurve']) for f in frames})!=1:issues.append('display settings changed inside reaction window')
  if any(not math.isfinite(f['brightness']) or not 0<=f['brightness']<=1 or len(f['features'])!=8 or any(not math.isfinite(x) for x in f['features']) for f in frames):issues.append('invalid signal data')
  source=moment.get('source',{});positions=[f.get('sourceSeconds') for f in frames]
  if source.get('kind') in ('mic','system'):issues.append('live audio not retained; cannot replay source from this record')
  return issues,{'window_seconds':duration,'visible_seconds':visible,'source_kind':source.get('kind'),'source_name':source.get('name'),'source_seconds':[positions[0],positions[-1]],'tag':moment.get('tag'),'note':moment.get('note','')}
 except (KeyError,ValueError,TypeError):return issues+['invalid frame schema'],{}

def audit(root):
 found={};duplicates=0;conflicts=set();errors=[]
 for file in sorted(root.rglob('*.json')):
  try:
   data=json.loads(file.read_text())
   for m in data.get('moments',[]):
    key=m.get('id');digest=hashlib.sha256(json.dumps(m,sort_keys=True).encode()).hexdigest()
    if not isinstance(key,str):errors.append(str(file)+': missing mark ID');continue
    if key in found:
     duplicates+=1
     if found[key][0]!=digest:conflicts.add(key)
    else:found[key]=(digest,m,str(file))
  except (ValueError,TypeError,AttributeError) as e:errors.append(str(file)+': unreadable record')
 rows=[]
 for key,(_,moment,file) in found.items():
  issues,summary=inspect(moment)
  if key in conflicts:issues.append('conflicting records for same mark ID')
  if '/automated/' in file and 'automated or unknown interaction provenance' not in issues:issues.append('stored in automated-fixture directory')
  rows.append({'id':key,'file':file,'candidate_for_manual_review':not issues,'issues':issues,**summary})
 return {'unique_marks':len(rows),'duplicates':duplicates,'conflicts':len(conflicts),'candidate_listener_observations':sum(r['candidate_for_manual_review'] for r in rows),'training_ready_labels':0,'note':'Even eligible marks are unverified reaction windows. Review the music and display before deriving any labels; timing is approximate and no preferred numerical brightness is specified.','records':rows,'errors':errors}

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);args=ap.parse_args();report=audit(args.root)
 with args.out.open('x') as f:json.dump(report,f,indent=2)
 print(json.dumps({k:v for k,v in report.items() if k!='records'},indent=2))
