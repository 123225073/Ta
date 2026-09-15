import { keepSegments,validateEdits,type VideoProject,type Mark,clamp } from './model'
export type TrackKind='video'|'audio'|'mark'|'zoom'
export interface Keyframe {time:number;scale:number;cx:number;cy:number;ease?:'smooth'|'linear'|'hold'}
export interface TimelineClip {id:string;link?:string;name:string;start:number;in:number;out:number;speed:number;asset:string;volume:number;enabled:boolean;rect:{x:number;y:number;width:number;height:number};keys:Keyframe[];mark?:Mark}
export interface TimelineTrack {id:string;name:string;kind:TrackKind;muted:boolean;clips:TimelineClip[]}
export interface EditAsset {file:string;name:string;kind:'video'|'audio';duration:number;width:number;height:number;audio:boolean}
export interface Timeline {version:1;tracks:TimelineTrack[]}
export const clipDuration=(c:TimelineClip)=>(c.out-c.in)/c.speed
export const clipEnd=(c:TimelineClip)=>c.start+clipDuration(c)
export const timelineDuration=(t:Timeline)=>Math.max(1,...t.tracks.flatMap(t=>t.clips.map(clipEnd)))
export const activeClip=(c:TimelineClip,t:number)=>c.enabled&&t>=c.start&&t<clipEnd(c)
export const clipSourceTime=(c:TimelineClip,t:number)=>c.in+clamp(t-c.start,0,clipDuration(c))*c.speed
export const makeClip=(id:string,name:string,asset:string,duration:number,start=0):TimelineClip=>({id,name,asset,start,in:0,out:duration,speed:1,volume:1,enabled:true,rect:{x:0,y:0,width:1,height:1},keys:[]})
export function keyAt(c:TimelineClip,local:number):Keyframe {
  const keys=[...c.keys].sort((a,b)=>a.time-b.time);if(!keys.length)return {time:local,scale:1,cx:.5,cy:.5}
  if(local<=keys[0].time)return {...keys[0],time:local};const right=keys.findIndex(k=>k.time>local);if(right<0)return {...keys.at(-1)!,time:local}
  const a=keys[right-1],b=keys[right],u=(local-a.time)/(b.time-a.time),f=a.ease==='hold'?0:a.ease==='linear'?u:u*u*(3-2*u)
  return {time:local,scale:a.scale+(b.scale-a.scale)*f,cx:a.cx+(b.cx-a.cx)*f,cy:a.cy+(b.cy-a.cy)*f,...(a.ease?{ease:a.ease}:{})}
}
export function splitClip(c:TimelineClip,time:number,newId:string):[TimelineClip,TimelineClip] {
  const local=time-c.start;if(local<34||clipDuration(c)-local<34)throw Error('请在片段内部选择分割位置。')
  const middle=clipSourceTime(c,time),key=keyAt(c,local)
  return [{...c,out:middle,keys:c.keys.length?[...c.keys.filter(k=>k.time<local),{...key,time:local}]:[]},{...structuredClone(c),id:newId,start:time,in:middle,keys:c.keys.length?[{...key,time:0},...c.keys.filter(k=>k.time>local).map(k=>({...k,time:k.time-local}))]:[]}]
}
export function resizeSpeed(c:TimelineClip,duration:number):TimelineClip {
  const speed=(c.out-c.in)/duration;if(!Number.isFinite(speed)||speed<.25||speed>4)throw Error('变速范围为 0.25–4 倍。')
  const ratio=duration/clipDuration(c);return {...c,speed,keys:c.keys.map(k=>({...k,time:k.time*ratio}))}
}
export function migrateTimeline(p:VideoProject):Timeline {
  if(p.timeline)return structuredClone(p.timeline)
  const tracks:TimelineTrack[]=[{id:'main-video',name:'主视频',kind:'video',muted:false,clips:[]}]
  for(const [asset,enabled,volume,name] of [['system.wav',p.hasSystem,p.systemVolume,'电脑声音'],['mic.wav',p.hasMic,p.micVolume,'麦克风']] as const)if(enabled)tracks.push({id:asset,name,kind:'audio',muted:false,clips:[]})
  const mark:TimelineTrack={id:'marks',name:'标记',kind:'mark',muted:false,clips:[]},zoom:TimelineTrack={id:'zoom',name:'区域缩放',kind:'zoom',muted:false,clips:[]};tracks.push(mark,zoom)
  let at=0,n=0
  for(const kept of keepSegments(p.duration,p.cuts)){
    const edges=[...new Set([kept.start,...[...(p.splits??[]),...p.mutes.flatMap(m=>[m.start,m.end])].filter(t=>t>kept.start&&t<kept.end),kept.end])].sort((a,b)=>a-b)
    for(let i=1;i<edges.length;i++){const start=edges[i-1],end=edges[i],length=end-start
      const link='recording-'+n
      for(const track of tracks.filter(t=>t.kind==='video'||t.kind==='audio')){const c=makeClip('legacy-'+n++,'片段 '+n,track.kind==='video'?'screen.mp4':track.id,length,at);c.link=link;c.in=start;c.out=end;c.volume=track.id==='mic.wav'?p.micVolume:p.systemVolume;if(track.kind==='audio'&&p.mutes.some(m=>m.start<=start&&m.end>=end))c.volume=0;track.clips.push(c)}
      for(const m of p.marks){const a=Math.max(start,m.start),b=Math.min(end,m.end);if(b>a){const c=makeClip('legacy-'+n++,m.text||m.tool,'',b-a,at+a-start);c.mark=structuredClone(m);c.enabled=m.enabled;mark.clips.push(c)}}
      for(const z of p.zooms){const a=Math.max(start,z.start),b=Math.min(end,z.end);if(b>a){const c=makeClip('legacy-'+n++,'区域放大','',b-a,at+a-start);c.keys=[{time:0,scale:z.scale,cx:clamp((z.cx-p.crop.x)/p.crop.width,0,1),cy:clamp((z.cy-p.crop.y)/p.crop.height,0,1)}];zoom.clips.push(c)}}
      at+=length
    }
  }
  return {version:1,tracks}
}
// Recorded picture and sound share timing edits; volume and visual properties stay independent.
export function replaceLinked(t:Timeline,c:TimelineClip):Timeline {
  const old=t.tracks.flatMap(t=>t.clips).find(v=>v.id===c.id)!
  return {...t,tracks:t.tracks.map(t=>({...t,clips:t.clips.map(v=>v.id===c.id?c:old.link&&v.link===old.link?{...v,start:c.start,in:c.in,out:c.out,speed:c.speed,keys:v.keys.map(k=>({...k,time:k.time*clipDuration(c)/clipDuration(old)})).filter(k=>k.time<=clipDuration(c))}:v)}))}
}
export function removeLinked(t:Timeline,c:TimelineClip):Timeline {return {...t,tracks:t.tracks.map(t=>({...t,clips:t.clips.filter(v=>v.id!==c.id&&(!c.link||v.link!==c.link))}))}}
export function splitLinked(t:Timeline,c:TimelineClip,time:number,id:()=>string):Timeline {
  const link=id();return {...t,tracks:t.tracks.map(t=>({...t,clips:t.clips.flatMap(v=>{if(v.id!==c.id&&(!c.link||v.link!==c.link))return [v];const pair=splitClip(v,time,id());if(c.link)pair[1].link=link;return pair})}))}
}
export function validateTimeline(t:Timeline,p:VideoProject,assets:EditAsset[]):Timeline {
  const num=(n:number,a:number,b:number)=>Number.isFinite(n)&&n>=a&&n<=b,ids=new Set<string>(),names=['screen.mp4',...(p.hasMic?['mic.wav']:[]),...(p.hasSystem?['system.wav']:[]),...assets.map(a=>a.file)]
  if(!t||t.version!==1||!Array.isArray(t.tracks)||t.tracks.length>30)throw Error('时间线轨道无效。')
  const trackIds=new Set<string>();for(const track of t.tracks){if(typeof track?.id!=='string'||!track.id||track.id.length>100||trackIds.has(track.id))throw Error('轨道编号无效。');trackIds.add(track.id)}
  for(const track of t.tracks){if(!track||!['video','audio','mark','zoom'].includes(track.kind)||typeof track.name!=='string'||track.name.length>100||typeof track.muted!=='boolean'||!Array.isArray(track.clips)||track.clips.length>500)throw Error('轨道参数无效。');for(const c of track.clips){
    const asset=assets.find(a=>a.file===c.asset),limit=asset?.duration??p.duration
    if(typeof c.id!=='string'||ids.has(c.id)||typeof c.name!=='string'||c.name.length>150||!num(c.start,0,7200000)||!num(c.in,0,7200000)||!num(c.out,c.in+1,7200000)||!num(c.speed,.25,4)||!num(c.volume,0,2)||typeof c.enabled!=='boolean'||!Array.isArray(c.keys)||c.keys.length>100)throw Error('片段参数无效。')
    if((track.kind==='video'||track.kind==='audio')&&(!names.includes(c.asset)||c.out>limit||track.kind==='video'&&(asset?.kind==='audio'||c.asset.endsWith('.wav'))))throw Error('片段媒体或范围无效。')
    if(track.kind==='audio'&&(c.asset==='screen.mp4'||asset&&!asset.audio))throw Error('素材中没有可用声音。')
    if(!c.rect||!num(c.rect.x,0,1)||!num(c.rect.y,0,1)||!num(c.rect.width,.02,1)||!num(c.rect.height,.02,1))throw Error('画面位置无效。')
    // Millisecond timestamps may contain repeating fractions at 30 fps. Permit
    // sub-microsecond rounding at the end, then normalize the persisted copy.
    let previous=-1;for(const k of [...c.keys].sort((a,b)=>a.time-b.time)){if(k.ease!==undefined&&!["smooth","linear","hold"].includes(k.ease)||!num(k.time,0,clipDuration(c)+.000001)||k.time===previous||!num(k.scale,1,4)||!num(k.cx,0,1)||!num(k.cy,0,1))throw Error('关键帧参数无效。');previous=k.time}
    if(c.link!==undefined&&(typeof c.link!=='string'||c.link.length>100))throw Error('片段关联无效。')
    if(track.kind==='mark'){if(!c.mark)throw Error('标记内容缺失。');validateEdits({...p,timeline:undefined,marks:[c.mark]}, {...p,timeline:undefined})}ids.add(c.id)
  }}
  if(!t.tracks.some(t=>t.kind==='video'&&t.clips.length))throw Error('至少保留一个视频片段。')
  if(timelineDuration(t)>7200000)throw Error('编辑后时长不能超过两小时。')
  const result=structuredClone(t);for(const track of result.tracks)for(const c of track.clips)c.keys=c.keys.map(k=>({...k,time:Math.min(k.time,clipDuration(c))}));return result
}
