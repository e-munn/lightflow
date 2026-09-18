// Causal, deterministic recording perturbations. No look-ahead or normalization.
export const PROFILES=['dark_quiet','thin_loud','room_short','room_long'];
export class RecordingDSP {
 constructor(profile,sampleRate=48000){
  if(!PROFILES.includes(profile))throw Error('Unknown profile');
  this.profile=profile;this.sr=sampleRate;this.low=[0,0];this.pos=0;
  this.ring=[new Float64Array(Math.ceil(.14*sampleRate)+1),new Float64Array(Math.ceil(.14*sampleRate)+1)];
 }
 frame(left,right){
  const out=[new Float32Array(left.length),new Float32Array(right.length)];
  const n=this.ring[0].length;
  const cutoff=this.profile==='dark_quiet'?1800:120;
  const a=1-Math.exp(-2*Math.PI*cutoff/this.sr);
  for(let i=0;i<left.length;i++){
   const x=[left[i],right[i]];
   for(let c=0;c<2;c++)this.ring[c][this.pos]=x[c];
   const past=(c,seconds)=>this.ring[c][(this.pos-Math.round(seconds*this.sr)+n)%n];
   for(let c=0;c<2;c++){
    this.low[c]+=a*(x[c]-this.low[c]);
    let y;
    if(this.profile==='dark_quiet')y=.5*(.25*x[c]+.75*this.low[c]);
    else if(this.profile==='thin_loud')y=2*(x[c]-this.low[c]);
    else if(this.profile==='room_short')y=.8*x[c]+.15*past(c,.037)+.05*past(1-c,.053);
    else y=.7*x[c]+.2*past(1-c,.083)+.1*past(c,.131);
    out[c][i]=y;
   }
   this.pos=(this.pos+1)%n;
  }
  return out;
 }
}
