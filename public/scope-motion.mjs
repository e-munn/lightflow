/** Candidate scalar from waveform traversal, including repeated passes.
 * This is an audio descriptor, not learned lighting intent or a physical beam model.
 * calibrationScale derives exclusively from training recordings; never adapt to a song.
 */
export const TRACE_MOTION_VERSION='scope-traversal-v1';
export const TRACE_MOTION_SCALE=0.036220556514185424;
export function traceMotion(left,right=left,sampleRate=48000,scale=TRACE_MOTION_SCALE){
 if(!left||left.length<2||right.length!==left.length||!Number.isFinite(sampleRate)||sampleRate<=0||!Number.isFinite(scale)||scale<=0)return {brightness:0,movement:0,valid:false};
 let distance=0;
 for(let i=0;i<left.length;i++){
  if(!Number.isFinite(left[i])||!Number.isFinite(right[i]))return {brightness:0,movement:0,valid:false};
  if(i)distance+=Math.hypot(left[i]-left[i-1],right[i]-right[i-1]);
 }
 const movement=distance/(left.length-1)*sampleRate/48000;
 return {brightness:movement/(movement+scale),movement,valid:true};
}
