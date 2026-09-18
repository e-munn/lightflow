"""Conservative descriptive audit. Never turns UI tests into human evidence."""
from pathlib import Path
import argparse,collections,json,math
QUESTIONS=['overall','timing','detail','phrasing']
METHODS=['direct','learned','instant_context','delayed_model']
ANSWERS={'A','B','tie','neither'}

def reasons(row):
    result=[]
    if not isinstance(row,dict):return ['record is not an object']
    t=row.get('trial'); ratings=row.get('ratings')
    if not isinstance(t,dict) or not isinstance(ratings,dict):return ['missing trial or ratings']
    if row.get('humanSubmitted') is not True:result.append('not submitted as human review')
    if t.get('evaluationVersion')!=2:result.append('legacy or unknown playback audit version')
    if t.get('automated') is not False:result.append('automated or automation provenance unknown')
    if any(x in str(row.get('notes','')).upper() for x in ['AUTOMATED','UI TEST','TEST ONLY']):result.append('notes identify test data')
    order=t.get('order'); valid_order=isinstance(order,list) and len(order)==2 and all(type(v) is int and 0<=v<4 for v in order) and len(set(order))==2 and 1 in order
    if not valid_order:result.append('invalid A/B assignment')
    duration=t.get('readySeconds');
    if type(duration) not in [int,float] or not math.isfinite(duration) or duration<20:result.append('insufficient or invalid displayed duration')
    if t.get('visibleOnly') is not True:result.append('visible comparison not established')
    if t.get('errors')!=[]:result.append('playback errors or missing error log')
    for key in ['resets','drops','interruptedFrames']:
        if type(t.get(key)) is not int or t[key]!=0:result.append('nonzero or unknown '+key)
    fingerprint=t.get('modelHash','')
    if not isinstance(fingerprint,str) or len(fingerprint)!=64 or any(c not in '0123456789abcdef' for c in fingerprint):result.append('invalid model fingerprint')
    if not isinstance(t.get('id'),str) or not t['id']:result.append('missing trial id')
    if not isinstance(t.get('source'),str) or not t['source']:result.append('missing source')
    if t.get('heardBefore') not in ['unfamiliar','familiar','previously_tested']:result.append('unknown music familiarity')
    if any(not isinstance(ratings.get(q),str) or ratings[q] not in ANSWERS for q in QUESTIONS):result.append('incomplete or invalid ratings')
    return result

def audit(exports):
    records=[];excluded=[];seen={};conflicts=set()
    for name,data in exports:
        if not isinstance(data,dict) or data.get('methods')!=METHODS or not isinstance(data.get('records'),list):
            excluded.append(dict(file=name,reasons=['invalid export schema or method mapping']));continue
        for row in data['records']:
            why=reasons(row);trial=row.get('trial',{}) if isinstance(row,dict) else {};key=trial.get('id') if isinstance(trial,dict) else None
            if data.get('testOnly') is True or data.get('humanEvaluation') is False:why.append('export declared test-only')
            if why:excluded.append(dict(file=name,trial=key,reasons=why));continue
            canonical=json.dumps(row,sort_keys=True)
            if key in seen:
                if seen[key]!=canonical:conflicts.add(key);excluded.append(dict(file=name,trial=key,reasons=['conflicting duplicate trial id']))
                else:excluded.append(dict(file=name,trial=key,reasons=['duplicate export of same trial']))
                continue
            seen[key]=canonical;records.append(row)
    accepted=[r for r in records if r['trial']['id'] not in conflicts]
    for r in records:
        if r['trial']['id'] in conflicts:excluded.append(dict(trial=r['trial']['id'],reasons=['original of conflicting duplicate']))
    groups={}
    for row in accepted:
        t=row['trial'];control=METHODS[next(v for v in t['order'] if v!=1)];key=t['modelHash']+' / '+control+' / '+t['heardBefore']
        g=groups.setdefault(key,dict(trials=0,sources=[],ratings={q:dict(learned=0,control=0,tie=0,neither=0) for q in QUESTIONS}))
        g['trials']+=1
        if t['source'] not in g['sources']:g['sources'].append(t['source'])
        for q in QUESTIONS:
            answer=row['ratings'][q];outcome=answer if answer in ['tie','neither'] else 'learned' if t['order'][0 if answer=='A' else 1]==1 else 'control';g['ratings'][q][outcome]+=1
    return dict(eligible_self_reported_trials=len(accepted),excluded=excluded,groups=groups,limitations=['Automation flag and self-report are not proof of a human reviewer or attention.','Source filename and unfamiliarity self-report do not verify corpus independence.','Repeated reviewers and songs are not independent statistical trials; no confidence interval or success claim is computed.','No physical input-to-light latency is measured.'])

def main():
    ap=argparse.ArgumentParser();ap.add_argument('inputs',type=Path,nargs='+');ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();result=audit([(str(p),json.loads(p.read_text())) for p in a.inputs])
    with a.out.open('x') as f:json.dump(result,f,indent=2,allow_nan=False)
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
