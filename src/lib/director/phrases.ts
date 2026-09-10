export type PhraseLibrary = { prototypes:number[][][]; duration:number; prior:number[] };
/** Select and perform short, learned concert-lighting trajectories.
 * The vocabulary contains actual training-light trajectories, not invented
 * scene labels. Continuity and repeat penalties are rendering policy.
 */
export class PhrasePlayer {
 private started=-Infinity;
 private selected=-1;
 private from:number[]|null=null;
 private last:number[]|null=null;
 private recent:number[]=[];
 constructor(private library:PhraseLibrary){}
 get phrase(){return this.selected;}
 update(time:number,logits:number[]):number[]|undefined{
  if(logits.length!==this.library.prototypes.length||!logits.every(Number.isFinite))return;
  const duration=this.library.duration;
  if(this.selected<0||time-this.started>=duration){
   const peak=Math.max(...logits);
   const ranked=logits.map((logit,i)=>{
    const start=this.library.prototypes[i][0];
    const distance=this.last?start.reduce((sum,v,j)=>sum+(v-this.last![j])**2*(j===0?2:1),0):0;
    const repeat=this.recent.filter(v=>v===i).length*.14;
    return {i,score:logit-peak-distance*.7-repeat};
   }).sort((a,b)=>b.score-a.score);
   this.from=this.last?.slice()??null;this.selected=ranked[0].i;
   this.started=time;this.recent.push(this.selected);if(this.recent.length>6)this.recent.shift();
  }
  const frames=this.library.prototypes[this.selected];
  const elapsed=Math.max(0,time-this.started);
  const position=Math.min(frames.length-1,elapsed/duration*frames.length);
  const left=Math.floor(position),right=Math.min(frames.length-1,left+1),mix=position-left;
  let result=frames[left].map((v,j)=>v+(frames[right][j]-v)*mix);
  if(this.from&&elapsed<.5){const t=elapsed/.5;const a=t*t*(3-2*t);result=result.map((v,j)=>this.from![j]+(v-this.from![j])*a);}
  this.last=result.map(v=>Math.max(0,Math.min(1,v)));
  return this.last.slice();
 }
}
