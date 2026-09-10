// Fixed-reference, causal mel frontend shared by browser and parity tests.
export class MelStream {
 constructor(bank){this.bank=bank;this.samples=new Float32Array(2048);this.history=new Float32Array(128*96).fill(-1);this.written=0;this.untilFrame=0;this.frames=0;this.hann=Float32Array.from({length:2048},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/2048));}
 spectrum(){
  const re=new Float32Array(2048),im=new Float32Array(2048);
  for(let i=0;i<2048;i++){let r=0,n=i;for(let bit=0;bit<11;bit++){r=(r<<1)|(n&1);n>>=1;}re[r]=this.samples[(this.written+i)%2048]*this.hann[i];}
  for(let len=2;len<=2048;len*=2){const half=len/2;for(let base=0;base<2048;base+=len)for(let j=0;j<half;j++){const a=-2*Math.PI*j/len,c=Math.cos(a),s=Math.sin(a),u=base+j,v=u+half,tr=re[v]*c-im[v]*s,ti=re[v]*s+im[v]*c;re[v]=re[u]-tr;im[v]=im[u]-ti;re[u]+=tr;im[u]+=ti;}}
  return Float32Array.from({length:1025},(_,i)=>re[i]*re[i]+im[i]*im[i]);
 }
 push(pcm,onFrame){for(const sample of pcm){this.samples[this.written++%2048]=sample;this.untilFrame++;if(this.untilFrame>=22050/8){this.untilFrame-=22050/8;const power=this.spectrum();for(let m=0;m<128;m++){let energy=0;for(const [i,w]of this.bank[m])energy+=power[i]*w;this.history.copyWithin(m*96,m*96+1,(m+1)*96);this.history[(m+1)*96-1]=(Math.max(-80,10*Math.log10(Math.max(1e-10,energy)))+40)/40;}this.frames++;onFrame(this.history.slice(),this.written/22050);}}}
}
