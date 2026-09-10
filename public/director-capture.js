class DirectorCapture extends AudioWorkletProcessor {
 constructor(){super();this.buffer=new Float32Array(512);this.offset=0;}
 process(inputs,outputs){const input=inputs[0];if(input?.length){for(let i=0;i<input[0].length;i++){let sample=0;for(let ch=0;ch<input.length;ch++)sample+=input[ch][i]/input.length;this.buffer[this.offset++]=sample;if(this.offset===512){this.port.postMessage({pcm:this.buffer,at:currentTime+(i+1)/sampleRate},[this.buffer.buffer]);this.buffer=new Float32Array(512);this.offset=0;}}}return true;}
}
registerProcessor('director-capture',DirectorCapture);
