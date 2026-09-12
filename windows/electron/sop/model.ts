export interface SopImage { id:string; file:string; time:number|null; caption:string; source:'video'|'upload'; original?:string }
export interface SopStep { id:string; title:string; body:string; expected:string; note:string; time:number|null; images:SopImage[] }
export interface TranscriptLine { start:number; end:number; text:string }
export interface SopDocument { schemaVersion:1; projectId:string; revision:number; title:string; description:string; audience:string; detail:'quick'|'standard'|'detailed'; instructions:string; steps:SopStep[]; transcript:TranscriptLine[]; chat:{role:'user'|'assistant';text:string}[]; updatedAt:string }
export interface SopProgress { projectId:string; message:string; current:number; total:number; busy:boolean }
export interface SopVersion { revision:number; title:string; updatedAt:string; reason:string }
export const assetPattern=/^sop-[a-f0-9]{16}\.(png|jpg|gif)$/
const string=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max
const time=(v:unknown,d:number):v is number|null=>v===null||(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=d)
export function validateDocument(value:unknown,projectId:string,duration:number):SopDocument {
 const d=value as SopDocument
 if(!d||d.schemaVersion!==1||d.projectId!==projectId||!Number.isInteger(d.revision)||d.revision<0||!string(d.title,200)||!d.title.trim()||!string(d.description,8000)||!string(d.audience,300)||!string(d.instructions,8000)||!['quick','standard','detailed'].includes(d.detail)||!Array.isArray(d.steps)||d.steps.length>500||!Array.isArray(d.transcript)||d.transcript.length>10000||!Array.isArray(d.chat)||d.chat.length>100)throw Error('SOP 文档格式无效。')
 const ids=new Set<string>()
 for(const s of d.steps){if(!s||!string(s.id,80)||!s.id||ids.has(s.id)||!string(s.title,300)||!string(s.body,12000)||!string(s.expected,4000)||!string(s.note,4000)||!time(s.time,duration)||!Array.isArray(s.images)||s.images.length>12)throw Error('步骤内容或来源时间无效。');ids.add(s.id)
 for(const i of s.images)if(!i||!string(i.id,80)||!assetPattern.test(i.file)||!string(i.caption,1000)||!time(i.time,duration)||!['video','upload'].includes(i.source)||(i.original&&!assetPattern.test(i.original)))throw Error('配图来源无效。')}
 for(const t of d.transcript)if(!t||!time(t.start,duration)||t.start===null||!time(t.end,duration)||t.end===null||t.end<t.start||!string(t.text,12000))throw Error('讲解时间无效。')
 for(const c of d.chat)if(!c||!['user','assistant'].includes(c.role)||!string(c.text,20000))throw Error('对话记录无效。')
 return structuredClone(d)
}
export function parseModelJson(text:string):any {const clean=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');try{return JSON.parse(clean)}catch{throw Error('AI 返回的结构无法读取，未修改原文。请重试。')}}
export function parseSubtitles(text:string,duration:number):TranscriptLine[]{
 const lines:TranscriptLine[]=[];const stamp=(s:string)=>{const a=s.replace(',','.').split(':').map(Number);return (a.length===3?a[0]*3600+a[1]*60+a[2]:a[0]*60+a[1])*1000}
 for(const block of text.replace(/\r/g,'').split(/\n\s*\n/)){const m=block.match(/((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})[^\n]*\n([\s\S]+)/);if(m){const start=stamp(m[1]),end=Math.min(duration,stamp(m[2]));if(start<end&&start>=0)lines.push({start,end,text:m[3].replace(/<[^>]*>/g,'').trim()})}}
 if(!lines.length)throw Error('没有读到有效的 SRT / VTT 字幕。');return lines.sort((a,b)=>a.start-b.start)
}
export const timestamp=(ms:number)=>`${Math.floor(ms/60000).toString().padStart(2,'0')}:${(ms/1000%60).toFixed(1).padStart(4,'0')}`
