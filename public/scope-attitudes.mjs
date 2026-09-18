/** Ten causal, hand-designed hypotheses. One scalar per alternative, no model,
 * instrument labels, tempo oscillator, future samples, or concert supervision.
 */
export const ATTITUDES_VERSION='scope-attitudes-v1';
const control=(key,label,value,min,max,step,unit='')=>({key,label,value,min,max,step,unit});
export const ATTITUDES=[
 {id:'circle',name:'Circle',description:'Your preferred boundary. Small movement fades; large excursions open up.',measure:'Radial trace distribution',controls:[control('radius','Radius',.33,.05,.9,.01),control('strength','Strength',3.3,1,4,.1)]},
 {id:'weight',name:'Weight',description:'Low frequencies carry a rounded, heavy glow.',measure:'60–250 Hz energy',controls:[control('drive','Low emphasis',1.6,.2,4,.1),control('release','Decay',280,20,1000,10,'ms')]},
 {id:'snap',name:'Snap',description:'Sharp changes get a quick accent and a clean fall.',measure:'Broadband onset activity',controls:[control('drive','Accent',1.4,.2,4,.1),control('release','Decay',100,20,700,10,'ms')]},
 {id:'air',name:'Air',description:'High-frequency details create light, quick activity.',measure:'4–8 kHz energy + change',controls:[control('drive','Air emphasis',2,.2,5,.1),control('release','Decay',70,20,500,10,'ms')]},
 {id:'sustain',name:'Sustain',description:'Midrange body holds the light through connected sounds.',measure:'250 Hz–2 kHz body + continuity',controls:[control('drive','Body',1.4,.2,4,.1),control('release','Tail',650,100,1800,25,'ms')]},
 {id:'width',name:'Width',description:'The light opens with stereo spread and its changes.',measure:'Stereo covariance + width change',controls:[control('drive','Spread emphasis',1.8,.2,4,.1),control('release','Decay',130,20,700,10,'ms')]},
 {id:'grain',name:'Grain',description:'Rough, busy texture produces a more restless response.',measure:'Waveform traversal + band flatness',controls:[control('drive','Texture',1.5,.2,4,.1),control('release','Softness',60,20,500,10,'ms')]},
 {id:'space',name:'Space',description:'Separate accents leave room for darkness between them.',measure:'Onsets + time since last onset',controls:[control('gap','Minimum space',260,80,900,10,'ms'),control('release','Tail',150,20,600,10,'ms')]},
 {id:'swell',name:'Swell',description:'Rising energy and spectral brightness gradually open the light.',measure:'Short/long energy + spectral rise',controls:[control('window','Context',4,1,12,.5,'s'),control('release','Release',750,100,1600,25,'ms')]},
 {id:'breathe',name:'Breathe',description:'Hits briefly dip the light; the sustained sound brings it back.',measure:'Onset-driven duck + recovery',controls:[control('depth','Dip depth',.85,0,1,.05),control('recovery','Recovery',340,60,1200,10,'ms')]},
];
export const defaultAttitudeSettings=()=>Object.fromEntries(ATTITUDES.map(a=>[a.id,Object.fromEntries(a.controls.map(c=>[c.key,c.value]))]));
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const follow=(previous,target,dt,tau)=>tau<=0?target:previous+(1-Math.exp(-dt/tau))*(target-previous);
export class AttitudeBank {
 constructor(){this.reset();}
 reset(){this.at=null;this.outputs=Array(10).fill(0);this.onsetMean=.05;this.previousSpread=0;this.fastEnergy=0;this.slowEnergy=0;this.slowCentroid=0;this.duck=0;this.snap=0;this.spark=0;this.sparse=0;this.lastHit=-Infinity;this.lastSeenOnset=-Infinity;this.wasAbove=false;this.ready=false;}
 frame(frame,scope,settings=defaultAttitudeSettings()){
  if(!Number.isFinite(frame?.at)||!Number.isFinite(frame?.rms)||!Number.isFinite(scope)||!frame?.values||frame.values.length!==8||frame.values.some(v=>!Number.isFinite(v))||!frame?.music||frame.music.length!==16||frame.music.some(v=>!Number.isFinite(v))){this.reset();return {values:[...this.outputs],metrics:{},valid:false};}
  if(this.at!==null&&(frame.at<=this.at||frame.at-this.at>.25))this.reset();
  const dt=this.at===null?.02:frame.at-this.at;this.at=frame.at;
  // No temporal tail is allowed to illuminate stopped/digital-silent input.
  if(frame.rms<1e-7){this.reset();this.at=frame.at;return {values:[...this.outputs],metrics:{},valid:true};}
  const f=frame.values,m=frame.music,energy=m.slice(0,8).map(v=>Math.max(0,Math.expm1(clamp(v,0,20))/2000)),sum=energy.reduce((a,b)=>a+b,0)+1e-12;
  const low=energy.slice(0,3).reduce((a,b)=>a+b,0)/sum,mid=energy.slice(2,6).reduce((a,b)=>a+b,0)/sum,high=(energy[6]+energy[7])/sum;
  const centroid=energy.reduce((a,v,i)=>a+v*i/7,0)/sum;
  const flatness=clamp(Math.exp(energy.reduce((a,v)=>a+Math.log(v+1e-12),0)/8)/(sum/8));
  const novelty=m.slice(8).reduce((a,b)=>a+Math.max(0,b),0)/8;
  const contrast=clamp((novelty-this.onsetMean*.8)/(this.onsetMean*3+.12));
  const onset=clamp(contrast*.8+Math.max(0,f[6])*.65);
  const hit=onset>.32&&!this.wasAbove;this.wasAbove=onset>.18;
  this.onsetMean=follow(this.onsetMean,novelty,dt,2);
  if(!this.ready){this.fastEnergy=this.slowEnergy=f[0];this.slowCentroid=centroid;this.previousSpread=f[1];this.ready=true;}
  this.fastEnergy=follow(this.fastEnergy,f[0],dt,.18);
  const build=clamp((this.fastEnergy-this.slowEnergy)*4+(centroid-this.slowCentroid)*1.5);
  this.slowEnergy=follow(this.slowEnergy,f[0],dt,settings.swell.window);this.slowCentroid=follow(this.slowCentroid,centroid,dt,settings.swell.window);
  const opening=clamp((f[1]-this.previousSpread)*5);this.previousSpread=f[1];
  const highChange=clamp((m[14]+m[15])*.7);
  this.snap=Math.max(this.snap*Math.exp(-dt/(settings.snap.release/1000)),onset);
  this.spark=Math.max(this.spark*Math.exp(-dt/(settings.air.release/1000)),highChange);
  const sinceSeen=frame.at-this.lastSeenOnset;
  this.sparse*=Math.exp(-dt/(settings.space.release/1000));
  if(hit){if(sinceSeen>=settings.space.gap/1000&&frame.at-this.lastHit>=settings.space.gap/1000){this.sparse=onset;this.lastHit=frame.at;}this.lastSeenOnset=frame.at;}
  this.duck=Math.max(this.duck*Math.exp(-dt/(settings.breathe.recovery/1000)),onset);
  // Each path changes a different measurable aspect of the same scope signal.
  const activity=clamp(f[0]*3);
  const targets=[
   scope,
   scope*clamp(.08+low*settings.weight.drive,0,1.4),
   activity*clamp(this.snap*settings.snap.drive)*( .55+.45*scope),
   activity*clamp((Math.sqrt(high)*.38+this.spark*.8)*settings.air.drive),
   scope*clamp((.2+mid*.8)*settings.sustain.drive)*(1-.45*onset),
   scope*clamp(.1+f[1]*settings.width.drive+opening*.5,0,1.5),
   scope*clamp(.08+(f[2]*.6+flatness*.7)*settings.grain.drive,0,1.5),
   activity*this.sparse*(.6+.4*scope),
   scope*(.12+.88*build),
   scope*(1-clamp(settings.breathe.depth)*this.duck),
  ];
  const ids=ATTITUDES.map(a=>a.id);
  for(let i=0;i<10;i++){
   const up=targets[i]>this.outputs[i],release=settings[ids[i]].release??0;
   const tau=i===0||[2,3,7,9].includes(i)?0:up?(i===4?.12:i===8?.22:.012):release/1000;
   this.outputs[i]=clamp(follow(this.outputs[i],targets[i],dt,tau));
  }
  return {values:[...this.outputs],valid:true,metrics:{low,mid,high,onset,spread:f[1],texture:f[2],flatness,build,centroid}};
 }
}
