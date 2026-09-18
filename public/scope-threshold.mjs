/** Experimental visual dynamics on the existing scope raster; never alters audio.
 * Radius is measured in half-widths of the 256px canvas. The threshold is a
 * spatial mask, not a frequency separator or an audio compressor's dB curve.
 */
import {coverageBrightness,SCOPE_SIZE} from './scope-brightness.mjs';
export const THRESHOLD_VERSION='scope-radial-dynamics-v1';
export const THRESHOLD_DEFAULTS={radius:.35,below:'soft',above:'keep',ratio:2,adaptive:false,adaptSeconds:3,attackMs:0,releaseMs:0,makeup:1};
const count=SCOPE_SIZE*SCOPE_SIZE,clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const radii=Float64Array.from({length:count},(_,i)=>Math.hypot(i%SCOPE_SIZE+.5-SCOPE_SIZE/2,Math.floor(i/SCOPE_SIZE)+.5-SCOPE_SIZE/2)/(SCOPE_SIZE/2));
const BINS=256,MAX_RADIUS=Math.SQRT2;
const binIndex=Uint16Array.from(radii,r=>Math.min(BINS-1,Math.floor(r/MAX_RADIUS*BINS)));
export function radialWeight(radius,threshold,below='soft',above='keep',ratio=2){
 if(!Number.isFinite(radius)||!Number.isFinite(threshold)||threshold<=0||!Number.isFinite(ratio))return 0;
 const relative=Math.max(0,radius/threshold),power=clamp(ratio,1,4)-1;
 if(relative<1){if(below==='cut')return 0;if(below==='soft')return relative**power;return 1;}
 if(above==='compress')return relative**(1/clamp(ratio,1,4)-1);
 if(above==='expand')return Math.min(4,relative**power);
 return 1;
}
export class RadialThreshold {
 constructor(){this.settings={...THRESHOLD_DEFAULTS};this.trackedRadius=THRESHOLD_DEFAULTS.radius;this.previousAt=null;this.output=0;this.reset();}
 configure(settings={}){
  this.settings={...this.settings,...settings};const s=this.settings;
  for(const key of ['radius','ratio','adaptSeconds','attackMs','releaseMs','makeup'])if(!Number.isFinite(s[key]))throw Error('Nonfinite threshold setting');
  if(!['keep','soft','cut'].includes(s.below)||!['keep','compress','expand'].includes(s.above))throw Error('Unknown radial response');
  s.radius=clamp(s.radius,.03,1.2);s.ratio=clamp(s.ratio,1,4);s.adaptSeconds=clamp(s.adaptSeconds,.25,10);
  s.attackMs=clamp(s.attackMs,0,200);s.releaseMs=clamp(s.releaseMs,0,1000);s.makeup=clamp(s.makeup,.05,20);
  this.reset();
 }
 reset(){this.previousAt=null;this.trackedRadius=this.settings.radius;this.output=0;}
 frame(pixels,at){
  const s=this.settings;
  if(!Number.isFinite(at)||pixels?.length!==count*4){this.reset();return this.empty(false);}
  if(this.previousAt!==null&&(at<=this.previousAt||at-this.previousAt>.25))this.reset();
  const dt=this.previousAt===null?.02:at-this.previousAt;this.previousAt=at;
  // Current output uses the previous radius estimate. No future/current-frame
  // normalization can shrink a new accent before that accent is displayed.
  const threshold=s.adaptive?this.trackedRadius:s.radius;
  const histogram=new Float64Array(BINS);let total=0,weighted=0,outside=0;
  for(let i=0;i<count;i++){
   const ink=pixels[i*4]/255;if(!Number.isFinite(ink)||ink<0||ink>1){this.reset();return this.empty(false);}
   if(!ink)continue;total+=ink;histogram[binIndex[i]]+=ink;
   if(radii[i]>=threshold)outside+=ink;
   weighted+=ink*radialWeight(radii[i],threshold,s.below,s.above,s.ratio);
  }
  const coverage=total/count,weightedCoverage=weighted/count;
  const baseline=coverageBrightness(coverage,40,true),target=coverageBrightness(weightedCoverage,40*s.makeup,true);
  if(!total){this.output=0;return {...this.empty(true),radius:threshold};}
  // Adapt only while there is a visible trace. Quiet pauses cannot collapse
  // the threshold toward zero. The caller resets on stopped/stale input.
  let cumulative=0,q60=0;for(let i=0;i<BINS;i++){cumulative+=histogram[i];if(cumulative>=total*.6){q60=(i+.5)/BINS*MAX_RADIUS;break;}}
  if(s.adaptive)this.trackedRadius+=(1-Math.exp(-dt/s.adaptSeconds))*(clamp(q60,.03,1.2)-this.trackedRadius);
  const tau=(target>this.output?s.attackMs:s.releaseMs)/1000;
  this.output=tau?this.output+(1-Math.exp(-dt/tau))*(target-this.output):target;
  return {valid:true,baseline,brightness:clamp(this.output,0,1),rawBrightness:target,coverage,weightedCoverage,radius:threshold,outsideFraction:outside/total,q60};
 }
 empty(valid){return {valid,baseline:0,brightness:0,rawBrightness:0,coverage:0,weightedCoverage:0,radius:this.settings.adaptive?this.trackedRadius:this.settings.radius,outsideFraction:0,q60:0};}
}
/** One fixed exposure correction fitted to a preceding calibration interval.
 * Matches mean displayed brightness, not just raster energy. Never updates
 * frame by frame during the later listening comparison.
 */
export function matchMeanBrightness(frames){
 const valid=frames.filter(f=>Number.isFinite(f.baseline)&&Number.isFinite(f.weightedCoverage)&&f.weightedCoverage>=0);
 if(valid.length<25)return null;
 const reference=valid.reduce((sum,f)=>sum+f.baseline,0)/valid.length;
 const mean=gain=>valid.reduce((sum,f)=>sum+coverageBrightness(f.weightedCoverage,40*gain,true),0)/valid.length;
 if(reference<.005||!valid.some(f=>f.weightedCoverage>0))return null;
 let low=.05,high=20;for(let i=0;i<40;i++){const middle=(low+high)/2;if(mean(middle)<reference)low=middle;else high=middle;}
 const gain=(low+high)/2;
 return {gain,referenceMean:reference,matchedMean:mean(gain),limited:Math.abs(mean(gain)-reference)>.01,frames:valid.length};
}
