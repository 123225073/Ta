import {clipDuration, clipEnd, keyAt, replaceLinked, resizeSpeed, splitLinked, type Timeline, type TimelineClip, type Keyframe} from './timeline'

export type EditAction =
  | {type:'move'; ids:string[]; delta:number}
  | {type:'delete'; ids:string[]; ripple?:boolean}
  | {type:'split'; ids:string[]; time:number}
  | {type:'trim'; id:string; side:'left'|'right'; time:number; sourceDuration:number}
  | {type:'speed'; id:string; speed:number}

export function selectionIds(t:Timeline, ids:string[]) {
  if(!Array.isArray(ids)||!ids.every(id=>typeof id==='string'))throw Error('请选择有效的片段。')
  const clips=t.tracks.flatMap(t=>t.clips), selected=new Set(ids), links=new Set(clips.filter(c=>selected.has(c.id)&&c.link).map(c=>c.link))
  return new Set(clips.filter(c=>selected.has(c.id)||!!c.link&&links.has(c.link)).map(c=>c.id))
}

// A gesture is previewed against its initial snapshot, then committed once.
// UI and CLI use the same source-time, linked-audio and undo boundaries.
export function editTimeline(t:Timeline, action:EditAction, uid:()=>string):Timeline {
  const next=structuredClone(t), all=next.tracks.flatMap(t=>t.clips)
  if('ids' in action&&(!Array.isArray(action.ids)||!action.ids.length||action.ids.some(id=>!all.some(c=>c.id===id))))throw Error('请选择仍存在的片段。')
  if(action.type==='split'&&!Number.isFinite(action.time))throw Error('分割时间无效。')
  if(action.type==='move') {
    if(!Number.isFinite(action.delta))throw Error('移动时间无效。')
    const ids=selectionIds(next,action.ids), chosen=all.filter(c=>ids.has(c.id));if(!chosen.length)return next
    const delta=Math.max(-Math.min(...chosen.map(c=>c.start)),action.delta)
    for(const c of chosen)c.start+=delta
    return next
  }
  if(action.type==='delete') {
    const ids=selectionIds(next,action.ids), intervals=all.filter(c=>ids.has(c.id)).map(c=>[c.start,clipEnd(c)]).sort((a,b)=>a[0]-b[0]), ranges:number[][]=[]
    for(const r of intervals){const last=ranges.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else ranges.push([...r])}
    if(action.ripple&&ranges.some(([a,b])=>all.some(c=>!ids.has(c.id)&&c.start<b&&clipEnd(c)>a)))throw Error('该时间段还有未选中的素材，请一并选中，或使用普通删除以保留其他内容。')
    for(const track of next.tracks)track.clips=track.clips.filter(c=>!ids.has(c.id)).map(c=>({...c,start:c.start-(action.ripple?ranges.filter(r=>r[1]<=c.start).reduce((s,r)=>s+r[1]-r[0],0):0)}))
    if(!next.tracks.some(t=>t.kind==='video'&&t.clips.length))throw Error('至少保留一个视频片段。')
    return next
  }
  if(action.type==='split') {
    const ids=selectionIds(next,action.ids), done=new Set<string>();let result=next,count=0
    for(const c of all){if(!ids.has(c.id)||done.has(c.link??c.id)||action.time-c.start<34||clipEnd(c)-action.time<34)continue;result=splitLinked(result,c,action.time,uid);done.add(c.link??c.id);count++}
    if(!count)throw Error('请把播放头移到选中片段内部再分割。')
    return result
  }
  const c=all.find(c=>c.id===action.id);if(!c)throw Error('片段不存在。')
  if(action.type==='speed')return replaceLinked(next,resizeSpeed(c,(c.out-c.in)/action.speed))
  const track=next.tracks.find(t=>t.clips.some(v=>v.id===c.id))!,media=track.kind==='video'||track.kind==='audio',oldDuration=clipDuration(c)
  if(!Number.isFinite(action.time)||action.time<0)throw Error('裁剪时间无效。')
  const change=action.side==='left'?action.time-c.start:0,newDuration=action.side==='left'?oldDuration-change:action.time-c.start
  if(newDuration<34)throw Error('片段至少保留一帧。')
  const input=c.in+change*c.speed,output=action.side==='left'?c.out:c.in+newDuration*c.speed
  if(media&&(input<-.001||output>action.sourceDuration+.001))throw Error('已到素材边界；需要拉长播放时间时，请切换为变速模式。')
  const keys=c.keys.length?[{...keyAt(c,change),time:0},...c.keys.filter(k=>k.time>change&&k.time<change+newDuration).map(k=>({...k,time:k.time-change})),{...keyAt(c,change+newDuration),time:newDuration}]:[]
  return replaceLinked(next,{...c,start:action.side==='left'?action.time:c.start,in:media?Math.max(0,input):0,out:media?Math.min(action.sourceDuration,output):newDuration*c.speed,keys})
}

export function snapMove(t:Timeline, ids:string[], delta:number, playhead:number, threshold:number) {
  const selected=selectionIds(t,ids), clips=t.tracks.flatMap(t=>t.clips), edges=clips.filter(c=>selected.has(c.id)).flatMap(c=>[c.start,c.start+clipDuration(c)])
  const points=[0,playhead,...clips.filter(c=>!selected.has(c.id)).flatMap(c=>[c.start,clipEnd(c),...c.keys.map(k=>c.start+k.time)])]
  let distance=threshold,adjustment=0,guide:number|undefined
  for(const edge of edges)for(const point of points){const diff=point-(edge+delta);if(Math.abs(diff)<distance){distance=Math.abs(diff);adjustment=diff;guide=point}}
  return {delta:delta+adjustment,guide}
}

export function snapTime(t:Timeline,ids:string[],time:number,playhead:number,threshold:number){
  const selected=selectionIds(t,ids),points=[0,playhead,...t.tracks.flatMap(t=>t.clips).filter(c=>!selected.has(c.id)).flatMap(c=>[c.start,clipEnd(c),...c.keys.map(k=>c.start+k.time)])]
  let guide:number|undefined,distance=threshold
  for(const point of points)if(Math.abs(point-time)<distance){distance=Math.abs(point-time);guide=point}
  return {time:guide??time,guide}
}

export interface ZoomRecipe {start:number;end:number;scale:number;cx:number;cy:number;enter:number;exit:number;ease?:Keyframe['ease']}
export function configureZoom(c:TimelineClip,r:ZoomRecipe):TimelineClip {
  if(![r.start,r.end,r.scale,r.cx,r.cy,r.enter,r.exit].every(Number.isFinite)||r.start<0||r.end-r.start<100||r.scale<1||r.scale>4||r.cx<0||r.cx>1||r.cy<0||r.cy>1||r.enter<0||r.exit<0||r.enter+r.exit>r.end-r.start)throw Error('请检查放大时段；进入和退出时长之和不能超过总时长。')
  const length=r.end-r.start,ease=r.ease??'smooth',keys=new Map<number,Keyframe>(),put=(time:number,scale:number,cx:number,cy:number)=>keys.set(time,{time,scale,cx,cy,ease})
  put(0,1,.5,.5);put(r.enter,r.scale,r.cx,r.cy);put(length-r.exit,r.scale,r.cx,r.cy);if(r.exit>0)put(length,1,.5,.5)
  return {...c,start:r.start,in:0,out:length,speed:1,keys:[...keys.values()].sort((a,b)=>a.time-b.time)}
}
