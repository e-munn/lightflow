/** v2: prompt control is asynchronous; all visible gestures use current local audio. */
export const GESTURES=['trace','strike','bloom','carve','grain','space'];
export const FOCUSES=['broad','low','mid','high'];
export const CONTRASTS=['soft','balanced','deep'];
export const DEFAULT_PLAN={gesture:'trace',focus:'broad',contrast:'balanced'};
export const JEV_INTERVAL_MS=500;
export const MAX_RESPONSE_AGE=.9;
export const PLAN_TTL=2.5;
export const TRANSITION_SECONDS=.06;
const clamp=(x,min=0,max=1)=>Math.max(min,Math.min(max,x));
const average=(rows,key)=>rows.reduce((sum,row)=>sum+row[key],0)/rows.length;
export const planKey=plan=>`${plan.gesture}:${plan.focus}:${plan.contrast}`;

export class LiveContext{
  constructor(){this.reset();}
  reset(){this.rows=[];this.above=false;}
  push(frame,metrics){
    if(!Number.isFinite(frame?.at)||!Number.isFinite(frame?.rms)||!frame?.music||frame.music.length!==16||
      frame.music.some(v=>!Number.isFinite(v))||['low','mid','high','onset','texture','flatness','build'].some(k=>!Number.isFinite(metrics?.[k]))){this.reset();return;}
    const last=this.rows.at(-1);if(last&&(frame.at<=last.at||frame.at-last.at>.25))this.reset();
    const hit=metrics.onset>.32&&!this.above;this.above=metrics.onset>.18;
    const novelty=frame.music.slice(8).map(x=>clamp(x/4));
    this.rows.push({at:frame.at,rms:frame.rms,...metrics,hit:Number(hit),lowNovelty:Math.max(...novelty.slice(0,3)),midNovelty:Math.max(...novelty.slice(3,6)),highNovelty:Math.max(...novelty.slice(6))});
    while(this.rows.length&&frame.at-this.rows[0].at>10)this.rows.shift();
  }
  snapshot(recentGestures=[]){
    const last=this.rows.at(-1);if(!last||last.at-this.rows[0].at<.22)return null;
    const summarize=rows=>{
      if(!rows.length)return null;
      const rms=average(rows,'rms'),duration=Math.min(10,rows.at(-1).at-rows[0].at+.02);
      return {duration,rms,variation:clamp(Math.sqrt(average(rows.map(r=>({v:(r.rms-rms)**2})),'v'))/Math.max(rms,1e-7),0,10),
        attacksPerSecond:rows.reduce((s,r)=>s+r.hit,0)/duration,
        ...Object.fromEntries(['low','mid','high','texture','flatness','build','lowNovelty','midNovelty','highNovelty'].map(key=>[key,average(rows,key)]))};
    };
    return {at:last.at,current:summarize(this.rows.filter(r=>last.at-r.at<.24)),
      phrase:summarize(this.rows.filter(r=>last.at-r.at<2)),previous:summarize(this.rows.filter(r=>last.at-r.at>=2)),
      recentGestures:recentGestures.slice(-6)};
  }
}

const change=(a,b)=>!b?'no earlier reference':a>b*1.6?'rising strongly':a<b*.6?'falling strongly':'similar';
export function describeLive(snapshot){
  const c=snapshot.current,p=snapshot.phrase,old=snapshot.previous;
  const rough=r=>r.texture>.45||r.flatness>.4?'rough/broadband':'smooth/narrowband';
  const motion=r=>r.variation<.12?'even and continuous':r.variation<.4?'connected but moving':'strong gaps and peaks';
  const attacks=r=>r.attacksPerSecond<.3?'few':r.attacksPerSecond<2?'occasional':'frequent';
  const novelty=[['low',c.lowNovelty],['mid',c.midNovelty],['high',c.highNovelty]].sort((a,b)=>b[1]-a[1]);
  const shares=[['low',c.low],['mid',c.mid],['high',c.high]].sort((a,b)=>b[1]-a[1]);
  return {
    evidence:'Observed causal signal summaries. Now = trailing 240 ms; phrase = trailing 2 s; earlier = preceding available audio up to 8 s. Bands are not instruments. No future audio.',
    current:{
      level:c.rms<1e-5?'effectively silent':c.rms<.008?'quiet recording':c.rms<.08?'moderate recording':'strong recording',
      immediateMotion:motion(c),immediateTexture:rough(c),immediateAttacks:attacks(c),
      energyChange:change(c.rms,p.rms),prominentBand:shares[0][0],
      changingLayer:novelty[0][1]<.005?'little spectral change':novelty[0][1]<novelty[1][1]*1.3?'several bands changing together':`${novelty[0][0]} frequencies change most`,
      phraseMotion:motion(p),phraseTexture:rough(p),phraseAttacks:attacks(p),
      phraseDirection:change(p.rms,old?.rms),spectralRise:p.build>.3?'clear rise':p.build>.1?'some rise':'little rise',
    },
    recentInferredGestures:snapshot.recentGestures,
    limits:'Recorded level depends on gain. Do not invent instruments, song sections, tempo, or future events. Recent gestures are our earlier decisions, not musical evidence.',
  };
}

/** Warm every response continuously; changing a plan never retriggers an old hit. */
export class GestureEngine{
  constructor(){this.reset();}
  reset(){this.at=null;this.bands=Object.fromEntries(FOCUSES.map(f=>[f,{mean:.05,pulse:0,held:0,space:0,lastSpace:-Infinity,above:false,previousBody:0}]));}
  frame(frame,metrics,circle){
    const output={circle:clamp(circle)};
    if(!Number.isFinite(frame?.at)||!Number.isFinite(frame?.rms)||!Number.isFinite(circle)||!frame?.music||frame.music.length!==16||
      frame.music.some(v=>!Number.isFinite(v))||['low','mid','high','onset','texture','flatness'].some(k=>!Number.isFinite(metrics?.[k]))){this.reset();return this.empty();}
    if(this.at!==null&&(frame.at<=this.at||frame.at-this.at>.25))this.reset();
    const dt=this.at===null?.02:frame.at-this.at;this.at=frame.at;
    if(frame.rms<1e-7){this.reset();return this.empty();}
    const activity=clamp((1-Math.exp(-6*frame.rms))*4),nov=frame.music.slice(8);
    const novelty={broad:Math.max(...nov),low:Math.max(...nov.slice(0,3)),mid:Math.max(...nov.slice(3,6)),high:Math.max(...nov.slice(6))};
    for(const focus of FOCUSES){
      const band=this.bands[focus],share=focus==='broad'?1:metrics[focus];
      const transient=focus==='broad'?metrics.onset:clamp((novelty[focus]-band.mean*.8)/(.15+band.mean*3));
      band.mean+=(1-Math.exp(-dt/1.5))*(novelty[focus]-band.mean);
      const hit=transient>.35&&!band.above;band.above=transient>.18;
      band.pulse=Math.max(band.pulse*Math.exp(-dt/.075),transient);
      band.space*=Math.exp(-dt/.065);
      if(hit&&frame.at-band.lastSpace>=.45){band.space=transient;band.lastSpace=frame.at;}
      const body=circle*(focus==='broad'?1:clamp(.12+Math.sqrt(share)*1.15));
      band.held=Math.max(body,band.held*Math.exp(-dt/.24));
      const grain=clamp(metrics.texture*.25+novelty[focus]*1.8+Math.abs(body-band.previousBody)*8);band.previousBody=body;
      const gestures={trace:body,strike:clamp(.1*body+.9*activity*band.pulse),
        bloom:.35*body+.65*band.held,carve:body*(1-.92*band.pulse),
        grain:body*(.12+.88*grain),space:activity*band.space};
      for(const gesture of GESTURES)for(const contrast of CONTRASTS){
        const exponent=contrast==='soft'?.72:contrast==='deep'?1.8:1;
        output[planKey({gesture,focus,contrast})]=clamp(gestures[gesture])**exponent;
      }
    }
    return output;
  }
  empty(){return Object.fromEntries([['circle',0],...GESTURES.flatMap(gesture=>FOCUSES.flatMap(focus=>CONTRASTS.map(contrast=>[planKey({gesture,focus,contrast}),0]))) ]);}
}

const choices={gesture:GESTURES,focus:FOCUSES,contrast:CONTRASTS};
export class LiveSelector{
  constructor(){this.reset();}
  reset(){this.plan={...DEFAULT_PLAN};this.from={...DEFAULT_PLAN};this.changedAt=-Infinity;this.validAt={gesture:-Infinity,focus:-Infinity,contrast:-Infinity};this.seenAt=-Infinity;}
  get mode(){return this.plan.gesture;}
  update(plan,now){if(planKey(plan)!==planKey(this.plan)){this.from={...this.plan};this.plan=plan;this.changedAt=now;}}
  expire(now){const plan={...this.plan};for(const key of Object.keys(choices))if(now-this.validAt[key]>PLAN_TTL)plan[key]=DEFAULT_PLAN[key];this.update(plan,now);}
  accept(decision,capturedAt,now){
    if(!Number.isFinite(capturedAt)||!Number.isFinite(now)||capturedAt<=this.seenAt||now<capturedAt||now-capturedAt>MAX_RESPONSE_AGE)return 'stale';
    this.seenAt=capturedAt;this.expire(now);const plan={...this.plan};let accepted=0;
    for(const key of Object.keys(choices)){
      const answer=decision?.answers?.[key];
      if(choices[key].includes(answer?.choice)&&Number.isFinite(answer.confidence)&&answer.confidence>=.35&&answer.confidence<=1){
        plan[key]=answer.choice;this.validAt[key]=capturedAt;accepted++;
      }
    }
    this.update(plan,now);return accepted?'accepted':'uncertain';
  }
  frame(values,now){
    if(!Number.isFinite(now)){this.reset();return {mode:'trace',...DEFAULT_PLAN,value:0,fallback:true};}
    this.expire(now);const before=values?.[planKey(this.from)],current=values?.[planKey(this.plan)];
    if(!Number.isFinite(before)||!Number.isFinite(current)){this.reset();return {mode:'trace',...DEFAULT_PLAN,value:0,fallback:true};}
    const blend=clamp((now-this.changedAt)/TRANSITION_SECONDS);
    return {mode:this.plan.gesture,...this.plan,value:clamp(before*(1-blend)+current*blend),fallback:now-this.validAt.gesture>PLAN_TTL};
  }
}
