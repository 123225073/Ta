import type {Timeline, TimelineClip, TrackKind} from '../../../electron/video/timeline'
import {selectionIds} from '../../../electron/video/edit-actions'

export interface ClipClipboard {primary:string; items:{track:string; kind:TrackKind; clip:TimelineClip}[]}
export function copyClips(timeline:Timeline, id:string|string[]):ClipClipboard|undefined {
  const ids=Array.isArray(id)?id:[id],primary=timeline.tracks.flatMap(t=>t.clips).find(c=>c.id===ids[0])
  if(!primary)return
  const selected=selectionIds(timeline,ids)
  return {primary:primary.id,items:timeline.tracks.flatMap(t=>t.clips.filter(c=>selected.has(c.id)).map(clip=>({track:t.id,kind:t.kind,clip:structuredClone(clip)})))}
}
export function pasteClips(timeline:Timeline, data:ClipClipboard, targetId:string, time:number, uid:()=>string) {
  const next=structuredClone(timeline),primary=data.items.find(i=>i.clip.id===data.primary)!,links=new Map<string,string>(),selectedIds:string[]=[],origin=Math.min(...data.items.map(i=>i.clip.start));let selected=''
  for(const item of data.items){
    const c=structuredClone(item.clip);c.id=uid();c.start=Math.max(0,time)+item.clip.start-origin
    if(c.link){if(!links.has(c.link))links.set(c.link,uid());c.link=links.get(c.link)}
    if(c.mark)c.mark.id=c.id
    const target=next.tracks.find(t=>t.id===(item.track===primary.track?targetId:item.track)&&t.kind===item.kind)??next.tracks.find(t=>t.id===item.track&&t.kind===item.kind)
    if(!target)throw Error('请先选择一个兼容的轨道。')
    target.clips.push(c);selectedIds.push(c.id);if(item.clip.id===data.primary)selected=c.id
  }
  return {timeline:next,selected,selectedIds}
}
