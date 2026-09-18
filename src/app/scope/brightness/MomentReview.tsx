'use client';
import {useEffect,useState} from 'react';
import {validateMomentBatch,type ListeningMoment,type MomentFrame,type MomentSource,type MomentTag} from '@/lib/scope/moments';
const STORE='lightflow-scope-moments-v1';
const labels:Record<MomentTag,string>={follows_music:'Follows the music',missed_detail:'Missed detail',stays_bright:'Stays bright'};
export default function MomentReview({enabled,getContext}:{enabled:boolean;getContext:()=>{source:MomentSource|null;frames:MomentFrame[]}}){
 const [moments,setMoments]=useState<ListeningMoment[]>([]),[saved,setSaved]=useState<string[]>([]),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{try{const raw=localStorage.getItem(STORE);if(!raw)return;const data=JSON.parse(raw);const checked:ListeningMoment[]=[];for(let i=0;i<data.moments.length;i+=25)checked.push(...validateMomentBatch({version:1,moments:data.moments.slice(i,i+25)}));setMoments(checked);setSaved(Array.isArray(data.saved)?data.saved.filter((s:unknown)=>typeof s==='string'):[]);}catch{setMessage('Stored marks could not be read. They have been left unchanged.');}},[]);
 function persist(next:ListeningMoment[],savedIds:string[]){try{localStorage.setItem(STORE,JSON.stringify({version:1,moments:next,saved:savedIds}));}catch{setMessage('Browser storage is full or unavailable. Save or export these marks to keep them.');}}
 function mark(tag:MomentTag){const {source,frames}=getContext();if(!source||frames.length<2||!enabled)return;
  const item:ListeningMoment={id:crypto.randomUUID(),tag,created:new Date().toISOString(),automated:navigator.webdriver===true,source:{...source},frames:frames.map(f=>({...f,features:[...f.features]})),note:'',baseline:'scope-coverage-256-soft-v1',modelEnabled:false,timing:'approximate media clock; reaction window, not exact event label'};
  const next=[...moments,item];setMoments(next);setMessage('Moment marked.');persist(next,saved);
 }
 async function save(){const pending=moments.filter(m=>!saved.includes(m.id));if(!pending.length)return;setSaving(true);let ids=[...saved];
  try{for(let i=0;i<pending.length;i+=25){const response=await fetch('/api/scope-feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,moments:pending.slice(i,i+25)})});if(!response.ok)throw Error(await response.text());const result=await response.json();ids=[...new Set([...ids,...result.saved])];setSaved(ids);persist(moments,ids);}setMessage('Saved on ExtremePro.');}
  catch(e){setMessage(e instanceof Error?e.message:'Could not save. Export your marks to keep them.');}finally{setSaving(false);}
 }
 function exportMarks(){const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,moments},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='lightflow-scope-moments.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const latest=moments.at(-1),unsaved=moments.filter(m=>!saved.includes(m.id)).length;
 return <section aria-label="Listening marks" style={{margin:'28px 0',padding:20,border:'1px solid #34534a',borderRadius:8}}>
 <h2>Mark the last few seconds.</h2><p>Keep listening. Mark a moment that follows the music or misses something.</p>
 <div className="scope-input">{(Object.keys(labels) as MomentTag[]).map(tag=><button key={tag} disabled={!enabled||saving} onClick={()=>mark(tag)}>{labels[tag]}</button>)}</div>
 {!enabled&&<p>Play audio and keep the brightness field visible to mark a moment.</p>}
 <p data-testid="moment-count">{moments.length} marks · {unsaved} not yet saved to the project</p>
 {latest&&<><p>Latest: {labels[latest.tag]}{latest.frames.at(-1)?.sourceSeconds!=null?` · ${latest.frames.at(-1)!.sourceSeconds!.toFixed(1)} s into the source`:''}</p><label>Optional note for this mark<textarea aria-label="Note for latest mark" maxLength={1000} disabled={saving||saved.includes(latest.id)} value={latest.note} onChange={e=>setMoments(items=>items.map(m=>m.id===latest.id?{...m,note:e.target.value}:m))} onBlur={()=>persist(moments,saved)} style={{display:'block',width:'100%',maxWidth:600,minHeight:55,background:'#10221c',color:'#e4eee8',border:'1px solid #34534a',padding:10}}/></label></>}
 <div className="scope-input"><button disabled={!unsaved||saving} onClick={save}>{saving?'Saving…':'Save marks to project'}</button><button disabled={!moments.length||saving} onClick={exportMarks}>Export marks</button></div>
 <p role="status" aria-live="polite">{message}</p><small>Only signal data and your marks are saved. Live microphone audio is not recorded. These marks identify moments to review, not exact training labels.</small>
 </section>;
}
