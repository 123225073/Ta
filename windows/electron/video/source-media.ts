import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {VideoStore} from './store'

export function mediaName(title:string, audio=false){
  let name=title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').replace(/\.(mp4|mp3)$/i,'').slice(0,100)
  if(!name)name=audio?'录音':'录屏'
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name
  return name+(audio?'.mp3':'.mp4')
}
/** One reusable, unedited deliverable per project. Independent of edit exports. */
export class SourceMedia {
  private jobs=new Map<string,Promise<unknown>>()
  private progress=new Map<string,number>()
  private queued=new Set<string>()
  private errors=new Map<string,string>()
  private automatic?:Promise<void>
  private timer?:ReturnType<typeof setInterval>
  private canPrepare=()=>true
  private closing=false
  constructor(private bin:string,private store:VideoStore){}
  busy(id:string){return this.jobs.has(id)||this.queued.has(id)}
  startAutomatic(canPrepare=()=>true){
    this.canPrepare=canPrepare;this.enqueueMissing()
    this.timer??=setInterval(()=>this.pump(),1000);this.timer.unref()
  }
  enqueueMissing(){
    if(this.closing)return
    for(const p of this.store.list())if(p.status!=='recording'&&!this.errors.has(p.id)&&!this.state(p.id).ready&&!this.jobs.has(p.id))this.queued.add(p.id)
    this.pump()
  }
  private pump(){
    if(this.closing||this.automatic||!this.canPrepare())return
    const id=this.queued.values().next().value as string|undefined;if(!id)return
    this.queued.delete(id)
    this.automatic=this.ensure(id).then(()=>{},()=>{}).finally(()=>{this.automatic=undefined;this.pump()})
  }
  async close(){this.closing=true;if(this.timer)clearInterval(this.timer);this.queued.clear();await this.automatic;await Promise.allSettled([...this.jobs.values()])}
  private serial<T>(id:string,fn:()=>Promise<T>):Promise<T>{
    const job=(this.jobs.get(id)??Promise.resolve()).catch(()=>{}).then(fn)
    this.jobs.set(id,job);void job.finally(()=>{if(this.jobs.get(id)===job)this.jobs.delete(id)}).catch(()=>{});return job
  }
  state(id:string){const p=this.store.get(id),file=p.sourceFile?this.store.media(id,'source'):undefined;return{ready:!!file&&fs.existsSync(file),busy:this.busy(id),queued:this.queued.has(id),error:this.errors.get(id),progress:this.progress.get(id)??0,file}}
  ensure(id:string){this.queued.delete(id);this.errors.delete(id);return this.serial(id,()=>this.prepare(id)).catch(e=>{this.errors.set(id,e instanceof Error?e.message:String(e));throw e})}
  private async prepare(id:string){
    const p=this.store.get(id);if(p.status==='recording')throw Error('请等待录制结束。')
    const dir=path.join(this.store.directory(id),'原片');fs.mkdirSync(dir,{recursive:true})
    const target=path.join(dir,mediaName(p.title,p.kind==='audio'))
    if(p.sourceFile&&fs.existsSync(this.store.media(id,'source'))){const old=this.store.media(id,'source');if(old!==target){if(fs.existsSync(target))throw Error('此名称的文件已存在，请换一个名称。');await fs.promises.rename(old,target);this.store.write({...this.store.get(id),sourceFile:path.basename(target)})}return target}
    const temp=path.join(dir,`preparing-${Date.now()}.${p.kind==='audio'?'mp3':'mp4'}`)
    const args=['-v','error'],audio:string[]=[];let input=0
    if(p.kind!=='audio'){args.push('-i',this.store.file(id,'screen.mp4'));input++}
    for(const [name,on] of [['system.wav',p.hasSystem],['mic.wav',p.hasMic]] as const)if(on){args.push('-i',this.store.file(id,name));audio.push(`[${input++}:a]`)}
    if(p.kind==='audio'&&!audio.length)throw Error('没有可用录音音轨。')
    if(audio.length)args.push('-filter_complex',`${audio.join('')}amix=inputs=${audio.length}:normalize=0,apad[a]`,'-map','[a]','-c:a',p.kind==='audio'?'libmp3lame':'aac','-b:a','192k')
    else args.push('-map','0:a?','-c:a','copy')
    if(p.kind!=='audio')args.push('-map','0:v:0','-c:v','copy','-movflags','+faststart')
    this.progress.set(id,0)
    try{
      await new Promise<void>((resolve,reject)=>{const child=spawn(path.join(this.bin,'ffmpeg.exe'),[...args,'-t',String(p.duration/1000),'-progress','pipe:1',temp],{windowsHide:true});let log='',buffer='';child.stderr.on('data',d=>{log=(log+d).slice(-2000)});child.stdout.on('data',d=>{buffer+=d;const lines=buffer.split('\n');buffer=lines.pop()??'';for(const line of lines)if(line.startsWith('out_time_us='))this.progress.set(id,Math.min(.99,Number(line.split('=')[1])/1000/p.duration))});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('原片保存失败，原始录制仍保留。'+log)))})
      // Never replace an unrelated file. Link publishes only a complete file.
      await fs.promises.link(temp,target).catch(async e=>{if(!['ENOTSUP','EPERM','EXDEV','ENOSYS'].includes(e.code))throw e;await fs.promises.copyFile(temp,target,fs.constants.COPYFILE_EXCL)})
      try{this.store.write({...this.store.get(id),sourceFile:path.basename(target)})}catch(e){await fs.promises.unlink(target).catch(()=>{});throw e}
      return target
    }finally{this.progress.delete(id);await fs.promises.unlink(temp).catch(()=>{})}
  }
  copy(id:string,destination:string){return this.serial(id,async()=>{const source=await this.prepare(id);await fs.promises.copyFile(source,destination,fs.constants.COPYFILE_EXCL);return destination})}
  rename(id:string,title:unknown){return this.serial(id,async()=>{
    if(typeof title!=='string'||!title.trim()||title.trim().length>100)throw Error('请输入 1–100 字的名称。')
    const p=this.store.get(id);if(p.status==='recording')throw Error('录制完成后才能重命名。')
    const next={...p,title:title.trim(),revision:p.revision+1}
    if(p.sourceFile&&fs.existsSync(this.store.media(id,'source'))){const old=this.store.media(id,'source'),name=mediaName(next.title,p.kind==='audio'),target=path.join(path.dirname(old),name);if(old!==target){if(fs.existsSync(target))throw Error('此名称的文件已存在，请换一个名称。');await fs.promises.rename(old,target);try{this.store.write({...next,sourceFile:name})}catch(e){await fs.promises.rename(target,old);throw e}return this.store.get(id)}}
    this.store.write(next);return next
  })}
}
