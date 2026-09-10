/** Replayable visual gestures: independent actions, not audio gain envelopes. */
export const GESTURES=['hold','drift','bloom','sweep','orbit','fracture','weave','dissolve'] as const;
export type GestureName=typeof GESTURES[number];
export type GestureCue={
 id:string;
 at:number;
 duration:number;
 scene:number;
 action:GestureName;
 direction:number;
 strength:number;
 color:number;
 provenance:'authored'|'human-demonstration'|'model'|'retrieved';
 reason:string;
};
export type GestureFrame={action:number;progress:number;strength:number;direction:number;motionTime:number};
export const idleGesture=():GestureFrame=>({action:0,progress:0,strength:0,direction:0,motionTime:0});
export class GestureTransport{
 private cue:GestureCue|null=null;
 private motionTime=0;
 private lastTime:number|null=null;
 play(cue:GestureCue){
  if(!Number.isFinite(cue.at)||!Number.isFinite(cue.duration)||cue.duration<=0)throw Error('Cue requires a finite start and positive duration');
  if(!GESTURES.includes(cue.action))throw Error('Unknown visual gesture');
  this.cue={...cue,strength:Math.max(0,Math.min(1,cue.strength))};
 }
 current(){return this.cue?{...this.cue}:null;}
 sample(time:number):GestureFrame{
  const dt=this.lastTime===null?0:Math.max(0,Math.min(.1,time-this.lastTime));this.lastTime=time;
  const cue=this.cue;if(!cue)return idleGesture();
  const progress=Math.max(0,Math.min(1,(time-cue.at)/cue.duration));
  if(cue.action!=='hold'&&time>=cue.at&&progress<1)this.motionTime+=dt;
  return {action:GESTURES.indexOf(cue.action),progress,strength:cue.strength,direction:cue.direction,motionTime:this.motionTime};
 }
}
