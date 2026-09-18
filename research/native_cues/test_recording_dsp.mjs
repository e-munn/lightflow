import assert from 'node:assert/strict';
import {PROFILES,RecordingDSP} from './recording-dsp.mjs';
const n=15000,l=Float32Array.from({length:n},(_,i)=>.2*Math.sin(i*.137)),r=Float32Array.from({length:n},(_,i)=>.3*Math.cos(i*.097));
for(const profile of PROFILES){
 const full=new RecordingDSP(profile).frame(l,r),dsp=new RecordingDSP(profile),joined=[new Float32Array(n),new Float32Array(n)];
 for(let start=0;start<n;start+=960){const out=dsp.frame(l.slice(start,start+960),r.slice(start,start+960));for(let c=0;c<2;c++)joined[c].set(out[c],start);}
 assert.deepEqual(full,joined);
 const changed=l.slice();changed.fill(1,7000);const future=new RecordingDSP(profile).frame(changed,r);
 for(let c=0;c<2;c++)assert.deepEqual(full[c].slice(0,7000),future[c].slice(0,7000));
 const impulse=new Float32Array(n);impulse[0]=1;const result=new RecordingDSP(profile).frame(impulse,new Float32Array(n));
 assert(result[0][0]>0);assert(result.every(a=>a.every(Number.isFinite)));
 if(profile==='room_short'){assert(Math.abs(result[0][1776]-.15)<1e-7);assert(Math.abs(result[1][2544]-.05)<1e-7);}
 if(profile==='room_long'){assert(Math.abs(result[1][3984]-.2)<1e-7);assert(Math.abs(result[0][6288]-.1)<1e-7);}
 console.log('PASS',profile,'chunk equality, future independence, finite impulse, retained direct arrival');
}
