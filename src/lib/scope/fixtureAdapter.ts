/** Pure research adapter. No transport import, connection or hardware side effect. */
import {RIG,PROFILES,UNIVERSE_SIZE,type FixtureState,type FixtureInstance} from '../fixtures';
export type LightBehavior={version:1;sampleTimeMs:number;intensity:number;hue:number;spread:number;texture:number;balance:number;accent:number};
export type FixturePreview={valid:boolean;reason:string|null;states:Record<string,FixtureState>;universe:Uint8Array};
const clamp=(x:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
export function behaviorFromCue(values:ArrayLike<number>,sampleTimeMs:number):LightBehavior{
 if(values.length<6)throw Error('Six expressive channels are required');
 return {version:1,sampleTimeMs,intensity:values[0],hue:values[1],spread:values[2],texture:values[3],balance:values[4],accent:values[5]};
}
function rgb(h:number):number[]{
 // HSL hue with fixed 55% saturation / 50% lightness; dimmer is separate.
 const c=.55,h6=((h%1)+1)%1*6,x=c*(1-Math.abs(h6%2-1)),m=(1-c)/2;
 const base=h6<1?[c,x,0]:h6<2?[x,c,0]:h6<3?[0,c,x]:h6<4?[0,x,c]:h6<5?[x,0,c]:[c,0,x];return base.map(v=>v+m);
}
export function validatePatch(rig:FixtureInstance[]=RIG):void{
 const ids=new Set<string>(),occupied=new Set<number>();
 for(const f of rig){if(f.active===false)continue;if(ids.has(f.id))throw Error('Duplicate fixture id');ids.add(f.id);
  if(!Number.isInteger(f.addr)||f.addr<1||f.addr+PROFILES[f.kind].channels-1>UNIVERSE_SIZE)throw Error('Fixture exceeds universe');
  if(!Number.isFinite(f.pos.x)||f.pos.x<0||f.pos.x>1)throw Error('Invalid fixture position');
  for(const v of Object.values(f.cal))if(typeof v==='number'&&!Number.isFinite(v))throw Error('Invalid calibration');
  if(f.cal.dimGamma!==undefined&&f.cal.dimGamma<=0)throw Error('Invalid dimmer gamma');
  for(let c=f.addr;c<f.addr+PROFILES[f.kind].channels;c++){if(occupied.has(c))throw Error('Overlapping active fixture channels');occupied.add(c);}
 }
}
export function fixturePreview(signal:LightBehavior|null,nowMs:number,rig:FixtureInstance[]=RIG):FixturePreview{
 validatePatch(rig);
 let reason:string|null=null;
 if(!signal)reason='no signal';
 else if(signal.version!==1||![signal.sampleTimeMs,signal.intensity,signal.hue,signal.spread,signal.texture,signal.balance,signal.accent,nowMs].every(Number.isFinite))reason='invalid signal';
 else if(signal.sampleTimeMs>nowMs+1)reason='future timestamp';
 else if(nowMs-signal.sampleTimeMs>250)reason='stale signal';
 const good=reason===null&&signal!==null;const s=signal;
 const color=rgb(good?s!.hue:0);const states:Record<string,FixtureState>={};const universe=new Uint8Array(UNIVERSE_SIZE);
 let index=0;
 for(const f of rig){if(f.active===false)continue;const profile=PROFILES[f.kind];const st={...profile.defaults};
  const envelope=good?Math.exp(-.5*((f.pos.x-(.5+clamp(s!.balance,-1,1)*.36))/(.1+clamp(s!.spread)*.55))**2):0;
  const detail=good?1-clamp(s!.texture)*.45+(index%2)*clamp(s!.texture)*.45:0;
  st.dim=good?clamp(s!.intensity)*(.18+.82*envelope)*detail:0;
  // Do not invent learned movement, wheel changes, fixture strobe or macros.
  if(f.kind==='spot160')Object.assign(st,{pan:.5,tilt:.5,color:0,gobo:0,ptSpeed:0,shutter:st.dim>0?1:0,strobeHz:0});
  if(f.kind==='shockerPanel'||f.kind==='titanTube')Object.assign(st,{r:color[0],g:color[1],b:color[2],white:0,strobeHz:0});
  states[f.id]=st;const bytes=profile.encode(st,f.cal);
  if(bytes.some(v=>!Number.isFinite(v)||v<0||v>255))throw Error('Invalid fixture bytes');
  universe.set(bytes,f.addr-1);index++;
 }
 return {valid:good,reason,states,universe};
}
