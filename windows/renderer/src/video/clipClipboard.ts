import type {Timeline, TimelineClip, TrackKind} from '../../../electron/video/timeline'

export interface ClipClipboard {primary:string; items:{track:string; kind:TrackKind; clip:TimelineClip}[]}
export function copyClips(timeline:Timeline, id:string):ClipClipboard|undefined {
  const primary=timeline.tracks.flatMap(t=>t.clips).find(c=>c.id===id)
  if(!primary)return
  return {primary:id,items:timeline.tracks.flatMap(t=>t.clips.filter(c=>c.id===id||!!primary.link&&c.link===primary.link).map(clip=>({track:t.id,kind:t.kind,clip:structuredClone(clip)})))}
}
export function pasteClips(timeline:Timeline, data:ClipClipboard, targetId:string, time:number, uid:()=>string) {
  const next=structuredClone(timeline),primary=data.items.find(i=>i.clip.id===data.primary)!,links=new Map<string,string>();let selected=''
  for(const item of data.items){
    const c=structuredClone(item.clip);c.id=uid();c.start=Math.max(0,time+item.clip.start-primary.clip.start)
    if(c.link){if(!links.has(c.link))links.set(c.link,uid());c.link=links.get(c.link)}
    if(c.mark)c.mark.id=c.id
    const target=next.tracks.find(t=>t.id===(item.clip.id===data.primary?targetId:item.track)&&t.kind===item.kind)??next.tracks.find(t=>t.id===item.track&&t.kind===item.kind)
    if(!target)throw Error('请先选择一个兼容的轨道。')
    target.clips.push(c);if(item.clip.id===data.primary)selected=c.id
  }
  return {timeline:next,selected}
}
