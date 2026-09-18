uniform vec4 uSettings; // gain, line width in pixels, grid, mode
out vec4 fragColor;
const float PI = 3.14159265359;
const vec3 MINT=vec3(.28,1.,.77), BLUE=vec3(.24,.61,1.), PINK=vec3(1.,.35,.6), GOLD=vec3(1.,.77,.30);
vec4 dataAt(float x,int row){ return texture(sTD2DInputs[0],vec2(clamp(x,0.001,0.999),(float(row)+.5)/133.)); }
float seg(vec2 p,vec2 a,vec2 b){vec2 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/max(dot(v,v),1e-9),0.,1.));}
float ink(float d){float w=uSettings.y/540.;return exp(-pow(d/max(w,.0004),2.))+0.16*exp(-d/max(w*5.,.002));}
float curve(vec2 uv,int row,int channel,float base,float scale){
 float dx=1./512.; float a=floor(uv.x*511.)/511.;
 vec2 p=vec2(uv.x,uv.y),p0=vec2(a,base+dataAt(a,row)[channel]*scale),p1=vec2(a+dx,base+dataAt(a+dx,row)[channel]*scale);
 return ink(seg(p,p0,p1));
}
vec3 heat(float v){return mix(vec3(.013,.019,.034),mix(BLUE,mix(MINT,GOLD,smoothstep(.55,1.,v)),smoothstep(.15,.8,v)),smoothstep(.03,.7,v));}
void main(){
 vec2 uv=vUV.st; vec2 q=uv*2.-1.; float aspect=uTDOutputInfo.res.z/uTDOutputInfo.res.w;
 vec3 col=vec3(.014,.022,.031);
 vec2 g=abs(fract(uv*vec2(12.,8.)+.5)-.5); float grid=1.-smoothstep(.005,.019,min(g.x,g.y));
 col+=vec3(.032,.045,.051)*grid*uSettings.z;
 float gain=uSettings.x; int mode=int(uSettings.w+.5);
 if(mode==0){
   col+=MINT*curve(uv,0,2,.5,.38*gain);
 }else if(mode==1 || mode==2){
   vec2 p=q*vec2(aspect,1.);float d=100.;
   vec2 prev=mode==1?dataAt(0.,0).rg:vec2(dataAt(0.,0).a,dataAt(0.,0).b);
   prev*=gain*.78;
   for(int i=1;i<256;i++){
     vec4 s=dataAt(float(i)/255.,0);vec2 cur=(mode==1?s.rg:vec2(s.a,s.b))*gain*.78;
     d=min(d,seg(p,prev,cur));prev=cur;
   }
   col+=(mode==1?MINT:PINK)*ink(d*.5);
   col+=vec3(.035)*exp(-min(abs(p.x),abs(p.y))*650.)*uSettings.z;
 }else if(mode==3){
   float y=.1+dataAt(uv.x,1).r*.78;
   col+=mix(BLUE,MINT,uv.x)*curve(uv,1,0,.1,.78);
   if(uv.y<y && uv.y>.1)col+=mix(BLUE,MINT,uv.x)*.08;
 }else if(mode==4){
   vec2 p=q*vec2(aspect,1.);float ang=atan(p.y,p.x); float t=(ang+PI)/(2.*PI);
   float value=dataAt(t,1).r; float radius=.28+value*.5;
   col+=mix(BLUE,MINT,t)*ink(abs(length(p)-radius)*.5);
   col+=BLUE*.2*ink(abs(length(p)-.28)*.5);
 }else if(mode==5){
   col+=MINT*curve(uv,2,0,.78,.20*gain);
   col+=BLUE*curve(uv,2,1,.50,.20*gain);
   col+=PINK*curve(uv,2,2,.22,.20*gain);
 }else if(mode==6){
   col+=MINT*curve(uv,3,0,.12,.75*gain);
   col+=BLUE*curve(uv,3,1,.12,.75*gain);
   col+=PINK*curve(uv,3,2,.12,.75*gain);
   col+=vec3(.7)*curve(uv,3,3,.12,.75*gain)*.4;
 }else if(mode==7){
   float bin=clamp(uv.y,0.,.999)*127.;
   float v=texture(sTD2DInputs[0],vec2(uv.x,(5.5+bin)/133.)).r;
   col=heat(v);
 }else if(mode==8){
   col+=GOLD*curve(uv,4,0,.10,.78);
   col+=MINT*curve(uv,3,3,.10,.6*gain)*.6;
 }else if(mode==9){
   col+=MINT*curve(uv,4,1,.50,.35);
   col+=PINK*curve(uv,4,2,.10,.8);
   col+=vec3(.07)*ink(abs(uv.y-.5));
 }
 fragColor=TDOutputSwizzle(vec4(clamp(col,0.,1.),1.));
}
