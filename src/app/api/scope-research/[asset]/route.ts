import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {RESEARCH_MEDIA} from '@/lib/scope/assets';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const media=RESEARCH_MEDIA;
export async function GET(request:Request,{params}:{params:Promise<{asset:string}>}){
 const {asset}=await params;
 try{
  if(asset==='cue-model'){
   const directory='/Volumes/ExtremePro/Code/lightflow/research/native_cues/forecast_gain_v1';
   const [model,evaluation,baselines]=await Promise.all(['model.json','evaluation.json','baselines.json'].map(name=>readFile(path.join(directory,name),'utf8').then(JSON.parse)));
   return Response.json({model,prior:evaluation.prior,baseline:baselines.instant_context,experimental:true},{headers:{'Cache-Control':'no-store'}});
  }
  if(asset==='model'){
   const pointer=JSON.parse(await readFile(path.join(process.cwd(),'research/scope_foundation/active-run.json'),'utf8'));
   const root='/Volumes/ExtremePro/Code/lightflow/research/scope_foundation/';
   const directory=path.resolve(pointer.directory);
   if(!directory.startsWith(root))throw Error('Invalid model directory');
   return new Response(await readFile(path.join(directory,'model.json')),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  const file=media[asset];if(!file)return new Response('Unknown research asset',{status:404});
  const {size}=await stat(file);const range=request.headers.get('range');let start=0,end=size-1;
  if(range){
   const match=/^bytes=(\d*)-(\d*)$/.exec(range);
   if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
   if(!match[1])start=Math.max(0,size-Number(match[2]));
   else {start=Number(match[1]);if(match[2])end=Math.min(size-1,Number(match[2]));}
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
  }
  const stream=createReadStream(file,{start,end});
  request.signal.addEventListener('abort',()=>stream.destroy(),{once:true});
  const headers:Record<string,string>={'Content-Type':file.endsWith('.mp4')?'video/mp4':file.endsWith('.wav')?'audio/wav':'audio/mp4','Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Cache-Control':'no-store'};
  if(range)headers['Content-Range']=`bytes ${start}-${end}/${size}`;
  return new Response(Readable.toWeb(stream) as ReadableStream,{status:range?206:200,headers});
 }catch{return new Response('Research asset unavailable. Connect ExtremePro and check the active run.',{status:503});}
}
