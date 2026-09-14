import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {VideoStore} from './store'
import {VideoExporter} from './export'
import {importTimelineMedia} from './import-media'
import {validateEdits,type VideoProject,type Mark} from './model'
import {migrateTimeline,makeClip,splitLinked,removeLinked,replaceLinked,resizeSpeed,timelineDuration,type TrackKind,type TimelineClip} from './timeline'
const exec=promisify(execFile),uid=()=>crypto.randomUUID()
export const cliSchema={version:1,timeUnit:'milliseconds',coordinates:'Mark coordinates are source pixels. Clip rect and zoom centers are normalized 0..1. Keyframe time is relative to clip start.',commands:['schema','list','inspect','frame','apply','undo','redo','import','export'],operations:['track.add','clip.add','clip.patch','clip.delete','clip.split','clip.speed','mark.add','mark.patch','keyframe.set'],rules:['Mutation requires revision from inspect.','apply --dry-run validates the entire batch without saving.','apply commits one validated batch; original media is never overwritten.','A recording or export in progress returns BUSY.','If an editor is open it is saved and reopened for writes.','frame uses source video time, not edited timeline time.'],example:{projectId:'ID from list',revision:0,operations:[{op:'mark.add',trackId:'mark track ID from inspect',start:1000,end:4000,mark:{tool:'arrow',x:500,y:300,width:-200,height:0,color:'#FF4D37',stroke:6,text:''}},{op:'mark.add',trackId:'mark track ID from inspect',start:1000,end:4000,mark:{tool:'text',x:150,y:250,width:300,height:60,text:'点击这里',fontSize:48,textAutoSize:true}}]}}
export interface CLIRequest {command:string;projectId?:string;revision?:number;operations?:Record<string,unknown>[];dryRun?:boolean;output?:string;time?:number;height?:number;file?:string;kind?:'video'|'audio'}
export function planEdits(base:VideoProject,operations:Record<string,unknown>[]):VideoProject {
  if(!Array.isArray(operations)||!operations.length||operations.length>200)throw Error('OPERATIONS: expected 1..200 operations')
  let p={...structuredClone(base),timeline:migrateTimeline(base)}
  for(const op of operations){
    const track=p.timeline.tracks.find(t=>t.id===op.trackId),pair=p.timeline.tracks.flatMap(t=>t.clips.map(c=>({t,c}))).find(v=>v.c.id===op.clipId)
    const needed=()=>{if(!pair)throw Error('CLIP_NOT_FOUND: '+String(op.clipId));return pair.c}
    switch(op.op){
      case 'track.add': {const kind=op.kind as TrackKind;if(!['video','audio','mark','zoom'].includes(kind))throw Error('TRACK_KIND');p.timeline.tracks.push({id:typeof op.id==='string'?op.id:uid(),name:String(op.name??kind),kind,muted:false,clips:[]});break}
      case 'clip.add': {if(!track)throw Error('TRACK_NOT_FOUND');const c=op.clip as TimelineClip;if(!c)throw Error('CLIP_REQUIRED');track.clips.push({...structuredClone(c),id:c.id||uid()});break}
      case 'clip.patch': {const c=needed(),patch=op.patch as Partial<TimelineClip>;p.timeline=replaceLinked(p.timeline,{...c,...patch,id:c.id,asset:c.asset,link:c.link});break}
      case 'clip.delete':p.timeline=removeLinked(p.timeline,needed());break
      case 'clip.split':p.timeline=splitLinked(p.timeline,needed(),Number(op.time),uid);break
      case 'clip.speed': {const c=needed();p.timeline=replaceLinked(p.timeline,resizeSpeed(c,(c.out-c.in)/Number(op.speed)));break}
      case 'mark.add': {if(!track||track.kind!=='mark')throw Error('MARK_TRACK_REQUIRED');const c=makeClip(typeof op.id==='string'?op.id:uid(),String(op.name??'标记'),'',Number(op.end)-Number(op.start),Number(op.start));c.mark={id:c.id,tool:'rect',x:0,y:0,width:100,height:100,color:'#FF4D37',stroke:4,text:'',enabled:true,...op.mark as Partial<Mark>,start:0,end:base.duration};if(c.mark.tool==='text'){c.mark.fontSize??=Math.round(base.height*.05);c.mark.textAutoSize??=true}if(c.mark.tool==='highlight')c.mark.highlightMode??='spotlight';track.clips.push(c);break}
      case 'mark.patch': {const c=needed();if(!c.mark)throw Error('MARK_REQUIRED');p.timeline=replaceLinked(p.timeline,{...c,mark:{...c.mark,...op.patch as Partial<Mark>,id:c.mark.id}});break}
      case 'keyframe.set': {const c=needed(),k=op.keyframe as TimelineClip['keys'][number];if(!k)throw Error('KEYFRAME_REQUIRED');p.timeline=replaceLinked(p.timeline,{...c,keys:[...c.keys.filter(v=>v.time!==k.time),k].sort((a,b)=>a.time-b.time)});break}
      default:throw Error('UNKNOWN_OPERATION: '+String(op.op))
    }
  }
  return validateEdits(p,base)
}
interface History {undo:{project:VideoProject;revision:number}[];redo:{project:VideoProject;revision:number}[]}
export class VideoCLI {
  constructor(private store:VideoStore,private bin:string,private exporter:VideoExporter){}
  async execute(r:CLIRequest):Promise<unknown> {
    if(r.command==='schema')return cliSchema
    if(r.command==='list')return this.store.list().map(p=>({id:p.id,title:p.title,revision:p.revision,width:p.width,height:p.height,duration:p.duration,status:p.status}))
    const p=this.store.get(r.projectId??'')
    if(p.status==='recording')throw Error('BUSY: recording in progress')
    if(r.command==='inspect')return {...p,timeline:migrateTimeline(p)}
    if(r.command==='frame'){
      if(!Number.isFinite(r.time)||r.time!<0||r.time!>=p.duration)throw Error('FRAME_TIME: source time must be within video')
      const target=this.output(r.output,'.png'),temp=target+'.'+uid()+'.png'
      try{await exec(path.join(this.bin,'ffmpeg.exe'),['-v','error','-ss',String(r.time!/1000),'-i',this.store.file(p.id,'screen.mp4'),'-frames:v','1',temp],{windowsHide:true,timeout:30000});fs.copyFileSync(temp,target,fs.constants.COPYFILE_EXCL)}finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}
      return {file:target,sourceTime:r.time,width:p.width,height:p.height}
    }
    if(r.revision!==p.revision)throw Error(`REVISION_CONFLICT: expected ${p.revision}, inspect again`)
    if(r.command==='export'){const dest=this.output(r.output,'.mp4');await this.exporter.export(p,dest,r.height??1080);return {file:dest,revision:p.revision,duration:timelineDuration(migrateTimeline(p))}}
    const file=path.join(this.store.directory(p.id),'cli-history.json');let history:History={undo:[],redo:[]};if(fs.existsSync(file)){history=JSON.parse(fs.readFileSync(file,'utf8'))}
    if(r.command==='apply'){
      const result=planEdits(p,r.operations??[]),summary={beforeRevision:p.revision,revision:result.revision,operations:r.operations?.length,duration:timelineDuration(result.timeline!),project:result}
      if(r.dryRun)return {...summary,dryRun:true}
      history.undo.push({project:p,revision:result.revision});history.undo=history.undo.slice(-50);history.redo=[];this.journal(file,history);const saved=this.store.save(p.id,result);return {...summary,project:saved,dryRun:false}
    }
    if(r.command==='undo'||r.command==='redo'){
      const source=r.command==='undo'?history.undo:history.redo,target=r.command==='undo'?history.redo:history.undo,entry=source.at(-1);if(!entry)throw Error('NO_HISTORY');if(entry.revision!==p.revision)throw Error('HISTORY_CONFLICT: project changed since CLI edit')
      const result=validateEdits({...entry.project,assets:p.assets},p);source.pop();if(source.length)source[source.length-1].revision=result.revision;target.push({project:p,revision:result.revision});this.journal(file,history);return this.store.save(p.id,result)
    }
    if(r.command==='import'){if(!r.file||!['video','audio'].includes(r.kind??''))throw Error('IMPORT_FILE_AND_KIND_REQUIRED');return importTimelineMedia(this.store,this.bin,p.id,r.file,r.kind!)}
    throw Error('UNKNOWN_COMMAND')
  }
  private output(value:string|undefined,ext:string){if(!value||!path.isAbsolute(value)||path.extname(value).toLowerCase()!==ext)throw Error('OUTPUT: absolute '+ext+' path required');if(fs.existsSync(value))throw Error('OUTPUT_EXISTS: choose another filename');if(!fs.statSync(path.dirname(value)).isDirectory())throw Error('OUTPUT_DIRECTORY');return value}
  private journal(file:string,value:History){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value),{flush:true});fs.renameSync(temp,file)}
}
