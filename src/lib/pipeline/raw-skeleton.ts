import type { PoseFrame } from './types';

export const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[27,31],[28,30],[30,32],[28,32],[15,17],[15,19],[16,18],[16,20],[0,7],[0,8]];

/** The frame just presented by the video owns the pose. Never interpolate gaps. */
export function observedFrame(frames: PoseFrame[], mediaTime: number | null) {
  if (mediaTime === null) return null;
  let low=0, high=frames.length-1, found=-1;
  while (low<=high) { const mid=(low+high)>>1; if (frames[mid].t<=mediaTime+.001) { found=mid;low=mid+1; } else high=mid-1; }
  return found>=0 && mediaTime-frames[found].t<.15 ? frames[found] : null;
}

export function containedMedia(width: number,height: number,aspect: number) {
  const w=Math.min(width,height*aspect),h=w/aspect;
  return {width:w,height:h,x:(width-w)/2,y:(height-h)/2};
}

export function paintSkeleton(canvas: HTMLCanvasElement,frame: PoseFrame | null,aspect: number,reference: PoseFrame | null = null) {
  const context=canvas.getContext('2d');if (!context) return;
  const width=canvas.clientWidth,height=canvas.clientHeight,dpr=Math.min(window.devicePixelRatio||1,2);
  if (canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)) { canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr); }
  context.setTransform(dpr,0,0,dpr,0,0);context.clearRect(0,0,width,height);
  canvas.dataset.frame=frame?.index.toString()??'';
  canvas.dataset.poseTime=frame?.t.toString()??'';
  const pose=frame?.primary !== null && frame?.primary !== undefined ? frame.poses[frame.primary] : null;
  canvas.dataset.tracked=String(!!pose);canvas.dataset.joints='0';
  if (!pose) return;
  const box=containedMedia(width,height,aspect);
  const raw=reference?.primary !== null && reference?.primary !== undefined ? reference.poses[reference.primary] : null;
  if(raw){
    context.lineWidth=1;context.strokeStyle='#a4acba66';context.beginPath();
    for(const [a,b] of BONES){const p=raw[a],q=raw[b];if(!p||!q||p[3]<.5||q[3]<.5||![...p.slice(0,2),...q.slice(0,2)].every(v=>Number.isFinite(v)&&v>=0&&v<=1))continue;context.moveTo(box.x+p[0]*box.width,box.y+p[1]*box.height);context.lineTo(box.x+q[0]*box.width,box.y+q[1]*box.height);}
    context.stroke();
  }
  const valid=(i:number)=>pose[i]?.length>=4 && pose[i][3]>=.5 && Number.isFinite(pose[i][0]) && Number.isFinite(pose[i][1]) && pose[i][0]>=0 && pose[i][0]<=1 && pose[i][1]>=0 && pose[i][1]<=1;
  const point=(i:number)=>[box.x+pose[i][0]*box.width,box.y+pose[i][1]*box.height];
  context.lineCap='round';context.lineJoin='round';context.strokeStyle='#c1f3d6';context.lineWidth=Math.max(1.6,Math.min(3.2,width/400));
  context.beginPath();
  for (const [a,b] of BONES) { if (!valid(a)||!valid(b)) continue;const p=point(a),q=point(b);context.moveTo(p[0],p[1]);context.lineTo(q[0],q[1]); }
  context.stroke();context.fillStyle='#f0fff5';
  let visible=0;
  for (let i=0;i<pose.length;i++) { if (!valid(i)) continue;visible++;const [x,y]=point(i);context.beginPath();context.arc(x,y,i<=10?1.4:Math.max(2,Math.min(3.6,width/360)),0,Math.PI*2);context.fill(); }
  canvas.dataset.joints=String(visible);
}
