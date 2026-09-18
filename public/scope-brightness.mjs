/** Fixed raster teacher shared by the live view and the offline training extractor.
 * Input is ONLY the current trailing stereo window. No adaptation or smoothing.
 * Coverage is an experimental scalar projection, not a musical-quality label.
 */
export const SCOPE_BRIGHTNESS_VERSION='scope-coverage-v1';
export const SCOPE_SIZE=256;
export const DEFAULT_EXPOSURE=40;
// Median-matched using only the six training excerpts in brightness_dataset_v3.
export const SOFT_KNEE=0.6432430384611177;
export function coverageBrightness(coverage,exposure=DEFAULT_EXPOSURE,soft=false){
 if(!Number.isFinite(coverage)||coverage<0||!Number.isFinite(exposure)||exposure<=0)return 0;
 const ink=exposure*coverage;
 return soft?ink/(ink+SOFT_KNEE):1-Math.exp(-ink);
}
export class ScopeBrightness {
 constructor(canvas,exposure=DEFAULT_EXPOSURE){
  canvas.width=canvas.height=SCOPE_SIZE;this.canvas=canvas;
  this.context=canvas.getContext('2d',{willReadFrequently:true});
  if(!this.context)throw Error('Scope canvas unavailable');this.exposure=exposure;this.soft=false;
 }
 frame(left,right=left){
  const g=this.context;g.fillStyle='#000';g.fillRect(0,0,SCOPE_SIZE,SCOPE_SIZE);
  if(!left?.length||right.length!==left.length) return {brightness:0,coverage:0,valid:false,clippedFraction:0};
  let clipped=0;
  for(let i=0;i<left.length;i++){
   if(!Number.isFinite(left[i])||!Number.isFinite(right[i]))return {brightness:0,coverage:0,valid:false,clippedFraction:0};
   if(Math.abs(left[i])>128/168.96||Math.abs(right[i])>128/168.96)clipped++;
  }
  g.strokeStyle='#fff';g.lineWidth=1;g.beginPath();
  for(let i=0;i<left.length;i++){
   const x=128+left[i]*168.96,y=128-right[i]*168.96;
   if(i===0)g.moveTo(x,y);else g.lineTo(x,y);
  }g.stroke();
  const pixels=g.getImageData(0,0,SCOPE_SIZE,SCOPE_SIZE).data;let sum=0;
  for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]/255;
  const coverage=sum/(SCOPE_SIZE*SCOPE_SIZE);
  return {brightness:coverageBrightness(coverage,this.exposure,this.soft),coverage,valid:true,clippedFraction:clipped/left.length};
 }
}
