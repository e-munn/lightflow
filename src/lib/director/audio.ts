import type {PhraseLibrary} from './phrases';
export type Prediction={values:number[];ms:number;at:number;level:number;frames:number;logits?:number[]};
export class DirectorAudio {
 library?:PhraseLibrary;
 context?:AudioContext; private stream?:MediaStream; private worker?:Worker; private worklet?:AudioWorkletNode; private media?:HTMLAudioElement; private analyser?:AnalyserNode; private data=new Float32Array(2048); private stopped=false;
 async start(onPrediction:(p:Prediction)=>void,onState:(s:string)=>void,file?:File){
  this.context=new AudioContext({sampleRate:22050,latencyHint:'interactive'});await this.context.resume();
  if(this.context.sampleRate!==22050)throw Error('This browser cannot provide the model’s required 22.05 kHz audio.');
  this.worker=new Worker(new URL('./inference.worker.ts',import.meta.url));
  this.worker.onmessage=({data})=>{if(this.stopped)return;if(data.type==='ready'){this.library=data.library;onState('Learned phrase director · local');}if(data.type==='prediction')onPrediction(data);if(data.type==='error')onState(`Model unavailable: ${data.message}`);};this.worker.postMessage({type:'init'});
  await this.context.audioWorklet.addModule('/director-capture.js');
  if(this.stopped)return;
  let source:AudioNode;
  if(file){this.media=new Audio(URL.createObjectURL(file));source=this.context.createMediaElementSource(this.media);source.connect(this.context.destination);}
  else{this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});if(this.stopped){this.stream.getTracks().forEach(t=>t.stop());return;}source=this.context.createMediaStreamSource(this.stream);}
  this.analyser=this.context.createAnalyser();this.analyser.fftSize=2048;source.connect(this.analyser);
  this.worklet=new AudioWorkletNode(this.context,'director-capture');source.connect(this.worklet);
  const mute=this.context.createGain();mute.gain.value=0;this.worklet.connect(mute);mute.connect(this.context.destination);
  this.worklet.port.onmessage=({data})=>this.worker?.postMessage({type:'pcm',...data},[data.pcm.buffer]);
  if(this.media)await this.media.play();
 }
 setLevelWindow(samples:number){if(this.analyser&&this.analyser.fftSize!==samples){this.analyser.fftSize=samples;this.data=new Float32Array(samples);}}
 get level(){if(!this.analyser)return 0;this.analyser.getFloatTimeDomainData(this.data);let sum=0;for(const x of this.data)sum+=x*x;return Math.sqrt(sum/this.data.length);}
 get time(){return this.context?.currentTime??0;}
 stop(){this.stopped=true;this.stream?.getTracks().forEach(t=>t.stop());this.worker?.terminate();this.worklet?.disconnect();if(this.media){this.media.pause();URL.revokeObjectURL(this.media.src);}void this.context?.close();}
}
