import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {randomUUID} from 'node:crypto'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {VideoStore} from './store'
import type {VideoProject} from './model'
const exec=promisify(execFile)

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
  private cache=new Map<string,Promise<string>>()
  private cacheDir?:string
  private cacheClearing?:Promise<void>
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
  async close(){this.closing=true;if(this.timer)clearInterval(this.timer);this.queued.clear();await this.automatic;await Promise.allSettled([...this.jobs.values()]);await this.clearCache()}
  clearCache(){return this.cacheClearing??=this.disposeCache().finally(()=>{this.cacheClearing=undefined})}
  private async disposeCache(){await Promise.allSettled([...this.cache.values()]);this.cache.clear();if(this.cacheDir){await fs.promises.rm(this.cacheDir,{recursive:true,force:true});this.cacheDir=undefined}}
  async resolve(id:string,name:string){
    await this.cacheClearing;
    const p=this.store.get(id);if(!['mic.wav','system.wav'].includes(name)||p.sourceTracks===undefined)return this.store.media(id,name)
    const input=this.store.input(id,name);if(path.extname(input.file)==='.wav'||p.kind==='audio'&&!p.audioArchive)return input.file
    const key=id+'/'+name;let job=this.cache.get(key);if(!job){this.cacheDir??=fs.mkdtempSync(path.join(os.tmpdir(),'ta-media-'));const file=path.join(this.cacheDir,id+'-'+name.replace('.wav','.m4a'));job=exec(path.join(this.bin,'ffmpeg.exe'),['-v','error','-i',input.file,'-map','0:'+input.stream,'-c:a','copy','-movflags','+faststart',file],{windowsHide:true,timeout:180000}).then(()=>file).catch(e=>{this.cache.delete(key);throw e});this.cache.set(key,job)}return job
  }
  private serial<T>(id:string,fn:()=>Promise<T>):Promise<T>{
    const job=(this.jobs.get(id)??Promise.resolve()).catch(()=>{}).then(fn)
    this.jobs.set(id,job);void job.finally(()=>{if(this.jobs.get(id)===job)this.jobs.delete(id)}).catch(()=>{});return job
  }
  state(id:string){const p=this.store.get(id),file=p.sourceFile?this.store.media(id,'source'):undefined;return{ready:!!file&&fs.existsSync(file),busy:this.busy(id),queued:this.queued.has(id),error:this.errors.get(id),progress:this.progress.get(id)??0,file,tracks:p.sourceTracks,retainOriginals:p.retainOriginals===true}}
  ensure(id:string){this.queued.delete(id);this.errors.delete(id);return this.serial(id,()=>this.prepare(id)).catch(e=>{this.errors.set(id,e instanceof Error?e.message:String(e));throw e})}
  compact(id:string){return this.serial(id,()=>this.prepare(id,true))}
  private async probe(file:string){return JSON.parse((await exec(path.join(this.bin,'ffprobe.exe'),['-v','error','-show_streams','-show_format','-of','json',file],{windowsHide:true,timeout:30000})).stdout)}
  private async videoHash(file:string){return(await exec(path.join(this.bin,'ffmpeg.exe'),['-v','error','-i',file,'-map','0:v:0','-c:v','copy','-f','streamhash','-hash','sha256','pipe:1'],{windowsHide:true,timeout:600000})).stdout.trim()}
  private async validate(p:VideoProject,file:string,tracks:NonNullable<VideoProject['sourceTracks']>,archive?:string){
    const info=await this.probe(file),audios=info.streams.filter((s:any)=>s.codec_type==='audio');
    if(!Number.isFinite(Number(info.format.duration))||Math.abs(Number(info.format.duration)*1000-p.duration)>1500)throw Error('成品时长核验失败，底稿已保留。')
    if(p.kind!=='audio'&&info.streams.filter((s:any)=>s.codec_type==='video').length!==1)throw Error('视频轨道核验失败。')
    if(p.kind!=='audio'&&(p.hasMic||p.hasSystem)&&!audios.some((s:any)=>s.disposition?.default===1))throw Error('默认声音核验失败。')
    const trackInfo=archive?await this.probe(archive):info;
    for(const [key,on] of [['mic',p.hasMic],['system',p.hasSystem]] as const)if(on){const s=trackInfo.streams.find((s:any)=>s.index===tracks[key]);if(s?.codec_type!=='audio')throw Error('独立音轨核验失败，底稿已保留。')}
    for(const at of [...new Set([0,Math.max(0,p.duration/2000-1),Math.max(0,p.duration/1000-2)])])await exec(path.join(this.bin,'ffmpeg.exe'),['-v','error','-xerror','-ss',String(at),'-i',file,'-t','1','-map','0','-f','null','-'],{windowsHide:true,timeout:30000})
  }
  async cleanupPlan(id:string,legacy=false){
    const p=this.store.get(id);if(p.status==='recording'||p.sourceTracks===undefined)throw Error('请先生成并核验包含独立音轨的成品。');
    const source=this.store.media(id,'source'),archive=p.audioArchive?path.join(this.store.directory(id),'原片',p.audioArchive):undefined;await this.validate(p,source,p.sourceTracks,archive);
    const dir=path.resolve(this.store.directory(id));if(path.basename(dir)!==id||fs.lstatSync(dir).isSymbolicLink()||fs.realpathSync(dir).toLowerCase()!==dir.toLowerCase())throw Error('项目目录校验失败。')
    const candidates=['screen.mp4','mic.wav','system.wav'].map(n=>this.store.file(id,n));
    if(legacy){const exports=path.join(dir,'exports');if(fs.existsSync(exports))for(const e of fs.readdirSync(exports,{withFileTypes:true}))if(e.isDirectory()&&/^source-\d{13}$/.test(e.name))candidates.push(path.join(exports,e.name,'source.mp4'))}
    const files=candidates.filter(f=>fs.existsSync(f));for(const f of files)if(fs.lstatSync(f).isSymbolicLink()||fs.realpathSync(f).toLowerCase()!==path.resolve(f).toLowerCase())throw Error('底稿路径校验失败。')
    if(p.kind!=='audio'){const expected=await this.videoHash(source);for(const f of files.filter(f=>f.endsWith('.mp4')))if(await this.videoHash(f)!==expected)throw Error('视频内容不一致，未清理底稿或导出副本。')}
    return files.map(file=>({file,bytes:fs.statSync(file).size}))
  }
  async cleanup(id:string,legacy=false){const files=await this.cleanupPlan(id,legacy);for(const f of files)await fs.promises.unlink(f.file);return files}
  private async prepare(id:string,upgrade=false){
    const p=this.store.get(id);if(p.status==='recording')throw Error('请等待录制结束。')
    const dir=path.join(this.store.directory(id),'原片');fs.mkdirSync(dir,{recursive:true})
    const target=path.join(dir,mediaName(p.title,p.kind==='audio'))
    if(p.sourceFile&&fs.existsSync(this.store.media(id,'source'))&&(!upgrade||p.sourceTracks!==undefined)){const old=this.store.media(id,'source');if(old!==target){if(fs.existsSync(target))throw Error('此名称的文件已存在，请换一个名称。');await fs.promises.rename(old,target);this.store.write({...this.store.get(id),sourceFile:path.basename(target)})}return target}
    const temp=path.join(dir,`preparing-${Date.now()}.${p.kind==='audio'?'mp3':'mp4'}`)
    const args=['-v','error'],audio:string[]=[],inputs:{key:'mic'|'system';index:number}[]=[],tracks:NonNullable<VideoProject['sourceTracks']>={};let input=0
    if(p.kind!=='audio'){args.push('-i',this.store.file(id,'screen.mp4'));input++}
    for(const [name,on,key] of [['system.wav',p.hasSystem,'system'],['mic.wav',p.hasMic,'mic']] as const)if(on){args.push('-i',this.store.file(id,name));inputs.push({key,index:input});audio.push(`[${input++}:a]`)}
    if(p.kind==='audio'&&!audio.length)throw Error('没有可用录音音轨。')
    if(p.kind!=='audio')args.push('-map','0:v:0','-c:v','copy','-movflags','+faststart')
    if(audio.length)args.push('-filter_complex',`${audio.join('')}amix=inputs=${audio.length}:normalize=0,apad[a]`,'-map','[a]','-c:a',p.kind==='audio'?'libmp3lame':'aac','-b:a','192k')
    else args.push('-map','0:a?','-c:a','copy')
    if(p.kind!=='audio'&&audio.length){args.push('-metadata:s:a:0','title=混合声音','-disposition:a:0','default');for(const [i,a] of inputs.entries()){tracks[a.key]=audio.length===1?1:i+2;if(audio.length>1)args.push('-map',`${a.index}:a:0`,'-b:a:'+(i+1),'128k','-metadata:s:a:'+(i+1),'title='+(a.key==='mic'?'麦克风':'电脑声音'),'-disposition:a:'+(i+1),'0')}}
    if(p.kind==='audio'&&audio.length===1)tracks[inputs[0].key]=0
    const archive=p.kind==='audio'&&audio.length>1?'独立音轨.m4a':undefined,archiveTemp=archive?path.join(dir,`preparing-tracks-${Date.now()}.m4a`):undefined
    this.progress.set(id,0)
    try{
      await new Promise<void>((resolve,reject)=>{const child=spawn(path.join(this.bin,'ffmpeg.exe'),[...args,'-t',String(p.duration/1000),'-progress','pipe:1',temp],{windowsHide:true});let log='',buffer='';child.stderr.on('data',d=>{log=(log+d).slice(-2000)});child.stdout.on('data',d=>{buffer+=d;const lines=buffer.split('\n');buffer=lines.pop()??'';for(const line of lines)if(line.startsWith('out_time_us='))this.progress.set(id,Math.min(.99,Number(line.split('=')[1])/1000/p.duration))});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('原片保存失败，原始录制仍保留。'+log)))})
      if(archiveTemp){const a=['-v','error',...inputs.flatMap(i=>['-i',this.store.file(id,i.key+'.wav')])];for(const [i,item] of inputs.entries()){a.push('-map',`${i}:a:0`);tracks[item.key]=i}await exec(path.join(this.bin,'ffmpeg.exe'),[...a,'-c:a','aac','-b:a','128k','-t',String(p.duration/1000),archiveTemp],{windowsHide:true,timeout:600000})}
      await this.validate(p,temp,tracks,archiveTemp)
      if(upgrade&&p.sourceFile===path.basename(target)){await fs.promises.rename(temp,target)}else await fs.promises.link(temp,target).catch(async e=>{if(!['ENOTSUP','EPERM','EXDEV','ENOSYS'].includes(e.code))throw e;await fs.promises.copyFile(temp,target,fs.constants.COPYFILE_EXCL)})
      if(archiveTemp)await fs.promises.rename(archiveTemp,path.join(dir,archive!))
      const next={...this.store.get(id),sourceFile:path.basename(target),sourceTracks:tracks,audioArchive:archive};try{this.store.write(next);this.store.write(next)}catch(e){if(!upgrade){await fs.promises.unlink(target).catch(()=>{});if(archive)await fs.promises.unlink(path.join(dir,archive)).catch(()=>{})}throw e}
      if(p.retainOriginals===false)await this.cleanup(id)
      return target
    }finally{this.progress.delete(id);await fs.promises.unlink(temp).catch(()=>{});if(archiveTemp)await fs.promises.unlink(archiveTemp).catch(()=>{})}
  }
  copy(id:string,destination:string){return this.serial(id,async()=>{
    const source=await this.prepare(id),p=this.store.get(id);
    if(p.kind==='audio'||new Set(Object.values(p.sourceTracks??{})).size<2){await fs.promises.copyFile(source,destination,fs.constants.COPYFILE_EXCL);return destination}
    const temp=path.join(path.dirname(destination),'.ta-share-'+randomUUID()+'.mp4');try{await exec(path.join(this.bin,'ffmpeg.exe'),['-v','error','-nostdin','-n','-i',source,'-map','0:v:0','-map','0:a:0','-c','copy','-movflags','+faststart',temp],{windowsHide:true,timeout:600000});await fs.promises.copyFile(temp,destination,fs.constants.COPYFILE_EXCL);return destination}finally{await fs.promises.unlink(temp).catch(()=>{})}
  })}
  rename(id:string,title:unknown){return this.serial(id,async()=>{
    if(typeof title!=='string'||!title.trim()||title.trim().length>100)throw Error('请输入 1–100 字的名称。')
    const p=this.store.get(id);if(p.status==='recording')throw Error('录制完成后才能重命名。')
    const next={...p,title:title.trim(),revision:p.revision+1}
    if(p.sourceFile&&fs.existsSync(this.store.media(id,'source'))){const old=this.store.media(id,'source'),name=mediaName(next.title,p.kind==='audio'),target=path.join(path.dirname(old),name);if(old!==target){if(fs.existsSync(target))throw Error('此名称的文件已存在，请换一个名称。');await fs.promises.rename(old,target);try{this.store.write({...next,sourceFile:name})}catch(e){await fs.promises.rename(target,old);throw e}return this.store.get(id)}}
    this.store.write(next);return next
  })}
}
