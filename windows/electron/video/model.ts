import {validateTimeline,type Timeline,type EditAsset} from './timeline'
import {markBounds} from './mark-geometry'
export interface Rect { x: number; y: number; width: number; height: number }
export interface Span { start: number; end: number }
export type MarkTool = 'rect' | 'arrow' | 'pen' | 'highlight' | 'text' | 'number' | 'cover'
export interface Mark extends Rect, Span { id: string; tool: MarkTool; color: string; stroke: number; text: string; fontSize?:number; rotation?:number; textDirection?:'horizontal'|'vertical'; textAutoSize?:boolean; highlightMode?:'spotlight'|'stroke'; dimOpacity?:number; enabled: boolean; points?: { x: number; y: number; t?: number }[] }
export interface Zoom extends Span { id: string; scale: number; cx: number; cy: number }
export interface VideoProject {
  timeline?:Timeline; assets?:EditAsset[];
  schemaVersion: 1; id: string; title: string; createdAt: string; revision: number;
  width: number; height: number; duration: number; status: 'recording' | 'ready' | 'recovered';
  hasMic: boolean; hasSystem: boolean; marks: Mark[]; cuts: Span[]; mutes: Span[]; zooms: Zoom[];
  crop: Rect; micVolume: number; systemVolume: number; splits?:number[]; exports: { name: string; createdAt: string }[];
}
export interface RecordingSource { id: string; name: string; kind: 'screen' | 'window'; displayId: string; thumbnail: string; bounds?: Rect; physical?:Rect; scale: number }
export interface RecordingOptions { sourceId: string; region?: Rect; mic: boolean; micName: string; system: boolean }
export interface RecordingState { phase: 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'; id?: string; elapsed: number; message?: string; bounds?: Rect; width?: number; height?: number; marks?: Mark[]; drawing?: boolean; switching?:boolean; choosingSource?:boolean; sourceName?:string; health?:import('./health').CaptureHealth }
export interface VideoSettings { root: string; startKey: string; pauseKey: string; stopKey: string; annotateKey: string; system: boolean; mic: boolean; micName: string; countdown: number }
export interface ExportProgress { id: string; phase: 'rendering' | 'done' | 'error' | 'canceled'; progress: number; message: string }
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** Adapted from OpenScreen v1.11.0 src/lib/exporter/timelineSegments.ts (MIT).
 * Source-time cuts, monotonically advancing cursor: overlapping removals cannot
 * re-emit already removed media. Video and audio MUST use the same segments. */
export function keepSegments(duration: number, cuts: Span[]): Span[] {
  const result: Span[] = []; let cursor = 0
  for (const cut of [...cuts].sort((a,b)=>a.start-b.start)) {
    const start=clamp(cut.start,0,duration), end=clamp(cut.end,0,duration)
    if (cursor < start) result.push({start:cursor,end:start})
    cursor=Math.max(cursor,end)
  }
  if (cursor<duration) result.push({start:cursor,end:duration})
  return result.filter(s=>s.end-s.start>=1)
}
export function outputDuration(p: VideoProject) { return keepSegments(p.duration,p.cuts).reduce((n,s)=>n+s.end-s.start,0) }
export function sourceAt(p: VideoProject, time: number) {
  for (const s of keepSegments(p.duration,p.cuts)) { if(time<s.end-s.start) return s.start+Math.max(0,time); time-=s.end-s.start }
  return keepSegments(p.duration,p.cuts).at(-1)?.end ?? 0
}
export function outputAt(p: VideoProject, time: number) { let t=0; for(const s of keepSegments(p.duration,p.cuts)){if(time<=s.end)return t+clamp(time-s.start,0,s.end-s.start);t+=s.end-s.start}return t }
export function viewportAt(p: VideoProject, time: number): Rect {
  const c=p.crop, z=[...p.zooms].reverse().find(z=>time>=z.start&&time<z.end)
  const scale=z?.scale??1, width=c.width/scale,height=c.height/scale
  // Canonical even-pixel viewport shared by the preview and YUV420 encoder.
  return { x:Math.floor(clamp((z?.cx??c.x+c.width/2)-width/2,c.x,c.x+c.width-width)/2)*2,y:Math.floor(clamp((z?.cy??c.y+c.height/2)-height/2,c.y,c.y+c.height-height)/2)*2,width:Math.max(2,Math.floor(width/2)*2),height:Math.max(2,Math.floor(height/2)*2) }
}
export function previewToSource(v: Rect, x:number,y:number, w:number,h:number) { return {x:v.x+x/w*v.width,y:v.y+y/h*v.height} }
export function sourceToPreview(v: Rect, x:number,y:number, w:number,h:number) { return {x:(x-v.x)/v.width*w,y:(y-v.y)/v.height*h} }
export const escapeXml=(s:string)=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!))
export const markFontSize=(m:Mark)=>m.fontSize??Math.max(20,m.stroke*6)
/** Explicit lines keep exported SVG and the canvas identical across renderers. */
export function markTextLines(m:Mark) {
  if(m.textAutoSize!==false||m.textDirection==='vertical')return m.text.split('\n')
  if(m.fontSize===undefined)return [m.text]
  const size=markFontSize(m),limit=Math.max(size,m.width),lines:string[]=[]
  for(const paragraph of m.text.split('\n')){let line='',width=0;for(const ch of paragraph){const advance=size*(/[\u0020-\u007e]/.test(ch)?.6:1);if(line&&width+advance>limit){lines.push(line);line='';width=0}line+=ch;width+=advance}lines.push(line)}
  return lines
}
export function markSvg(m: Mark,time=Infinity):string {
  if(m.rotation){const clean={...m,rotation:0},b=markBounds(clean);return `<g transform="rotate(${m.rotation} ${b.x+b.width/2} ${b.y+b.height/2})">${markSvg(clean,time)}</g>`}
  const c=m.color, sw=m.stroke, x=m.x,y=m.y,w=m.width,h=m.height
  const common=`stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" fill="none"`
  if(m.tool==='cover')return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`
  if(m.tool==='rect')return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${common}/>`
  if(m.tool==='text'||m.tool==='number'){const size=markFontSize(m),lines=markTextLines(m);return `<text fill="${c}" font-family="Microsoft YaHei UI" font-size="${size}" xml:space="preserve">${m.textDirection==='vertical'?lines.map((line,i)=>Array.from(line).map((ch,j)=>`<tspan x="${x+(lines.length-1-i)*size*1.2}" y="${y+size+j*size*1.2}">${escapeXml(ch)}</tspan>`).join('')).join(''):lines.map((line,i)=>`<tspan x="${x}" y="${y+size+i*size*1.2}">${escapeXml(line)}</tspan>`).join('')}</text>`}
  if(m.tool==='highlight'&&m.highlightMode==='spotlight')return `<path d="M-100000,-100000 H100000 V100000 H-100000 Z M${x},${y} h${w} v${h} h${-w} Z" fill="#000000" fill-opacity="${m.dimOpacity??.65}" fill-rule="evenodd"/>`
  if(m.tool==='arrow') { const a=Math.atan2(h,w), l=Math.max(12,sw*4),ex=x+w,ey=y+h; return `<path d="M${x},${y} L${ex},${ey} M${ex-l*Math.cos(a-.5)},${ey-l*Math.sin(a-.5)} L${ex},${ey} L${ex-l*Math.cos(a+.5)},${ey-l*Math.sin(a+.5)}" ${common}/>` }
  const pts=(m.points??[{x,y},{x:x+w,y:y+h}]).filter(p=>!('t' in p)||p.t===undefined||p.t<=time)
  return `<polyline points="${pts.map(p=>`${p.x},${p.y}`).join(' ')}" ${common} ${m.tool==='highlight'?`opacity="0.35" style="stroke-width:${sw*5}px"`:''}/>`
}
export function visibleMarks(p:VideoProject,t:number) { return p.marks.filter(m=>m.enabled&&m.start<=t&&m.end>t) }
export const tools: {id:MarkTool;label:string}[]=[{id:'rect',label:'矩形'},{id:'arrow',label:'箭头'},{id:'pen',label:'画笔'},{id:'highlight',label:'高亮'},{id:'text',label:'文字'},{id:'number',label:'编号'},{id:'cover',label:'遮挡'}]
export function validateEdits(value:unknown, base:VideoProject):VideoProject {
  const p=value as VideoProject
  const finite=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max
  const span=(s:Span)=>s&&finite(s.start,0,base.duration)&&finite(s.end,s.start+1,base.duration)
  const rect=(r:Rect)=>r&&finite(r.x,0,base.width)&&finite(r.y,0,base.height)&&finite(r.width,2,base.width-r.x)&&finite(r.height,2,base.height-r.y)
  if(!p||typeof p.title!=='string'||!p.title.trim()||p.title.length>120||!rect(p.crop)||!finite(p.micVolume,0,2)||!finite(p.systemVolume,0,2))throw Error('录屏项目参数无效。')
  for(const key of ['cuts','mutes','zooms','marks'] as const)if(!Array.isArray(p[key])||p[key].length>2000)throw Error('项目对象数量无效。')
  if(p.splits&&(!Array.isArray(p.splits)||p.splits.length>2000||!p.splits.every(t=>finite(t,0,base.duration))))throw Error('分割位置无效。')
  if(!p.cuts.every(span)||!p.mutes.every(span)||!p.zooms.every(z=>span(z)&&finite(z.scale,1,4)&&finite(z.cx,0,base.width)&&finite(z.cy,0,base.height)))throw Error('时间范围或放大位置无效。')
  const ids=new Set<string>()
  for(const m of p.marks){
    if(!m)throw Error('标记内容缺失。')
    if(m.rotation!==undefined&&!finite(m.rotation,-360,360)||m.textDirection!==undefined&&!['horizontal','vertical'].includes(m.textDirection)||m.textAutoSize!==undefined&&typeof m.textAutoSize!=='boolean'||m.highlightMode!==undefined&&!['spotlight','stroke'].includes(m.highlightMode)||m.dimOpacity!==undefined&&!finite(m.dimOpacity,0,.95))throw Error('标记样式无效。')
    if(m.fontSize!==undefined&&!finite(m.fontSize,8,1000))throw Error('文字字号无效。')
    if(!m||typeof m.id!=='string'||ids.has(m.id)||!span(m)||!tools.some(t=>t.id===m.tool)||!/^#[\da-fA-F]{6}$/.test(m.color)||!finite(m.stroke,1,30)||typeof m.text!=='string'||m.text.length>500||typeof m.enabled!=='boolean'||!finite(m.x,0,base.width)||!finite(m.y,0,base.height)||!finite(m.width,-base.width,base.width)||!finite(m.height,-base.height,base.height))throw Error('标记参数无效。')
    if(m.points&&(!Array.isArray(m.points)||m.points.length>20000||m.points.some(pt=>!finite(pt.x,0,base.width)||!finite(pt.y,0,base.height)||(pt.t!==undefined&&!finite(pt.t,0,base.duration)))))throw Error('画笔轨迹无效。')
    if(m.tool!=='arrow'&&m.tool!=='pen'&&m.tool!=='highlight'&&(m.width<0||m.height<0))throw Error('标记尺寸无效。')
    ids.add(m.id)
  }
  if(!keepSegments(base.duration,p.cuts).length)throw Error('至少保留一段视频。')
  return {...base,timeline:p.timeline?validateTimeline(p.timeline,base,base.assets??[]):undefined,title:p.title.trim(),crop:p.crop,cuts:p.cuts,mutes:p.mutes,zooms:p.zooms,marks:p.marks,splits:p.splits??[],micVolume:p.micVolume,systemVolume:p.systemVolume,revision:base.revision+1}
}
