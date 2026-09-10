'use client';
import { useEffect, useRef } from 'react';
import type {GestureFrame} from '@/lib/director/gestures';
import type { Cue } from '@/lib/director/score';

// Original procedural interpretations of the requested visual families.
// All ten share an explicit continuous control contract and crossfade on GPU.
const fragment = `precision highp float;
uniform vec2 resolution;
uniform float time,scene,previous,blend,brightness,motion,complexity,hue,spread,accent;
uniform float gesture,gestureProgress,gestureStrength,gestureDirection;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 palette(float x){return .52+.48*cos(6.28318*(x+vec3(0.,.33,.67)));}
float field(vec2 p,float s){
 float t=time; float r=length(p); float a=atan(p.y,p.x); float v=0.;
 if(s<.5){vec2 q=floor(p*52.); float wave=sin(q.x*.13+t)+sin(q.y*.2-t*.7); vec2 cell=fract(p*52.)-.5; v=step(abs(cell.x),.26)*step(abs(cell.y),.36)*step(.2,hash(q+floor(wave*3.)))*(.3+.5*wave);}
 else if(s<1.5){float shape=.53+sin(a*3.+t)*.06+sin(a*7.-t*.7)*.04*complexity; v=exp(-abs(r-shape)*18.)+max(0.,shape-r)*(.5+.5*sin(p.x*13.+sin(p.y*9.+t)*2.));}
 else if(s<2.5){float ring=exp(-abs(r-.36)*23.); float spiral=pow(max(0.,sin(a*5.+1./max(.08,r)*3.-t*2.)),12.); v=(ring+spiral*.4)*smoothstep(.22,.34,r)*exp(-r*.8);}
 else if(s<3.5){vec2 q=floor(p*25.);vec2 cell=fract(p*25.);float z=sin(length(q)*.3-t)+cos(q.x*.3+t*.6); v=step(.12,cell.x)*step(.12,cell.y)*(.2+.6*max(0.,z))*exp(-r*.65);}
 else if(s<4.5){float y=p.y+sin(p.x*2.+t*.4)*.3+sin(p.x*5.-t*.2)*.12;v=exp(-abs(y)*5.)*(.5+.5*sin(p.x*9.+t));}
 else if(s<5.5){float y=sin(p.x*3.+p.y*4.+sin(p.x*2.-t)*2.+t*.4);v=pow(.5+.5*y,5.)*.8;}
 else if(s<6.5){vec2 q=p*12.;q.y+=t*.4;vec2 id=floor(q);vec2 local=fract(q)-vec2(hash(id),hash(id+2.));v=exp(-dot(local,local)*140.)*(.3+hash(id))*1.5;}
 else if(s<7.5){float rings=pow(.5+.5*sin(1./max(.12,r)*8.-t*3.),18.);v=rings*(.25+.75*pow(abs(cos(a*4.)),5.))*smoothstep(.1,.3,r);}
 else if(s<8.5){float n=sin(p.x*4.+sin(p.y*5.+t))+cos(p.y*3.-t*.5+sin(p.x*5.));v=pow(.5+.5*sin(n*3.+t*.3),3.);}
 else {float wedge=abs(sin(a*3.+t*.15));v=exp(-abs(r*(.7+wedge)-.5)*25.)+pow(max(0.,1.-abs(p.x+p.y*.6)*2.),20.)*.2;}
 return max(0.,v);
}
void main(){vec2 p=(gl_FragCoord.xy*2.-resolution)/resolution.y;p/= .75+spread*.7;
 float g=gestureProgress;float strength=gestureStrength;float ease=g*g*(3.-2.*g);
 vec2 direction=vec2(cos(gestureDirection),sin(gestureDirection));
 float mask=1.;
 if(gesture>.5&&gesture<1.5)p+=direction*(ease-.5)*strength*.8;
 if(gesture>1.5&&gesture<2.5)p/=1.+sin(g*3.14159)*strength*.7;
 if(gesture>2.5&&gesture<3.5)mask=smoothstep(-.2,.2,g*4.-2.-dot(p,direction));
 if(gesture>3.5&&gesture<4.5){float a=ease*strength*3.14159; p=mat2(cos(a),-sin(a),sin(a),cos(a))*p;}
 if(gesture>4.5&&gesture<5.5){vec2 tile=floor(p*12.);p+=(vec2(hash(tile),hash(tile+2.))-.5)*sin(g*3.14159)*strength*.5;}
 if(gesture>5.5&&gesture<6.5)p+=vec2(sin(p.y*5.+g*6.28),cos(p.x*5.-g*6.28))*strength*.14;
 if(gesture>6.5)mask=smoothstep(g-.08,g+.08,hash(floor(p*65.)));
 float f=mix(field(p,previous),field(p,scene),smoothstep(0.,1.,blend))*mask;
 vec3 col=palette(hue+length(p)*.12+f*.12)*f*(brightness*1.8+accent*.15);
 col=1.-exp(-col);gl_FragColor=vec4(col,1.);
}`;
export default function Visual({cue, blackout=false,gesture}:{cue: Cue;blackout?:boolean;gesture?:GestureFrame}) {
 const canvas=useRef<HTMLCanvasElement>(null); const live=useRef({cue,blackout,gesture});
 useEffect(()=>{live.current={cue,blackout,gesture};},[cue,blackout,gesture]);
 useEffect(()=>{
  const el=canvas.current!;const gl=el.getContext('webgl',{alpha:false,antialias:false});if(!gl)return;
  const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)??'Shader failed');return s;};
  const vs=shader(gl.VERTEX_SHADER,'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}');const fs=shader(gl.FRAGMENT_SHADER,fragment);
  const program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  const names=['time','scene','previous','blend','brightness','motion','complexity','hue','spread','accent','resolution','gesture','gestureProgress','gestureStrength','gestureDirection'];const uniforms=Object.fromEntries(names.map(k=>[k,gl.getUniformLocation(program,k)]));
  let raf=0,clock=0,last=performance.now();
  function draw(now:number){const state=live.current;clock+=Math.min(.05,(now-last)/1000)*(.15+state.cue.motion*1.6);last=now;
   const dpr=Math.min(devicePixelRatio,1.5),w=Math.floor(el.clientWidth*dpr),h=Math.floor(el.clientHeight*dpr);if(el.width!==w||el.height!==h){el.width=w;el.height=h;gl!.viewport(0,0,w,h);}
   gl!.uniform2f(uniforms.resolution,w,h);gl!.uniform1f(uniforms.time,state.gesture?.motionTime??clock);
   gl!.uniform1f(uniforms.gesture,state.gesture?.action??0);gl!.uniform1f(uniforms.gestureProgress,state.gesture?.progress??0);gl!.uniform1f(uniforms.gestureStrength,state.gesture?.strength??0);gl!.uniform1f(uniforms.gestureDirection,state.gesture?.direction??0);
   for(const k of ['scene','previous','blend','brightness','motion','complexity','hue','spread','accent'] as const)gl!.uniform1f(uniforms[k],state.blackout&&(k==='brightness'||k==='accent')?0:state.cue[k]);
   if(state.blackout){gl!.clearColor(0,0,0,1);gl!.clear(gl!.COLOR_BUFFER_BIT);}else gl!.drawArrays(gl!.TRIANGLES,0,6);raf=requestAnimationFrame(draw);
  }raf=requestAnimationFrame(draw);
  return()=>{cancelAnimationFrame(raf);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);};
 },[]);
 return <canvas ref={canvas} aria-label="Live generative visual output" style={{width:'100%',height:'100%',display:'block'}}/>;
}
