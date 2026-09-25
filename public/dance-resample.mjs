/** Causal antialias filter before conversion to the model's 16 kHz rate. */
export class CausalResampler {
 constructor(inputRate,outputRate=16000){
  if(!(inputRate>0&&outputRate>0))throw Error('Invalid sample rate');
  this.ratio=inputRate/outputRate;this.position=0;this.next=0;this.previous=0;
  const size=inputRate>outputRate?63:1,cutoff=.45*outputRate/inputRate;
  this.kernel=Float64Array.from({length:size},(_,i)=>{
   if(size===1)return 1;
   const x=i-(size-1)/2;
   return (x===0?2*cutoff:Math.sin(2*Math.PI*cutoff*x)/(Math.PI*x))*(.5-.5*Math.cos(2*Math.PI*i/(size-1)));
  });
  const sum=this.kernel.reduce((a,b)=>a+b,0);this.kernel=this.kernel.map(v=>v/sum);
  this.ring=new Float64Array(size);this.head=0;this.delaySeconds=(size-1)/2/inputRate;
 }
 push(value,emit){
  this.ring[this.head]=value;let filtered=0;
  for(let j=0;j<this.kernel.length;j++)filtered+=this.kernel[j]*this.ring[(this.head-j+this.ring.length)%this.ring.length];
  this.head=(this.head+1)%this.ring.length;
  while(this.next<=this.position){
   const fraction=Math.max(0,Math.min(1,this.next-(this.position-1)));
   emit(this.previous+(filtered-this.previous)*fraction);this.next+=this.ratio;
  }
  this.previous=filtered;this.position++;
 }
}
