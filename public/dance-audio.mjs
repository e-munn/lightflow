/** Causal feature/inference implementation. Keep parity with audio_features.py. */
export const RATE=16000, WINDOW=512, HOP=320;
export const EDGES=[0,80,160,320,640,1280,2560,5120,8001], LAGS=[0,1,2,4,8,16,32,64];
const hann=Float64Array.from({length:WINDOW},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(WINDOW-1)));
const clamp=x=>Math.max(0,Math.min(1,x));

function powerSpectrum(samples){
 const re=Float64Array.from(samples,(v,i)=>v*hann[i]), im=new Float64Array(WINDOW);
 for(let i=1,j=0;i<WINDOW;i++){
  let bit=WINDOW>>1; for(;j&bit;bit>>=1)j^=bit; j^=bit;
  if(i<j){const a=re[i];re[i]=re[j];re[j]=a;}
 }
 for(let size=2;size<=WINDOW;size<<=1){
  const angle=-2*Math.PI/size;
  for(let start=0;start<WINDOW;start+=size){
   for(let j=0;j<size/2;j++){
    const a=start+j,b=a+size/2,c=Math.cos(angle*j),s=Math.sin(angle*j);
    const real=re[b]*c-im[b]*s,imag=re[b]*s+im[b]*c;
    re[b]=re[a]-real;im[b]=im[a]-imag;re[a]+=real;im[a]+=imag;
   }
  }
 }
 return Float64Array.from({length:WINDOW/2+1},(_,i)=>(re[i]**2+im[i]**2)/WINDOW**2);
}

export function regress(model,features){
 const out=Array.from(model.offset);
 for(let i=0;i<model.mean.length;i++){
  const z=Math.max(-8,Math.min(8,(features[model.indices[i]]-model.mean[i])/model.std[i]));
  for(let j=0;j<out.length;j++)out[j]+=z*model.weights[i][j];
 }
 return out.map(clamp);
}
export const projectMovement=y=>clamp(.10+.45*y[3]+.25*y[4]+.10*y[0]+.10*y[1]);

export class DanceAudio {
 constructor(model=null){this.model=model;this.reset();}
 reset(){this.window=new Float64Array(WINDOW);this.previous=new Float64Array(8);this.history=[];this.count=0;}
 step(chunk){
  if(chunk.length!==HOP)throw Error('Expected 320 mono samples at 16 kHz');
  for(const x of chunk)if(!Number.isFinite(x))throw Error('Nonfinite audio');
  this.window.copyWithin(0,HOP);this.window.set(chunk,WINDOW-HOP);
  const power=powerSpectrum(this.window),bands=new Array(8).fill(0);
  let total=0,weighted=0,squares=0,crossings=0;
  for(let i=0;i<power.length;i++){
   const hz=i*RATE/WINDOW;total+=power[i];weighted+=hz*power[i];
   for(let j=0;j<8;j++)if(hz>=EDGES[j]&&hz<EDGES[j+1]){bands[j]+=power[i];break;}
  }
  let flux=0;
  for(let j=0;j<8;j++){bands[j]=Math.log1p(10000*bands[j]);flux+=Math.max(0,bands[j]-this.previous[j])/8;}
  for(let i=0;i<WINDOW;i++){squares+=this.window[i]**2;if(i>0&&(this.window[i-1]>=0)!==(this.window[i]>=0))crossings++;}
  const rms=Math.sqrt(squares/WINDOW);
  const base=[...bands,Math.log1p(100*rms),flux,weighted/Math.max(1e-12,total)/(RATE/2),crossings/(WINDOW-1)];
  this.previous.set(bands);this.history.push(base);if(this.history.length>65)this.history.shift();
  const features=LAGS.flatMap(lag=>this.history[Math.max(0,this.history.length-1-lag)]);
  this.count++;const t=this.count*HOP/RATE;
  const result={t,rms,features,ready:t>=(this.model?.warmupSeconds??1.32)};
  if(this.model){
   const components=regress(this.model.models.movement,features);
   result.components=components;result.movement=projectMovement(components);
   result.direct=regress(this.model.models.direct,features)[0];
   result.rmsModel=regress(this.model.models.rms,features)[0];
   // Explicit product guard, outside trained regression. Exact digital silence
   // should not emit the nonzero mean of dance-pose labels.
   result.silent=rms<.0001;
   if(result.silent){result.movement=0;result.direct=0;result.rmsModel=0;}
  }
  return result;
 }
}

export function inferBuffer(samples,model){
 const engine=new DanceAudio(model),frames=[];
 for(let i=0;i+HOP<=samples.length;i+=HOP)frames.push(engine.step(samples.subarray(i,i+HOP)));
 return frames;
}
