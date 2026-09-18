import {mkdir,stat,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {RESEARCH_MEDIA} from '@/lib/scope/assets';
import {validateMomentBatch} from '@/lib/scope/moments';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return new Response('Cross-origin submission rejected',{status:403});
 if(!request.headers.get('content-type')?.startsWith('application/json'))return new Response('JSON required',{status:415});
 if(Number(request.headers.get('content-length'))>4_000_000)return new Response('Review batch too large',{status:413});
 let moments;
 try{const raw=await request.text();if(Buffer.byteLength(raw)>4_000_000)return new Response('Review batch too large',{status:413});moments=validateMomentBatch(JSON.parse(raw));}catch{return new Response('Invalid listening marks',{status:400});}
 try{
  const root='/Volumes/ExtremePro/Code/lightflow/research';if(!(await stat(root)).isDirectory())throw Error('Research drive unavailable');
  const directory=path.join(root,'brightness_feedback',moments.some(m=>m.automated)?'automated':'submitted');await mkdir(directory,{recursive:true});
  const sourceAssets=await Promise.all([...new Set(moments.filter(m=>m.source.kind==='url').map(m=>m.source.url!))].map(async url=>{
   const file=RESEARCH_MEDIA[url.split('/').at(-1)!];
   try{const info=await stat(file);return {url,path:file,bytes:info.size,modifiedMs:info.mtimeMs,identityAt:'save time',contentHashVerified:false};}catch{return {url,path:file,available:false,identityAt:'save time',contentHashVerified:false};}
  }));
  const id=randomUUID(),savedAt=new Date().toISOString();
  const file=path.join(directory,`moments_${savedAt.replace(/[:.]/g,'-')}_${id}.json`);
  await writeFile(file,JSON.stringify({version:1,id,savedAt,moments,sourceAssets,physicalTimingMeasured:false,reviewStatus:'Unverified listener observations; not exact brightness targets'},null,2),{flag:'wx'});
  return Response.json({id,saved: moments.map(m=>m.id),savedAt},{headers:{'Cache-Control':'no-store'}});
 }catch{return new Response('Could not save. Connect ExtremePro, or export your marks.',{status:503});}
}
