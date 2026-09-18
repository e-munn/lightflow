/** Shared causal features for the worklet, dataset extractor and runtime tests.
 * Windows contain ONLY received samples. No track normalization or future padding.
 */
export const VERSION = 'scope-causal-v1';
export const FPS = 50;
export const FEATURE_NAMES = ['amplitude','spread','texture','balance','bass','air','attack','correlation'];
export const LAGS = [0,1,2,4,8,16,25,50,100];
export const TARGET_INDICES = [0,1,2,6];
export const HORIZONS = [5,13];
export const clamp = (x, lo=0, hi=1) => Math.max(lo, Math.min(hi,x));
export class ScopeFeatures {
  constructor(sampleRate=48000) {
    this.sampleRate=sampleRate; this.window=Math.round(sampleRate/FPS);
    this.low=[0,0];this.mid=[0,0];this.previousAmplitude=0;
    this.lowAlpha=1-Math.exp(-2*Math.PI*180/sampleRate);
    this.midAlpha=1-Math.exp(-2*Math.PI*2500/sampleRate);
  }
  frame(left,right=left) {
    if(left.length!==this.window || right.length!==left.length) throw Error('Invalid feature window');
    let ll=0,rr=0,lr=0,l=0,r=0,delta=0,lowEnergy=0,airEnergy=0;
    for(let i=0;i<left.length;i++) {
      const a=left[i],b=right[i]; ll+=a*a;rr+=b*b;lr+=a*b;l+=a;r+=b;
      if(i)delta+=Math.hypot(a-left[i-1],b-right[i-1]);
      this.low[0]+=this.lowAlpha*(a-this.low[0]);this.low[1]+=this.lowAlpha*(b-this.low[1]);
      this.mid[0]+=this.midAlpha*(a-this.mid[0]);this.mid[1]+=this.midAlpha*(b-this.mid[1]);
      lowEnergy+=this.low[0]**2+this.low[1]**2;
      airEnergy+=(a-this.mid[0])**2+(b-this.mid[1])**2;
    }
    const n=left.length,energy=ll+rr,rms=Math.sqrt(energy/(2*n));
    const xx=Math.max(0,ll/n-(l/n)**2),yy=Math.max(0,rr/n-(r/n)**2),xy=lr/n-l*r/(n*n);
    const disc=Math.sqrt((xx-yy)**2+4*xy*xy),major=(xx+yy+disc)/2,minor=Math.max(0,(xx+yy-disc)/2);
    const amplitude=1-Math.exp(-6*rms),active=rms>0.0001;
    const f=[amplitude,active?Math.sqrt(minor/Math.max(major,1e-12)):0,
      active?clamp(delta/(n-1)/Math.max(rms,1e-8)*this.sampleRate/48000/1.5):0,
      active?(rr-ll)/Math.max(energy,1e-12):0,
      active?clamp(lowEnergy/Math.max(energy,1e-12)):0,
      active?clamp(airEnergy/Math.max(energy,1e-12)):0,
      clamp((amplitude-this.previousAmplitude)*4),
      active?clamp(xy/Math.sqrt(Math.max(xx*yy,1e-20)),-1,1):0];
    this.previousAmplitude=amplitude;
    return {values:f,rms,peak:Math.max(...left.map(Math.abs),...right.map(Math.abs))};
  }
}
export class FeatureHistory {
  constructor(){this.frames=[];}
  push(frame){this.frames.push(Array.from(frame));if(this.frames.length>101)this.frames.shift();}
  get ready(){return this.frames.length===101;}
  input(){return LAGS.flatMap(lag=>this.frames[Math.max(0,this.frames.length-1-lag)]??Array(8).fill(0));}
}
export function predict(model,input) {
  let x=input.map((v,i)=>(v-model.mean[i])/model.std[i]);
  for(let i=0;i<model.layers.length;i++) {
    const layer=model.layers[i];
    x=layer.weight.map((row,j)=>{
      let y=layer.bias[j];for(let k=0;k<row.length;k++)y+=row[k]*x[k];
      return i===model.layers.length-1 ? 1/(1+Math.exp(-y)) : Math.max(0,y);
    });
  }
  return x;
}
/** Medium-independent procedural adapter. Model predicts audio features, NOT authored cues. */
export function lightSignal(features, forecast, enabled=false, accepted=[]) {
  const [amplitude,spread,texture,balance,bass,air,attack]=features;
  // Only validation-approved future channels can affect the experimental adapter.
  const lift=enabled&&forecast&&accepted[0]?clamp(forecast[0]-amplitude,0,.18)*.35:0;
  return {intensity:clamp(amplitude+attack*.12+lift),spread,texture,balance,
    hue:clamp(.62-.4*bass+.15*air),accent:attack,anticipation:lift,
    provenance:enabled?'procedural mapping with learned audio forecast':'direct causal signal mapping'};
}
