/// <reference lib="webworker" />
import { MelStream } from '../../../public/director-dsp.js';
import * as ort from 'onnxruntime-web/wasm';
let session:ort.InferenceSession|undefined;
let phraseSession:ort.InferenceSession|undefined;
let frontend:MelStream|undefined;
let busy=false;
let pending: {window:Float32Array;at:number;level:number;frames:number}|null=null;
async function infer(){
 if(busy||!session||!pending)return;busy=true;const current=pending;pending=null;
 try{const start=performance.now();const tensor=new ort.Tensor('float32',current.window,[1,128,96]);const out=await session.run({mel:tensor});const phrase=phraseSession?await phraseSession.run({mel:tensor}):undefined;postMessage({type:'prediction',logits:phrase?Array.from(phrase.logits.data as Float32Array):undefined,values:Array.from(out.lighting.data as Float32Array),ms:performance.now()-start,at:current.at,level:current.level,frames:current.frames});}catch(e){postMessage({type:'error',message:String(e)});}finally{busy=false;if(pending)void infer();}
}
self.onmessage=async({data})=>{
 if(data.type==='init'){
  try{ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths='/ort/';const bank=await fetch('/models/mel-bank.json').then(r=>{if(!r.ok)throw Error('Music model assets are not available');return r.json();});frontend=new MelStream(bank);session=await ort.InferenceSession.create('/models/concert.onnx',{executionProviders:['wasm']});phraseSession=await ort.InferenceSession.create('/models/phrases.onnx',{executionProviders:['wasm']});const library=await fetch('/models/phrases.json').then(r=>{if(!r.ok)throw Error('Phrase library unavailable');return r.json();});postMessage({type:'ready',library});}catch(e){postMessage({type:'error',message:String(e)});}return;
 }
 if(data.type==='pcm'&&frontend){let sum=0;for(const sample of data.pcm as Float32Array)sum+=sample*sample;const chunkEnd=frontend.written+data.pcm.length;frontend.push(data.pcm,(window:Float32Array)=>{const frameAt=data.at-(chunkEnd-frontend!.written)/22050;pending={window,at:frameAt,level:Math.sqrt(sum/data.pcm.length),frames:frontend!.frames};void infer();});}
};
