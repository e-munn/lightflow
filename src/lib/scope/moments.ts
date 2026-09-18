export const MOMENT_TAGS=['follows_music','missed_detail','stays_bright'] as const;
export type MomentTag=typeof MOMENT_TAGS[number];
export type MomentFrame={at:number;sourceSeconds:number|null;brightness:number;features:number[];exposure:number;softCurve:boolean;visibleFraction:number;pageVisible:boolean};
export type MomentSource={sessionId:string;kind:'url'|'file'|'mic'|'system';name:string;url?:string;size?:number;lastModified?:number};
export type ListeningMoment={id:string;tag:MomentTag;created:string;automated:boolean;source:MomentSource;frames:MomentFrame[];note:string;baseline:'scope-coverage-256-soft-v1';modelEnabled:false;timing:'approximate media clock; reaction window, not exact event label'};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function validateMomentBatch(body:unknown):ListeningMoment[]{
 if(!record(body)||body.version!==1||!Array.isArray(body.moments)||!body.moments.length||body.moments.length>25)throw Error('Expected 1–25 listening marks.');
 const moments=body.moments;const seen=new Set();
 for(const m of moments){
  if(!record(m)||!uuid(m.id)||seen.has(m.id)||!MOMENT_TAGS.includes(m.tag as MomentTag)||typeof m.automated!=='boolean'||typeof m.created!=='string'||!Number.isFinite(Date.parse(m.created))||typeof m.note!=='string'||m.note.length>1000||m.baseline!=='scope-coverage-256-soft-v1'||m.modelEnabled!==false||m.timing!=='approximate media clock; reaction window, not exact event label')throw Error('Invalid listening mark.');
  seen.add(m.id);const s=m.source;
  if(!record(s)||!uuid(s.sessionId)||!['url','file','mic','system'].includes(s.kind as string)||typeof s.name!=='string'||s.name.length>512)throw Error('Invalid source identity.');
  if(s.kind==='url'&&(typeof s.url!=='string'||!/^\/api\/scope-research\/(forest|ultra|jackWhite)$/.test(s.url)))throw Error('Invalid research source.');
  if(s.kind==='file'&&(!finite(s.size)||s.size<0||!finite(s.lastModified)))throw Error('Invalid file identity.');
  if(!Array.isArray(m.frames)||m.frames.length<2||m.frames.length>300)throw Error('Invalid observation window.');
  let previous=-Infinity;
  for(const f of m.frames){
   if(!record(f)||!finite(f.at)||f.at<=previous||!(f.sourceSeconds===null||finite(f.sourceSeconds))||!finite(f.brightness)||f.brightness<0||f.brightness>1||!Array.isArray(f.features)||f.features.length!==8||!f.features.every((v:unknown)=>finite(v)&&v>=-1.000001&&v<=1.000001)||!finite(f.exposure)||f.exposure<5||f.exposure>100||typeof f.softCurve!=='boolean'||typeof f.pageVisible!=='boolean'||!finite(f.visibleFraction)||f.visibleFraction<0||f.visibleFraction>1)throw Error('Invalid signal frame.');
   previous=f.at;
  }
  if(m.frames.at(-1).at-m.frames[0].at>5.2)throw Error('Observation window is too long.');
 }
 // Rebuild approved fields; never persist arbitrary client properties or audio samples.
 return moments.map(m=>({id:m.id,tag:m.tag,created:m.created,automated:m.automated,source:{sessionId:m.source.sessionId,kind:m.source.kind,name:m.source.name,...(m.source.kind==='url'?{url:m.source.url}:{}),...(m.source.kind==='file'?{size:m.source.size,lastModified:m.source.lastModified}:{})},frames:m.frames.map((f:MomentFrame)=>({at:f.at,sourceSeconds:f.sourceSeconds,brightness:f.brightness,features:[...f.features],exposure:f.exposure,softCurve:f.softCurve,visibleFraction:f.visibleFraction,pageVisible:f.pageVisible})),note:m.note,baseline:m.baseline,modelEnabled:false,timing:m.timing}));
}
