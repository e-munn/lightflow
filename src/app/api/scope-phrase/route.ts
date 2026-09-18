import {mkdir,stat,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {readPhrase} from '@/lib/scope/phrase';
import {buildPhrase,validPhraseSettings,PHRASE_VERSION} from '../../../../public/scope-phrase.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){try{return Response.json(await readPhrase(),{headers:{'Cache-Control':'no-store'}});}catch{return new Response('Connect ExtremePro to load this comparison.',{status:503});}}
export async function POST(request:Request){
 // Next may canonicalize request.url to localhost even when the browser used
 // 127.0.0.1. Compare against the actual request authority, not that rewrite.
 const origin=request.headers.get('origin'),url=new URL(request.url),host=request.headers.get('host')??url.host;
 if(origin&&origin!==`${url.protocol}//${host}`)return new Response('Cross-origin submission rejected',{status:403});
 if(!request.headers.get('content-type')?.startsWith('application/json'))return new Response('JSON required',{status:415});
 if(Number(request.headers.get('content-length'))>100_000)return new Response('Review too large',{status:413});
 let input;try{const text=await request.text();if(Buffer.byteLength(text)>100_000)throw Error();input=JSON.parse(text);}catch{return new Response('Invalid review',{status:400});}
 let data;try{data=await readPhrase();}catch{return new Response('Connect ExtremePro to save this comparison.',{status:503});}
 const votes=['scope','shaped','unclear','detail_lost'];
 if(input?.version!==PHRASE_VERSION||input.sourceHash!==data.source.excerptSha256||!votes.includes(input.vote)||typeof input.automated!=='boolean'||typeof input.note!=='string'||input.note.length>1500||!validPhraseSettings(input.settings,data.source.durationSeconds))return new Response('Invalid comparison settings or source',{status:400});
 const seen=input.seen;
 if(!Array.isArray(seen)||seen.length!==2||seen.some((a:unknown)=>!Array.isArray(a)||a.length>data.frames.length||a.some((i:unknown)=>!Number.isInteger(i)||Number(i)<0||Number(i)>=data.frames.length)))return new Response('Invalid listening record',{status:400});
 const coverage=seen.map((indices:number[])=>{const unique=[...new Set(indices)];return{beforeSeconds:unique.filter(i=>data.frames[i].time<input.settings.impact).length/data.fps,afterSeconds:unique.filter(i=>data.frames[i].time>=input.settings.impact).length/data.fps};});
 if(coverage.some(c=>c.beforeSeconds<2||c.afterSeconds<2))return new Response('Listen to both views before and after the marker, then save.',{status:400});
 const settings={impact:input.settings.impact,quiet:input.settings.quiet,decay:input.settings.decay,match:input.settings.match},output=buildPhrase(data.frames,settings);
 const id=randomUUID(),savedAt=new Date().toISOString(),record={id,savedAt,version:PHRASE_VERSION,automated:input.automated,source:data.source,settings,vote:input.vote,note:input.note,coverage,seen,comparisonStats:output.stats,gain:output.gain,preferredCircle:data.preferredCircle,unobservedCircleDefaults:data.unobservedCircleDefaults,styleSettings:data.styleSettings,physicalLatencyMeasured:false,trainedModel:false,trainingReady:false,reviewStatus:'Listener preference on one marked, known excerpt; exact targets proposed by assistant, not frame-level human labels',frames:data.frames.map((f,i)=>({...f,baseline:output.baseline[i],proposedBrightness:output.shaped[i],mode:output.modes[i]}))};
 try{const root='/Volumes/ExtremePro/Code/lightflow/research';if(!(await stat(root)).isDirectory())throw Error();const directory=`${root}/brightness_feedback/phrase_${input.automated?'automated':'submitted'}`;await mkdir(directory,{recursive:true});await writeFile(`${directory}/${id}.json`,JSON.stringify(record),{flag:'wx'});return Response.json({id,savedAt,coverage},{headers:{'Cache-Control':'no-store'}});}catch{return new Response('Could not save. Check that ExtremePro is connected.',{status:503});}
}
