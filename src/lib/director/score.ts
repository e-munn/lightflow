export const SCENES = ['ASCII Waves', 'AI Blob', 'Black Hole', 'Pixel Sculpt', 'Aurora', 'Silk', 'Particles', 'Light Tunnel', 'Liquid Metal', 'Prism'] as const;
export type Cue = { scene: number; previous: number; blend: number; brightness: number; motion: number; complexity: number; hue: number; spread: number; accent: number; section: string; reason: string };
export const initialCue = (): Cue => ({scene:1, previous:1, blend:1, brightness:0.25, motion:0.25, complexity:0.4, hue:0.57, spread:0.5, accent:0, section:'Listening', reason:'Waiting for audio'});
// Scene arrangement is explicit art direction, not a falsely claimed learned
// scene classifier. The learned model controls the continuous lighting score.
const profiles = [[.35,.75,.8],[.25,.35,.35],[.65,.7,.45],[.55,.8,.7],[.15,.3,.9],[.3,.5,.85],[.55,.8,.95],[.9,.6,.5],[.4,.65,.8],[.55,.35,.4]];
export class Score {
 cue=initialCue();
 private short=0;private long=0;private lastScene=-20;private previousTime=0;private lastEnergy=0;private used=Array(10).fill(-100);
 update(time:number,level:number,manual:number|null,learned?:number[]):Cue{
  const dt=Math.min(.1,Math.max(0,time-this.previousTime));this.previousTime=time;
  const energy=Math.min(1,level*5);this.short+=(energy-this.short)*(1-Math.exp(-dt/.7));this.long+=(energy-this.long)*(1-Math.exp(-dt/9));
  const rise=this.short-this.long;
  const section=energy<.025?'Silence':rise>.16?'Lift':rise<-.15?'Release':learned&&learned[1]>.65?'Drive':'Flow';
  let next=this.cue.scene;
  if(manual!==null)next=manual;
  else if(learned&&time-this.lastScene>10&&this.cue.blend===1){
   const scores=profiles.map((p,i)=>p.reduce((v,x,j)=>v+(x-learned[[1,2,4][j]])**2,0)+(i===this.cue.scene?-.10:Math.max(0,1-(time-this.used[i])/90)*.12));
   const best=scores.indexOf(Math.min(...scores));
   if(scores[this.cue.scene]-scores[best]>.08&&(section!==this.cue.section||time-this.lastScene>24))next=best;
  }
  if(next!==this.cue.scene){this.cue.previous=this.cue.scene;this.used[this.cue.scene]=time;this.cue.scene=next;this.cue.blend=0;this.lastScene=time;}
  this.cue.blend=Math.min(1,this.cue.blend+dt/2.5);
  const target=learned??[energy*.6,.25,.4,.57,.5];
  const keys=['brightness','motion','complexity','hue','spread'] as const;
  keys.forEach((k,i)=>{const v=k==='brightness'&&energy<.025?0:target[i];let delta=v-this.cue[k];if(k==='hue')delta=((delta+.5)%1+1)%1-.5;this.cue[k]+=delta*(1-Math.exp(-dt/(k==='brightness'?.2:2)));if(k==='hue')this.cue[k]=(this.cue[k]+1)%1;});
  // A restrained transient layer handles arrivals between the slower model hops.
  const attack=Math.min(1,Math.max(0,energy-this.lastEnergy)*4);this.lastEnergy=energy;
  this.cue.accent=Math.max(attack,this.cue.accent*Math.exp(-dt/.12));
  this.cue.section=section;this.cue.reason=learned?'Learned concert lighting + phrase continuity':'Audio-level fallback · waiting for model';
  return {...this.cue};
 }
}
