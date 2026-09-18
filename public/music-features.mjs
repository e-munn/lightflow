/** Causal stereo band energy and novelty. Frequency bands are not instrument stems. */
export const BAND_CENTERS=[60,120,250,500,1000,2000,4000,8000];
export const MUSIC_FEATURE_NAMES=[...BAND_CENTERS.map(hz=>`log_power_${hz}hz`),...BAND_CENTERS.map(hz=>`novelty_${hz}hz`)];
export class MusicFeatures {
 constructor(sampleRate=48000){
  this.filters=BAND_CENTERS.map(hz=>{
   const w=2*Math.PI*Math.min(hz,sampleRate*.45)/sampleRate,alpha=Math.sin(w)/(2*Math.SQRT1_2),a0=1+alpha;
   return {b0:alpha/a0,b2:-alpha/a0,a1:-2*Math.cos(w)/a0,a2:(1-alpha)/a0,z1:[0,0],z2:[0,0],previous:0};
  });
 }
 frame(left,right=left){
  if(!left.length||left.length!==right.length)throw Error('Invalid stereo band frame');
  const energy=[],novelty=[];
  for(const f of this.filters){
   let sum=0;
   for(let c=0;c<2;c++){
    const samples=c===0?left:right;let z1=f.z1[c],z2=f.z2[c];
    for(let i=0;i<samples.length;i++){
     const x=samples[i],y=f.b0*x+z1;z1=-f.a1*y+z2;z2=f.b2*x-f.a2*y;sum+=y*y;
    }
    f.z1[c]=z1;f.z2[c]=z2;
   }
   const level=Math.log1p(2000*sum/(2*left.length));energy.push(level);novelty.push(Math.min(4,Math.max(0,level-f.previous)));f.previous=level;
  }
  return [...energy,...novelty];
 }
}
