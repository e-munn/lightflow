/** Experimental causal scalar restoration. This module does not select or promote models. */
export class ScopeRestoration {
 constructor(model){
  if(!['scope-restoration-v1','scope-restoration-v2'].includes(model?.version))throw Error('Unsupported restoration model');
  this.model=model;this.limit=model.version==='scope-restoration-v1'?.5:1;
  if(!Array.isArray(model.lags)||model.lags.some(x=>!Number.isInteger(x)||x<0)||model.mean.length!==model.lags.length*9||model.std.length!==model.mean.length||model.mean.some(x=>!Number.isFinite(x))||model.std.some(x=>!Number.isFinite(x)||x<=0))throw Error('Invalid restoration normalization');
  let width=model.mean.length;
  for(const layer of model.layers){if(!layer.weight?.length||layer.bias.length!==layer.weight.length||layer.bias.some(x=>!Number.isFinite(x))||layer.weight.some(row=>row.length!==width||row.some(x=>!Number.isFinite(x))))throw Error('Invalid restoration weights');width=layer.bias.length;}
  if(width!==1)throw Error('Restoration must output one scalar');
  this.length=Math.max(...model.lags)+1;this.reset();
 }
 reset(){this.history=[];this.lastAt=null;}
 push(at,features,observed){
  if(!Number.isFinite(at)||features?.length!==8||Array.from(features).some(v=>!Number.isFinite(v))||!Number.isFinite(observed)||observed<0||observed>1){this.reset();return {brightness:0,ready:false,reason:'invalid input'};}
  if(this.lastAt!==null&&(at<=this.lastAt||Math.abs(at-this.lastAt-.02)>.003))this.reset();
  this.lastAt=at;this.history.push([...features,observed]);if(this.history.length>this.length)this.history.shift();
  if(this.history.length<this.length)return {brightness:observed,ready:false,reason:'context warmup'};
  let x=this.model.lags.flatMap(lag=>this.history[this.history.length-1-lag]);x=x.map((v,i)=>(v-this.model.mean[i])/this.model.std[i]);
  for(let k=0;k<this.model.layers.length;k++){
   const layer=this.model.layers[k],next=new Array(layer.bias.length);
   for(let j=0;j<next.length;j++){let v=layer.bias[j];for(let i=0;i<x.length;i++)v+=layer.weight[j][i]*x[i];next[j]=k===this.model.layers.length-1?v:Math.max(0,v);}x=next;
  }
  const brightness=Math.max(0,Math.min(1,observed+this.limit*Math.tanh(x[0])));
  return {brightness:features[0]===0&&observed===0?0:brightness,ready:true,reason:'experimental model'};
 }
}
