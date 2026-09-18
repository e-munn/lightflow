import {spawnSync} from 'node:child_process';
import {ScopeFeatures} from '../../public/scope-core.mjs';
import {MusicFeatures} from '../../public/music-features.mjs';

const [source,start='600']=process.argv.slice(2);
const decoded=spawnSync('ffmpeg',['-v','error','-ss',start,'-i',source,'-t','4','-vn','-ac','2','-ar','48000','-f','f32le','pipe:1'],{maxBuffer:8*1024*1024});
if(decoded.status!==0)throw Error(String(decoded.stderr));
const pcm=decoded.stdout,results={};
for(const gain of [.25,.5,1,2,4]){
 const scope=new ScopeFeatures(48000),music=new MusicFeatures(48000),rows=[];
 for(let offset=0;offset+960*8<=pcm.length;offset+=960*8){
  const left=new Float32Array(960),right=new Float32Array(960);
  for(let i=0;i<960;i++){left[i]=pcm.readFloatLE(offset+i*8)*gain;right[i]=pcm.readFloatLE(offset+i*8+4)*gain;}
  rows.push([Number(start)+(rows.length+1)/50,...scope.frame(left,right).values,...music.frame(left,right)]);
 }
 results[gain]=rows;
}
console.log(JSON.stringify(results));
