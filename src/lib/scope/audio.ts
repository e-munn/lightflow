import {FeatureHistory,predict} from '../../../public/scope-core.mjs';
import {CueComparison} from '../../../public/cue-runtime.mjs';
export type ForecastModel = Parameters<typeof predict>[0];
export type ScopeFrame = {at:number;sequence:number;sampleRate:number;channels:number;values:number[];music?:number[];rms:number;peak:number;left:Float32Array;right:Float32Array;received:number;forecast?:number[];cue?:ReturnType<CueComparison['push']>;computeMs:number};
export type Source = {kind:'mic'|'system'} | {kind:'file';file:File} | {kind:'url';url:string;name:string;start?:number};
export class ScopeAudio {
 constructor(private options:{cueComparison?:boolean;forecast?:boolean;musicFeatures?:boolean}={}){}
 context?:AudioContext;model?:ForecastModel;media?:HTMLAudioElement;stream?:MediaStream;
 private cues?:CueComparison;
 private worklet?:AudioWorkletNode;private source?:AudioNode;private mute?:GainNode;
 private stopped=false;private objectUrl?:string;private history=new FeatureHistory();
 private queue:ScopeFrame[]=[];private latest?:ScopeFrame;private isFile=false;
 dropped=0;frames=0;modelError='';
 async start(input:Source,onEnded:()=>void){
  // Invoke display capture during the original click, before awaiting model or worklet.
  const capture=input.kind==='system'?navigator.mediaDevices.getDisplayMedia({video:true,audio:true}):input.kind==='mic'?navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:{ideal:2}}}):null;
  // Attach a rejection handler immediately while setup proceeds.
  const streamResult=capture?.then(stream=>({stream,error:null})).catch(error=>({stream:null,error}));
  try{
   this.context=new AudioContext({sampleRate:48000,latencyHint:'interactive'});
   await this.context.resume();
   if(this.stopped)return;
   const modelLoad=(this.options.forecast===false&&!this.options.cueComparison?Promise.resolve(null):fetch(this.options.cueComparison?'/api/scope-research/cue-model':'/api/scope-research/model').then(r=>{if(!r.ok)throw Error('Forecast model unavailable');return r.json();})).then(model=>{
    if(!model)return;
    if(this.options.cueComparison)this.cues=new CueComparison(model,()=>this.context?.currentTime??0);else this.model=model;
   }).catch(e=>{this.modelError=String(e.message);});
   await this.context.audioWorklet.addModule(this.options.cueComparison?'/cue-capture.js':'/scope-capture.js');
   // The cue runtime needs the entire source prefix; load before capture frames.
   if(this.options.cueComparison)await modelLoad;
   if(streamResult){
    const result=await streamResult;if(result.error)throw result.error;
    this.stream=result.stream!;
    if(this.stopped){this.stream.getTracks().forEach(t=>t.stop());return;}
    if(!this.stream.getAudioTracks().length)throw Error('No audio was shared. Choose a browser tab with Share audio enabled, or use a loopback audio input.');
    this.stream.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(!this.stopped)onEnded();}));
    this.source=this.context.createMediaStreamSource(new MediaStream(this.stream.getAudioTracks()));
   }else{
    if(this.stopped)return;
    this.isFile=true;this.media=new Audio();this.media.preload='auto';
    this.media.src=input.kind==='file'?(this.objectUrl=URL.createObjectURL(input.file)):(input as Extract<Source,{kind:'url'}>).url;
    if(input.kind==='url'&&input.start)this.media.addEventListener('loadedmetadata',()=>{if(this.media)this.media.currentTime=input.start!;},{once:true});
    this.media.addEventListener('ended',onEnded,{once:true});
    this.source=this.context.createMediaElementSource(this.media);this.source.connect(this.context.destination);
   }
   this.worklet=new AudioWorkletNode(this.context,this.options.cueComparison?'cue-capture':'scope-capture',{channelCount:2,channelCountMode:'max',channelInterpretation:'discrete',processorOptions:{musicFeatures:this.options.musicFeatures===true}});
   this.mute=this.context.createGain();this.mute.gain.value=0;
   this.source.connect(this.worklet);this.worklet.connect(this.mute);this.mute.connect(this.context.destination);
   this.worklet.port.onmessage=({data})=>{
    if(this.stopped||data.type!=='frame')return;
    const received=performance.now();this.history.push(data.values);
    const forecast=this.model&&this.history.ready?predict(this.model,this.history.input()):undefined;
    let cue:ScopeFrame['cue'];
    if(this.cues){try{cue=this.cues.push(data.at,data.values,data.music);}catch(e){this.modelError=e instanceof Error?e.message:String(e);this.cues=undefined;}}
    const frame={...data,received,forecast,cue,computeMs:performance.now()-received} as ScopeFrame;
    this.frames++;this.queue.push(frame);
    if(this.queue.length>50){this.queue.shift();this.dropped++;}
   };
   if(this.media)await this.media.play();
   await modelLoad;
  }catch(e){this.stop();throw e;}
  finally{
   // A stopped/rejected setup must also clean up a capture permission resolved later.
   if(this.stopped&&streamResult)void streamResult.then(r=>r.stream?.getTracks().forEach(t=>t.stop()));
  }
 }
 frame(now:number):ScopeFrame|undefined{
  if(!this.context||this.stopped||this.context.state!=='running')return;
  let audible=this.context.currentTime;
  if(this.isFile){const t=this.context.getOutputTimestamp();if(t.performanceTime&&t.contextTime)audible=t.contextTime+(now-t.performanceTime)/1000;}
  while(this.queue.length&&this.queue[0].at<=audible){this.latest=this.queue.shift();}
  // Receipt time alone is insufficient: a delayed worklet message may contain
  // old audio despite having just arrived on the main thread. File frames use
  // the estimated audible clock; external capture uses the input graph clock.
  const frame=this.latest;
  // File analysis can legitimately precede audible playback by the output
  // device's buffer. Count that scheduled lead separately from stale delivery.
  const scheduledLeadMs=this.isFile?Math.max(0,(this.context.currentTime-audible)*1000):0;
  if(!frame||!Number.isFinite(now)||now<frame.received||now-frame.received>250+scheduledLeadMs||audible-frame.at>.25)return;
  return frame;
 }
 timing(frame:ScopeFrame,now:number){
  const context=this.context!;const t=context.getOutputTimestamp();
  // Only file playback passes through this context's output device. Its clock
  // cannot estimate when externally played microphone/system audio was heard.
  const audibleAt=this.isFile&&t.performanceTime&&t.contextTime!==undefined?(t.performanceTime+(frame.at-t.contextTime)*1000):null;
  return {sampleToGraphMs:(context.currentTime-frame.at)*1000,receivedToDrawMs:now-frame.received,
    estimatedAudibleOffsetMs:audibleAt===null?null:now-audibleAt,computeMs:frame.computeMs,
    analysisWindowMs:20,outputLatencyMs:(context.outputLatency??0)*1000,
    physicalInputLatencyMs:null,physicalDisplayLatencyMs:null};
 }
 stop(){
  this.stopped=true;this.stream?.getTracks().forEach(t=>t.stop());
  this.worklet?.disconnect();this.worklet?.port.close();this.source?.disconnect();this.mute?.disconnect();
  if(this.media){this.media.pause();this.media.removeAttribute('src');this.media.load();}
  if(this.objectUrl)URL.revokeObjectURL(this.objectUrl);
  if(this.context&&this.context.state!=='closed')void this.context.close();
  this.queue=[];this.latest=undefined;
 }
}
