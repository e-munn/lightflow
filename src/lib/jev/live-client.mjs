import {z} from 'zod';
import {describeLive,GESTURES,FOCUSES,CONTRASTS} from '../../../public/jev-live.mjs';
import {JevError,JEV_MODEL} from './client.mjs';
export {JevError};
const unit=z.number().finite().min(0).max(1);
const summary=z.object({duration:z.number().finite().positive().max(10.1),rms:z.number().finite().min(0).max(8),
  variation:z.number().finite().min(0).max(10),attacksPerSecond:z.number().finite().min(0).max(51),
  low:unit,mid:unit,high:unit,texture:unit,flatness:unit,build:unit,lowNovelty:unit,midNovelty:unit,highNovelty:unit}).strict();
export const snapshotSchema=z.object({at:z.number().finite().min(0),current:summary,phrase:summary,previous:summary.nullable(),recentGestures:z.array(z.enum(GESTURES)).max(6)}).strict();
const question=(instructions,criteria)=>({type:'choice',instructions,criteria:{...criteria,uncertain:'The observations do not support a clear choice.'}});
export const QUESTIONS={
  gesture:question('Choose one expressive brightness gesture for the sound in `current`. Use the phrase character as well as the immediate change. Repeated percussion does not always call for another positive flash: consider negative accents or deliberate space when they express the groove. Recent inferred gestures may inform continuity, but change only when the sound supports it. Do not rotate effects just for variety.',{
    trace:'Preserve intricate mixed movement directly when another gesture would obscure it.',
    strike:'A short positive accent for an exposed attack or a newly forceful arrival. Avoid repeating this by default through every busy passage.',
    bloom:'An immediate glow with a connected tail, expressing sustained body or swelling energy.',
    carve:'Attacks briefly cut darkness into an existing glow, then recover. Express a strong continuous body with busy rhythmic interruptions.',
    grain:'Fine fractured light follows rough texture and changing spectral detail, especially subtle high-frequency activity.',
    space:'Select separated accents and leave darkness between them. Express gaps, restrained passages, or a crowded rhythm that benefits from fewer statements.',
  }),
  focus:question('Which measured layer would make the most expressive brightness driver right now? Consider `current.changingLayer`, not only the loudest band. This question chooses a frequency focus, not an instrument.',{
    broad:'The full scope movement; layers move together or a single band would lose important detail.',
    low:'The weight or changes of the low frequencies carry the gesture.',
    mid:'The connected midrange body or its changes carry the gesture.',
    high:'The high-frequency texture or changing detail deserves attention.',
  }),
  contrast:question('How much separation between bright and dark suits the current passage and its change from earlier audio? Choose expressive dynamic contrast, not absolute volume.',{
    soft:'Bring out quieter detail and keep a connected floor; suits subtle sustained or restrained activity.',
    balanced:'Keep the natural range while articulating movement; suits an ongoing mixed passage.',
    deep:'Let smaller movements fall toward darkness and reserve light for strong statements; suits gaps or forceful contrasting arrivals.',
  }),
};
const answer=options=>z.object({type:z.literal('choice'),choice:z.enum([...options,'uncertain']),confidence:unit,
  probabilities:z.object(Object.fromEntries([...options,'uncertain'].map(k=>[k,unit]))).strict()})
  .refine(a=>Math.abs(Object.values(a.probabilities).reduce((s,v)=>s+v,0)-1)<.025)
  .refine(a=>a.probabilities[a.choice]>=Math.max(...Object.values(a.probabilities))-.001);
const resultSchema=z.object({model:z.string().max(80),answers:z.object({gesture:answer(GESTURES),focus:answer(FOCUSES),contrast:answer(CONTRASTS)}),
  usage:z.object({input_tokens:z.number().int().nonnegative(),output_tokens:z.number().int().nonnegative()})});

/** @param {unknown} snapshot
 * @param {{key?: string,signal?: AbortSignal,timeoutMs?: number}} [options] */
export async function requestJev(snapshot,{key,signal=undefined,timeoutMs=1100}={}){
  if(!key)throw new JevError('TYPESAFE_API_KEY is not configured on the server.',503);
  const parsed=snapshotSchema.parse(snapshot),started=performance.now(),timeout=AbortSignal.timeout(timeoutMs);
  let response;
  try{response=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',redirect:'error',cache:'no-store',
    signal:signal?AbortSignal.any([signal,timeout]):timeout,headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
    body:JSON.stringify({model:JEV_MODEL,state:describeLive(parsed),questions:QUESTIONS})});}
  catch{throw new JevError('Jev response timed out. The local signal continues.',504);}
  if(!response.ok)throw new JevError(response.status===401?'TypeSafe rejected the configured API key.':response.status===429||response.status===529?'TypeSafe is busy; retrying shortly.':'TypeSafe could not complete this decision.',response.status===429?429:502);
  const result=resultSchema.safeParse(await response.json().catch(()=>null));
  if(!result.success)throw new JevError('TypeSafe returned an unexpected decision format.');
  return {...result.data,capturedAt:parsed.at,roundTripMs:Math.round(performance.now()-started)};
}
