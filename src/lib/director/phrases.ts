export type PhraseLibrary = { prototypes:number[][][]; duration:number; prior:number[] };
export type PhraseTiming = {blendSeconds?:number;minHoldSeconds?:number;interruptMargin?:number;predictionAt?:number};
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
 private candidate=-1;
 private candidateFrames=0;
 private lastPredictionAt:number|undefined;
 constructor(private library:PhraseLibrary){}
 get phrase(){return this.selected;}
 update(time:number,logits:number[],timing:PhraseTiming={}):number[]|undefined{
  if(!Number.isFinite(time)||logits.length!==this.library.prototypes.length||!logits.every(Number.isFinite))return;
  const duration=this.library.duration;
  const elapsedBeforeSelection=time-this.started;
  const boundary=this.selected<0||elapsedBeforeSelection>=duration;
  const fresh=timing.predictionAt===undefined||timing.predictionAt!==this.lastPredictionAt;
  const minHold=Math.max(0,Math.min(duration,timing.minHoldSeconds??duration));
  const blendSeconds=Math.max(0,Math.min(duration,timing.blendSeconds??.5));
  if(boundary||fresh){
   const peak=Math.max(...logits);
   const ranked=logits.map((logit,i)=>{
    const start=this.library.prototypes[i][0];
    const distance=this.last?start.reduce((sum,v,j)=>sum+(v-this.last![j])**2*(j===0?2:1),0):0;
    const repeat=this.recent.filter(v=>v===i).length*.14;
    return {i,score:logit-peak-distance*.7-repeat};
   }).sort((a,b)=>b.score-a.score);
   const best=ranked[0].i;
   if(fresh){
    this.lastPredictionAt=timing.predictionAt;
    const confident=best!==this.selected&&logits[best]-logits[this.selected]>=(timing.interruptMargin??Infinity);
    if(confident){this.candidateFrames=this.candidate===best?this.candidateFrames+1:1;this.candidate=best;}
    else{this.candidate=-1;this.candidateFrames=0;}
   }
   // Require agreement from two distinct model predictions, not two display frames.
   if(boundary||(fresh&&elapsedBeforeSelection>=minHold&&this.candidate===best&&this.candidateFrames>=2)){
    this.from=this.last?.slice()??null;this.selected=best;
    this.started=time;this.recent.push(this.selected);if(this.recent.length>6)this.recent.shift();
    this.candidate=-1;this.candidateFrames=0;
   }
  }
  const frames=this.library.prototypes[this.selected];
  const elapsed=Math.max(0,time-this.started);
  const position=Math.min(frames.length-1,elapsed/duration*frames.length);
  const left=Math.floor(position),right=Math.min(frames.length-1,left+1),mix=position-left;
  let result=frames[left].map((v,j)=>v+(frames[right][j]-v)*mix);
  if(this.from&&blendSeconds>0&&elapsed<blendSeconds){const t=elapsed/blendSeconds;const a=t*t*(3-2*t);result=result.map((v,j)=>this.from![j]+(v-this.from![j])*a);}
  this.last=result.map(v=>Math.max(0,Math.min(1,v)));
  return this.last.slice();
 }
}
