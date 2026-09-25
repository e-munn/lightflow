import {ScopeFeatures} from '../../public/scope-core.mjs';
import {MusicFeatures} from '../../public/music-features.mjs';
import {AttitudeBank} from '../../public/scope-attitudes.mjs';
import {SignalContext} from '../../public/jev-context.mjs';

/** Synthetic integration probes, not human musical-preference labels. */
export function fixture(kind,Context=SignalContext) {
  const scope=new ScopeFeatures(),bands=new MusicFeatures(),bank=new AttitudeBank(),context=new Context();
  let seed=78213;
  for(let k=0;k<500;k++){
    const left=new Float32Array(960),right=new Float32Array(960);
    for(let i=0;i<960;i++){
      const t=(k*960+i)/48000;
      seed=(Math.imul(1664525,seed)+1013904223)>>>0;
      const noise=seed/4294967296*2-1;
      const envelope=Math.exp(-(t% .4)/.055);
      const quiet=kind==='arrival'&&t<8;
      const value=kind==='smooth'?.12*Math.sin(2*Math.PI*550*t):
        kind==='texture'?.035*noise:
        kind==='attacks'||kind==='arrival'?(quiet?.008:.35)*envelope*(.65*Math.sin(2*Math.PI*100*t)+.35*noise):
        kind==='rise'?(.015+.015*t)*(Math.sin(2*Math.PI*300*t)*.65+noise*.35):0;
      left[i]=value;right[i]=value*.85;
    }
    const frame={at:k*.02,...scope.frame(left,right),music:bands.frame(left,right)};
    const result=bank.frame(frame,.4);context.push(frame,result.metrics);
  }
  return context.snapshot();
}
