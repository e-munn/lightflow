/** Causal prototypes for routing existing brightness modes. No trained model. */
import {ATTITUDES} from './scope-attitudes.mjs';
export const INTERPLAY_VERSION='scope-interplay-v1';
const knob=(key,label,value,min,max,step,unit='')=>({key,label,value,min,max,step,unit});
export const RECIPES=[
 {id:'arrival',name:'Your interplay',description:'Space / Grain in restrained passages; Snap on a detected arrival.',measure:'Onset + body arrival + recent context',controls:[knob('sensitivity','Arrival sensitivity',1,.5,2,.1),knob('restraint','Quiet level',.55,.15,1,.05)]},
 {id:'bite',name:'Body & bite',description:'Weight carries the body; Snap briefly takes sharp attacks.',measure:'Low body ↔ broadband attack',controls:[knob('sensitivity','Attack sensitivity',1,.5,2,.1),knob('returnMs','Return',180,60,600,10,'ms')]},
 {id:'opens',name:'Texture opens',description:'Grain gives way to Air as high-frequency activity emerges.',measure:'Absolute high energy + spectral rise',controls:[knob('sensitivity','Air sensitivity',1,.5,2,.1),knob('fadeMs','Transition',300,80,1000,20,'ms')]},
 {id:'flow',name:'Punctuation → flow',description:'Space for separate events; Sustain when the sound connects.',measure:'Midrange continuity + gaps',controls:[knob('continuity','Continuity',.55,.2,.95,.05),knob('fadeMs','Transition',280,80,1000,20,'ms')]},
 {id:'lift',name:'Lift → impact → body',description:'Swell builds, Snap lands, Weight carries the body afterward.',measure:'Build trend → arrival → low body',controls:[knob('sensitivity','Arrival sensitivity',1,.5,2,.1),knob('settle','Settle',.8,.3,2,.1,'s')]},
 {id:'rebound',name:'Hit ↔ rebound',description:'Snap for irregular hits; Breathe when a repeated pulse settles.',measure:'Observed onset-interval regularity',controls:[knob('regularity','Pulse certainty',.55,.2,.9,.05),knob('fadeMs','Transition',260,80,1000,20,'ms')]},
 {id:'opening',name:'Focus ↔ opening',description:'Circle stays direct; Width takes over when stereo space opens.',measure:'Stereo spread relative to recent geometry',controls:[knob('widening','Widening',.12,.03,.5,.01),knob('fadeMs','Transition',300,80,1000,20,'ms')]},
 {id:'reply',name:'Strike & reply',description:'Snap strikes; a separate high-frequency reply gets Air, then Space.',measure:'Onset → separate high-band event → gaps',controls:[knob('sensitivity','Reply sensitivity',1,.5,2,.1),knob('interval','Reply window',.65,.2,1.2,.05,'s')]},
 {id:'abrasive',name:'Smooth ↔ abrasive',description:'Sustain becomes Grain when a continuing sound grows rougher.',measure:'Traversal + broad-band texture',controls:[knob('texture','Texture threshold',.4,.15,.8,.05),knob('settling','Settling',.5,.15,1.5,.05,'s')]},
 {id:'reveal',name:'Low-end reveal',description:'Space gives way to Weight when sustained low body arrives.',measure:'Absolute low energy + persistence',controls:[knob('sensitivity','Body sensitivity',1,.5,2,.1),knob('hold','Persistence',.45,.15,1.5,.05,'s')]},
 {id:'afterglow',name:'Attack → body → rest',description:'Snap starts the gesture, Sustain follows its body, Space leaves room.',measure:'Onset → audible mid body → gaps',controls:[knob('continuity','Body threshold',.5,.2,.9,.05),knob('fadeMs','Release',260,80,1000,20,'ms')]},
];
export const defaultInterplaySettings=()=>Object.fromEntries(RECIPES.map(r=>[r.id,Object.fromEntries(r.controls.map(c=>[c.key,c.value]))]));
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x)),ema=(old,value,dt,tau)=>old+(1-Math.exp(-dt/tau))*(value-old);
const idx=Object.fromEntries(ATTITUDES.map((s,i)=>[s.id,i]));
const quantile=(values,q)=>{const a=values.slice().sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.floor(q*a.length))]??0;};

export class RoutingContext {
 constructor(){this.reset();}
 reset(){this.at=null;this.start=null;this.history=[];this.hits=[];this.above=false;this.airAbove=false;this.reference=null;this.nextReference=0;this.continuity=0;this.lowBody=0;this.midBody=0;this.armedUntil=-Infinity;this.lastSound=-Infinity;this.shortRms=0;}
 frame(frame,metrics){
  const at=frame.at,dt=this.at===null?.02:at-this.at;
  if(this.at!==null&&(dt<=0||dt>.25))this.reset();
  const step=this.at===null?.02:at-this.at;this.at=at;this.start??=at;
  const power=frame.music.slice(0,8).map(x=>Math.expm1(clamp(x,0,20))/2000),low=power.slice(0,3).reduce((a,b)=>a+b,0),high=power[6]+power[7];
  const rms=frame.rms,m={onset:0,centroid:0,spread:0,texture:0,flatness:0,mid:0,low:0,build:0,...metrics};
  while(this.history.length&&at-this.history[0].at>8)this.history.shift();
  if(at>=this.nextReference&&this.history.length){
   this.reference={rms:quantile(this.history.map(x=>x.rms),.6),low:quantile(this.history.map(x=>x.low),.6),high:quantile(this.history.map(x=>x.high),.6),centroid:quantile(this.history.map(x=>x.centroid),.5),spread:quantile(this.history.map(x=>x.spread),.5)};this.nextReference=at+.2;
  }
  const ref=this.reference??{rms,low,high,centroid:m.centroid,spread:m.spread};
  const levelDb=20*Math.log10((rms+1e-6)/(ref.rms+1e-6)),lowDb=10*Math.log10((low+1e-9)/(ref.low+1e-9)),highDb=10*Math.log10((high+1e-9)/(ref.high+1e-9));
  const active=rms>Math.max(1e-5,ref.rms*.18),silent=rms<1e-7;
  if(!silent)this.lastSound=at;
  const hit=!silent&&m.onset>.32&&!this.above&&(this.hits.length===0||at-this.hits.at(-1)>.08);this.above=m.onset>.18;
  if(hit)this.hits.push(at);while(this.hits.length&&at-this.hits[0]>4)this.hits.shift();
  const highNovelty=frame.music[14]+frame.music[15],airEvent=!silent&&highNovelty>.25&&!this.airAbove;this.airAbove=highNovelty>.12;
  const intervals=this.hits.slice(1).map((t,i)=>t-this.hits[i]).filter(x=>x>=.12&&x<=1.5).slice(-5);
  let regularity=0;if(intervals.length>=3){const mean=intervals.reduce((a,b)=>a+b,0)/intervals.length,sd=Math.sqrt(intervals.reduce((a,b)=>a+(b-mean)**2,0)/intervals.length);if(at-this.hits.at(-1)<Math.min(1.5,mean*1.8))regularity=clamp(1-sd/mean*4)*Math.min(1,intervals.length/4);}
  this.continuity=ema(this.continuity,active?1:0,step,active?.35:.12);
  this.midBody=ema(this.midBody,active&&m.mid>.25?1:0,step,.3);
  this.lowBody=ema(this.lowBody,active&&m.low>.35&&low>Math.max(1e-8,ref.low*.65)?1:0,step,.3);
  this.shortRms=ema(this.shortRms,rms,step,.16);
  const armed=at<this.armedUntil;
  if(!silent&&m.build>.24)this.armedUntil=at+2;
  if(at-this.lastSound>2)this.armedUntil=-Infinity;
  const cue={at,dt:step,age:at-this.start,silent,hit,onset:m.onset,airEvent,highNovelty,levelDb,lowDb,highDb,low:m.low,lowBody:this.lowBody,midBody:this.midBody,continuity:this.continuity,density:this.hits.filter(t=>at-t<1).length,regularity,spread:m.spread,widening:m.spread-ref.spread,rough:clamp(m.texture*.55+m.flatness*.6),centroidRise:m.centroid-ref.centroid,build:m.build,armed,bodySupport:lowDb>2&&m.low>.25&&this.shortRms>ref.rms*.8,energySupport:20*Math.log10((this.shortRms+1e-6)/(ref.rms+1e-6))>5};
  this.history.push({at,rms,low,high,centroid:m.centroid,spread:m.spread});return cue;
 }
}

const initial=['grain','weight','grain','space','swell','snap','circle','space','sustain','space','space'];
export class RecipeRouter {
 constructor(index){this.index=index;this.reset();}
 reset(){this.mode=initial[this.index];this.fromMode=this.mode;this.fromGain=1;this.gain=1;this.fadeAt=-Infinity;this.fadeSeconds=0;this.snapshot=null;this.output=0;this.since=-Infinity;this.pending='';this.pendingAt=0;this.impactAt=-Infinity;this.support=0;this.confirmed=false;this.rejections=0;this.supportedAt=-Infinity;this.strikeAt=-Infinity;this.replyAt=-Infinity;this.reason='Waiting for context';this.transitions=0;}
 mix(values,at){const alpha=this.fadeSeconds===0?1:clamp((at-this.fadeAt)/this.fadeSeconds);const old=this.snapshot===null?values[idx[this.fromMode]]*this.fromGain:this.snapshot;return {value:clamp((1-alpha)*old+alpha*values[idx[this.mode]]*this.gain),alpha};}
 switch(mode,gain,cue,values,fade,reason){
  const previous=this.mix(values,cue.at);this.snapshot=previous.alpha<1?previous.value:null;this.fromMode=this.mode;this.fromGain=this.gain;this.mode=mode;this.gain=gain;this.fadeAt=cue.at;this.fadeSeconds=fade;this.since=cue.at;this.reason=reason;this.pending='';this.transitions++;
 }
 frame(c,values,p){
  let mode=this.mode,gain=this.gain,reason=this.reason,wait=.28,fade=.25,force=false,dwell=.6;
  const quiet=c.continuity>.55&&(c.rough>.16||c.density>1)?'grain':'space';
  const impact=c.age>.6&&c.hit&&c.onset>.42/(p.sensitivity??1)&&((c.lowDb>4&&c.low>.2)||(c.levelDb>(c.armed?2:3.5)&&c.centroidRise<.2));
  if([0,4].includes(this.index)){
   if(impact&&c.at-this.impactAt>.65){this.impactAt=c.at;this.support=0;this.confirmed=false;mode='snap';gain=1;reason='Attack + context arrival';force=true;fade=0;this.supportedAt=c.at;}
   const age=c.at-this.impactAt;
   if(age>=0&&age<=.32&&!c.silent&&(c.bodySupport||(c.energySupport&&c.density<6&&c.centroidRise<.1)))this.support+=c.dt;
   if(age>.32&&this.impactAt!==-Infinity&&!this.confirmed){if(this.support>=.12)this.confirmed=true;else{this.impactAt=-Infinity;this.rejections++;force=true;fade=.18;}}
   if(this.confirmed&&!c.silent&&(c.bodySupport||(c.density>=2&&c.lowBody>.5)))this.supportedAt=c.at;
   const locked=this.impactAt!==-Infinity&&(age<.32||(this.confirmed&&(age<1||c.at-this.supportedAt<.75)));
   if(!locked&&this.impactAt!==-Infinity){this.impactAt=-Infinity;this.confirmed=false;this.support=0;}
   if(locked){mode=this.index===4&&this.confirmed&&age>p.settle&&c.lowBody>.65&&!c.hit?'weight':'snap';gain=mode==='snap'?1:.9;reason=mode==='snap'?(this.confirmed?'Arrival confirmed':'Checking arrival'):'Arrival settled into low body';}
   else{mode=this.index===0?quiet:(c.build>.12?'swell':c.lowBody>.65?'weight':'swell');gain=this.index===0?p.restraint:.65;reason=this.index===0?(mode==='grain'?'Continuous texture':'Separated accents / gaps'):(mode==='weight'?'Continuing low body':'Developing contour');}
  }else if(this.index===1){
   if(c.hit&&c.onset>.35/p.sensitivity)this.strikeAt=c.at;
   mode=c.at-this.strikeAt<p.returnMs/1000?'snap':'weight';gain=mode==='snap'?1:.8;reason=mode==='snap'?'Sharp attack':'Low-body response';wait=0;dwell=0;fade=mode==='snap'?0:.09;force=mode==='snap';
  }else if(this.index===2){mode=c.highDb>(this.mode==='air'?.5:2)/p.sensitivity&&c.centroidRise>(this.mode==='air'?.01:.04)/p.sensitivity?'air':'grain';gain=.75;reason=mode==='air'?'High energy + spectral opening':'Broad texture';fade=p.fadeMs/1000;}
  else if(this.index===3){mode=c.midBody>(this.mode==='sustain'?p.continuity*.65:p.continuity)?'sustain':'space';gain=mode==='sustain'?.8:.6;reason=mode==='sustain'?'Connected midrange body':'Gaps between events';fade=p.fadeMs/1000;}
  else if(this.index===5){mode=c.regularity>(this.mode==='breathe'?p.regularity*.7:p.regularity)?'breathe':'snap';gain=.9;reason=mode==='breathe'?'Repeated observed pulse':'Irregular / isolated attacks';fade=p.fadeMs/1000;}
  else if(this.index===6){mode=c.spread>.1&&c.widening>(this.mode==='width'?p.widening*.35:p.widening)?'width':'circle';gain=.9;reason=mode==='width'?'Stereo field opening':'Focused scope';fade=p.fadeMs/1000;}
  else if(this.index===7){
   const elapsed=c.at-this.strikeAt;
   if(c.airEvent&&c.highNovelty>.25/p.sensitivity&&elapsed>.10&&elapsed<p.interval){this.replyAt=c.at;}
   else if(c.hit&&c.onset>.4&&elapsed>.18){this.strikeAt=c.at;this.replyAt=-Infinity;}
   mode=c.at-this.strikeAt<.10?'snap':c.at-this.replyAt<.22?'air':'space';gain=mode==='snap'?1:mode==='air'?.8:.55;reason=mode==='snap'?'Initial strike':mode==='air'?'Separate high-band reply':'Waiting for another event';wait=0;dwell=0;fade=mode==='space'?.1:0;force=mode!=='space';
  }else if(this.index===8){mode=c.rough>(this.mode==='grain'?p.texture*.75:p.texture)?'grain':'sustain';gain=.75;reason=mode==='grain'?'Texture becoming rougher':'Steady body';wait=p.settling;fade=.25;}
  else if(this.index===9){mode=c.lowBody>(this.mode==='weight'?.4:.65)/p.sensitivity&&c.lowDb>(this.mode==='weight'?-3:1)/p.sensitivity?'weight':'space';gain=mode==='weight'?.9:.55;reason=mode==='weight'?'Sustained low body':'Thin / separated passage';wait=p.hold;fade=.25;}
  else if(this.index===10){if(c.hit&&c.onset>.38)this.strikeAt=c.at;mode=c.at-this.strikeAt<.12?'snap':c.midBody>p.continuity&&c.continuity>.5?'sustain':'space';gain=mode==='snap'?1:mode==='sustain'?.75:.55;reason=mode==='snap'?'Gesture attack':mode==='sustain'?'Audible continuation':'Body has fallen away';wait=0;dwell=0;fade=mode==='snap'?0:p.fadeMs/1000;force=mode==='snap';}
  // Sustained silence releases an impact state; output blackouts below override all fades.
  if(c.silent){if(this.pending==='')this.pendingAt=c.at;this.pending='';}
  if(mode!==this.mode){
   if(this.pending!==mode){this.pending=mode;this.pendingAt=c.at;}
   if(force||(c.at-this.pendingAt>=wait&&c.at-this.since>=dwell))this.switch(mode,gain,c,values,fade,reason);
  }else{this.pending='';this.reason=reason;this.gain=gain;}
  const mixed=this.mix(values,c.at);this.output=c.silent?0:mixed.value;
  if(c.silent){this.snapshot=0;this.fadeSeconds=0;}
  return {mode:this.mode,brightness:this.output,reason:this.reason,pending:this.pending,transition:mixed.alpha,gain:this.gain,confirmed:this.confirmed,provisional:!this.confirmed&&this.impactAt!==-Infinity,rejectedEntries:this.rejections,transitions:this.transitions};
 }
}

export class InterplayBank {
 constructor(){this.context=new RoutingContext();this.routers=RECIPES.map((_,i)=>new RecipeRouter(i));this.at=null;}
 reset(){this.context.reset();this.routers.forEach(r=>r.reset());this.at=null;}
 frame(frame,styleResult,settings=defaultInterplaySettings()){
  const settingsValid=RECIPES.every(r=>r.controls.every(c=>Number.isFinite(settings?.[r.id]?.[c.key])&&settings[r.id][c.key]>=c.min-1e-8&&settings[r.id][c.key]<=c.max+1e-8));
  if(!settingsValid||!Number.isFinite(frame?.at)||!Number.isFinite(frame?.rms)||!frame?.music||frame.music.length!==16||frame.music.some(x=>!Number.isFinite(x))||!styleResult?.valid||styleResult.values?.length!==10||styleResult.values.some(x=>!Number.isFinite(x))){this.reset();return {valid:false,values:RECIPES.map(()=>0),routes:[],cues:null};}
  if(this.at!==null&&(frame.at<=this.at||frame.at-this.at>.25))this.reset();this.at=frame.at;
  const cues=this.context.frame(frame,styleResult.metrics),routes=this.routers.map((r,i)=>r.frame(cues,styleResult.values,settings[RECIPES[i].id]));
  return {valid:true,values:routes.map(r=>r.brightness),routes,cues};
 }
}
