import {ScopeFeatures} from './scope-core.mjs';
import {MusicFeatures} from './music-features.mjs';
class ScopeCapture extends AudioWorkletProcessor {
  constructor(options){super();this.features=new ScopeFeatures(sampleRate);this.music=options?.processorOptions?.musicFeatures?new MusicFeatures(sampleRate):null;this.n=this.features.window;this.left=new Float32Array(this.n);this.right=new Float32Array(this.n);this.offset=0;this.sequence=0;}
  process(inputs){
    const channels=inputs[0];if(!channels?.length)return true;
    const left=channels[0],right=channels[1]??left;
    for(let i=0;i<left.length;i++){
      this.left[this.offset]=left[i];this.right[this.offset]=right[i];this.offset++;
      if(this.offset===this.n){
        const f=this.features.frame(this.left,this.right);
        this.port.postMessage({type:'frame',sequence:this.sequence++,at:(currentFrame+i+1)/sampleRate,
          sampleRate,channels:channels.length,...f,...(this.music?{music:this.music.frame(this.left,this.right)}:{}),left:this.left,right:this.right},[this.left.buffer,this.right.buffer]);
        this.left=new Float32Array(this.n);this.right=new Float32Array(this.n);this.offset=0;
      }
    }return true;
  }
}
registerProcessor('scope-capture',ScopeCapture);
