import {DanceAudio,HOP,RATE} from './dance-audio.mjs';
import {CausalResampler} from './dance-resample.mjs';
class DanceCapture extends AudioWorkletProcessor {
 constructor(options){
  super();this.engine=new DanceAudio(options.processorOptions.model);
  this.buffer=new Float32Array(HOP);this.used=0;this.resampler=new CausalResampler(sampleRate,RATE);
  this.accept=value=>{
   this.buffer[this.used++]=value;
   if(this.used===HOP){
    const result=this.engine.step(this.buffer);delete result.features;
    result.captureFilterDelaySeconds=this.resampler.delaySeconds;
    this.port.postMessage(result);this.used=0;
   }
  };
 }
 process(inputs){
  const channels=inputs[0];if(!channels?.length)return true;
  for(let i=0;i<channels[0].length;i++){
   let value=0;for(const c of channels)value+=c[i]/channels.length;
   this.resampler.push(value,this.accept);
  }
  return true; // Silent output: microphone is never monitored through speakers.
 }
}
registerProcessor('dance-capture',DanceCapture);
