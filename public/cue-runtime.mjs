/** Streaming port of the experimental native-cue model. No future audio. */
const f32=Math.fround;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const CUE_METHODS=['direct','learned','instant_context','delayed_model'];
export const CUE_OUTPUTS=['intensity','hue','spread','texture','balance','accent','gain','spread_gain'];

function rhythm(raw){
 const n=raw.length,out=new Float32Array(6);
 if(n<100||Math.max(...raw)<1e-5)return out;
 const mean=raw.reduce((a,b)=>a+b,0)/n,c=raw.map(v=>v-mean),squares=new Float64Array(n+1);
 for(let i=0;i<n;i++)squares[i+1]=squares[i]+c[i]*c[i];
 const scores=[];
 for(let lag=15;lag<=50;lag++){
  let numerator=0;for(let i=0;i<n-lag;i++)numerator+=c[i]*c[i+lag];
  const denominator=Math.sqrt(Math.max(0,squares[n-lag]*(squares[n]-squares[lag])));
  scores.push(numerator/Math.max(denominator,1e-12));
 }
 const best=Math.max(...scores),index=scores.findIndex(v=>v>=best-.01),period=index+15,strength=clamp(scores[index]);
 const bins=new Float64Array(period);for(let i=0;i<n;i++)bins[i%period]+=raw[i];
 let phaseBin=0;for(let i=1;i<period;i++)if(bins[i]>bins[phaseBin])phaseBin=i;
 const phase=2*Math.PI*((n-1-phaseBin)%period)/period;
 out.set([50/period/4,strength,strength*Math.sin(phase),strength*Math.cos(phase),strength*Math.sin(2*phase),strength*Math.cos(2*phase)]);
 return out;
}

export class CueFeatures {
 constructor(){this.block=[];this.attacks=[];this.relative=[null,null,null];this.count=0;}
 push(values){
  if(values.length!==24||!Array.from(values).every(Number.isFinite))throw Error('Invalid cue audio features');
  // The training extractor writes seven decimal places. Direct scope values
  // remain untouched; this rounding is only for the learned input contract.
  const row=Array.from(values,v=>Number(v.toFixed(7)));
  this.attacks.push(row[6]);if(this.attacks.length>800)this.attacks.shift();
  this.block.push(row);if(this.block.length<5)return null;
  const x=new Float32Array(81);
  for(let j=0;j<24;j++){
   let sum=0,max=-Infinity;for(const v of this.block){sum+=v[j];max=Math.max(max,v[j]);}
   x[j]=sum/5;x[j+24]=max;
  }
  const values9=[...x.slice(8,16),x[0]];
  [.5,2,8].forEach((seconds,k)=>{
   const state=this.relative[k]??(this.relative[k]=Float64Array.from(values9)),a=1-Math.exp(-.1/seconds);
   for(let j=0;j<9;j++){state[j]+=a*(values9[j]-state[j]);x[48+k*9+j]=values9[j]-state[j];}
  });
  x.set(rhythm(this.attacks),75);this.block=[];this.count++;return x;
 }
}

export class CueTCN {
 constructor(model){
  if(model.version!=='native-light-edge-forecast-v1'||model.mean?.length!==81||model.std?.length!==81)throw Error('Unsupported cue model');
  this.mean=Float32Array.from(model.mean);this.std=Float32Array.from(model.std);
  if(!this.std.every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid cue normalization');
  this.layers=[];this.count=0;
  for(let i=0;i<7;i++){
   const inputs=i===0?81:24,dilation=2**i,length=2*dilation+1;
   const w=model.state[`layers.${i}.weight`],b=model.state[`layers.${i}.bias`];
   if(w?.length!==24||b?.length!==24||w.some(r=>r.length!==inputs||r.some(k=>k.length!==3)))throw Error('Invalid cue layer');
   const weight=Float32Array.from(w.flat(2)),bias=Float32Array.from(b);
   if(!weight.every(Number.isFinite)||!bias.every(Number.isFinite))throw Error('Nonfinite cue weights');
   this.layers.push({inputs,dilation,length,weight,bias,history:Array.from({length},()=>new Float32Array(inputs))});
  }
  const head=model.state['head.weight'];if(head?.length!==4||head.some(r=>r.length!==24||r.some(k=>k.length!==1)))throw Error('Invalid cue head');
  this.head=Float32Array.from(head.flat(2));this.bias=Float32Array.from(model.state['head.bias']);
  if(this.bias.length!==4||!this.head.every(Number.isFinite)||!this.bias.every(Number.isFinite))throw Error('Invalid cue head weights');
 }
 push(features){
  if(features.length!==81||!Array.from(features).every(Number.isFinite))throw Error('Invalid cue input');
  let x=Float32Array.from(features,(v,i)=>f32(f32(v-this.mean[i])/this.std[i]));
  for(let layerId=0;layerId<7;layerId++){
   const layer=this.layers[layerId],cursor=this.count%layer.length;layer.history[cursor].set(x);
   const taps=[2,1,0].map(k=>this.count<k*layer.dilation?null:layer.history[(cursor-k*layer.dilation+layer.length)%layer.length]);
   const next=new Float32Array(24);
   for(let o=0;o<24;o++){
    let value=layer.bias[o];const offset=o*layer.inputs*3;
    for(let j=0;j<layer.inputs;j++)for(let k=0;k<3;k++)if(taps[k])value+=taps[k][j]*layer.weight[offset+j*3+k];
    value=f32(value);const activated=f32(value/(1+Math.exp(-value)));
    next[o]=layerId===0?activated:f32(f32(x[o]+activated)/f32(1.41421356));
   }
   x=next;
  }
  const result=new Float32Array(4);
  for(let o=0;o<4;o++){
   let value=this.bias[o];for(let j=0;j<24;j++)value+=this.head[o*24+j]*x[j];
   result[o]=1/(1+Math.exp(-f32(value)));
  }
  this.count++;return result;
 }
}

export class CuePolicy {
 constructor(prior){this.prior=Float64Array.from(prior);this.state=Float64Array.from(prior);this.previous=null;}
 push(now,scope,probability=null){
  const p=probability??this.prior,dt=this.previous===null?.02:now-this.previous;
  if(!(dt>0)||scope.length!==8||p.length!==4||!Array.from(scope).every(Number.isFinite)||!Array.from(p).every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Invalid cue policy frame');
  this.previous=now;
  for(let j=0;j<4;j++)this.state[j]+=-Math.expm1(-dt/(j<2?.15:.6))*(p[j]-this.state[j]);
  const near=this.state[0]-this.state[1]-this.prior[0]+this.prior[1];
  const far=this.state[2]-this.state[3]-this.prior[2]+this.prior[3];
  const gain=clamp(1+.6*near+.4*far,.75,1.25),spreadGain=clamp(1+.25*(this.state[2]+this.state[3]-this.prior[2]-this.prior[3]),.8,1.2);
  const [amplitude,spread,texture,balance,bass,air,attack]=scope;
  return Float32Array.from([clamp(clamp(amplitude+.12*attack)*gain),clamp(.62-.4*bass+.15*air),clamp(spread*spreadGain),texture,balance,attack,gain,spreadGain]);
 }
}

/** Four-condition streaming comparison. The clock callback measures completion
 * on the AudioContext clock; offline callers use the explicit 20 ms allowance. */
export class CueComparison {
 /** @param {any} bundle @param {null|(()=>number)} [clock] */
 constructor(bundle,clock=null){this.bundle=bundle;this.clock=clock;this.resets=0;this.reset();}
 reset(){
  const {model,prior,baseline}=this.bundle;
  if(prior?.length!==4||!prior.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Invalid cue prior');
  if(baseline?.weight?.length!==4||baseline.weight.some(r=>r.length!==81)||baseline.bias?.length!==4)throw Error('Invalid cue baseline');
  this.features=new CueFeatures();this.model=new CueTCN(model);this.delayed=new CueTCN(model);
  this.policies=CUE_METHODS.map(()=>new CuePolicy(prior));this.delay=[];this.pending=[];this.held=null;this.previous=null;this.audioFrames=0;
 }
 push(at,scope,music){
  if(!Number.isFinite(at))throw Error('Invalid cue timestamp');
  if(this.previous!==null&&(at<=this.previous||at-this.previous>.030001)){this.reset();this.resets++;}
  this.previous=at;this.audioFrames++;
  const x=this.features.push([...scope,...music]);
  if(x){
   const learned=this.model.push(x);this.delay.push(x);
   const delayed=this.delayed.push(this.delay.length>170?this.delay.shift():this.delay[0]);
   const normalized=Array.from(x,(v,i)=>f32(f32(v-this.model.mean[i])/this.model.std[i]));
   const linear=Float32Array.from(this.bundle.baseline.weight,(row,o)=>{
    let value=this.bundle.baseline.bias[o];for(let j=0;j<81;j++)value+=row[j]*normalized[j];
    return 1/(1+Math.exp(-value));
   });
   const readyAt=Math.max(at+.02,this.clock?.()??-Infinity);
   this.pending.push({at,readyAt,probabilities:[this.bundle.prior,learned,linear,delayed],ready:this.features.count>=255,delayedReady:this.features.count>=425});
  }
  while(this.pending.length&&this.pending[0].readyAt<=at+1e-9)this.held=this.pending.shift();
  // A stalled host must not keep an old learned state indefinitely. The direct
  // signal remains current; the policy relaxes to its neutral training prior.
  const valid=this.held&&at-this.held.at<=.5;
  const output=this.policies.map((policy,k)=>policy.push(at,scope,valid&&(k===3?this.held.delayedReady:this.held.ready)?this.held.probabilities[k]:null));
  return {output,ready:!!(valid&&this.held.ready),delayedReady:!!(valid&&this.held.delayedReady),predictionAt:valid?this.held.at:null,
   predictionReadyAt:valid?this.held.readyAt:null,audioFrames:this.audioFrames,resets:this.resets,
   ...(x?{features:x,prediction:this.pending.at(-1)?.probabilities[1]}:{})};
 }
}
