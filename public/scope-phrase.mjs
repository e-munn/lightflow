/** A marked phrase is a proposed training target, never a live prediction. */
export const PHRASE_VERSION='scope-phrase-target-v1';
export const PHRASE_DEFAULTS={impact:15.66,quiet:.45,decay:80,match:true};
const clamp=x=>Math.max(0,Math.min(1,x));
export function validPhraseSettings(p,duration=32){return !!p&&Number.isFinite(p.impact)&&p.impact>=3&&p.impact<=duration-3&&Number.isFinite(p.quiet)&&p.quiet>=.15&&p.quiet<=1&&Number.isFinite(p.decay)&&p.decay>=30&&p.decay<=350&&typeof p.match==='boolean';}
export function buildPhrase(frames,settings=PHRASE_DEFAULTS){
 if(!frames?.length||!validPhraseSettings(settings,frames.at(-1).time))throw Error('Invalid phrase settings');
 const baseline=[],raw=[],modes=[];let envelope=0;
 for(const f of frames){
  if(!Number.isFinite(f.rms)||!Number.isFinite(f.time)||!Number.isFinite(f.scope?.brightness)||!Number.isFinite(f.metrics?.onset)||!Number.isFinite(f.values?.[0])||!Number.isFinite(f.styleValues?.[6]))throw Error('Invalid phrase frame');
  const silent=f.rms<1e-7;envelope=silent?0:Math.max(envelope*Math.exp(-.02/(settings.decay/1000)),f.metrics.onset);
  const scope=silent?0:clamp(f.scope.brightness),snap=clamp(f.values[0]*3)*clamp(envelope*1.4)*(.55+.45*scope);
  const before=f.time<settings.impact;baseline.push(scope);raw.push(silent?0:clamp(before?f.styleValues[6]*settings.quiet:snap));modes.push(before?'grain':'snap');
 }
 // One fixed scalar over this known excerpt; never a per-frame normalizer.
 const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,target=mean(baseline);
 let gain=1;if(settings.match&&target>0){let lo=0,hi=20;for(let i=0;i<50;i++){const mid=(lo+hi)/2;if(mean(raw.map(v=>clamp(v*mid)))<target)lo=mid;else hi=mid;}gain=(lo+hi)/2;}
 const shaped=raw.map(v=>clamp(v*gain)),candidateMean=mean(shaped),rms=Math.sqrt(mean(shaped.map((v,i)=>(v-baseline[i])**2)));
 return{baseline,shaped,raw,modes,gain,stats:{baselineMean:target,shapedMean:candidateMean,meanDifference:candidateMean-target,matched:settings.match&&Math.abs(candidateMean-target)<.001,saturatedFraction:shaped.filter(v=>v>=.999).length/frames.length,rmsDifference:rms}};
}
/** At time t expose only the last fully elapsed 20ms window. */
export function phraseIndex(time,length,fps=50){return !Number.isFinite(time)||time<0||time>length/fps?-1:Math.min(length-1,Math.floor((time+1e-9)*fps)-1);}
