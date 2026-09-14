import fs from 'node:fs'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import type {VideoStore} from './store'
import type {EditAsset} from './timeline'
const exec=promisify(execFile)
export async function importTimelineMedia(store:VideoStore,bin:string,id:string,input:string,kind:'video'|'audio'){
  const project=store.get(id);if(project.status==='recording')throw Error('录制完成后才能添加素材。')
  if(!['audio','video'].includes(kind))throw Error('素材类型无效。')
  const probe=async(file:string)=>JSON.parse((await exec(path.join(bin,'ffprobe.exe'),['-v','error','-show_streams','-show_format','-of','json',file],{windowsHide:true,timeout:15000})).stdout)
  const raw=await probe(input),v=raw.streams.find((s:any)=>s.codec_type==='video'),a=raw.streams.some((s:any)=>s.codec_type==='audio'),ms=Number(raw.format.duration)*1000
  if(!Number.isFinite(ms)||ms<100||ms>7200000||kind==='video'&&(!v||v.width*v.height>40_000_000)||kind==='audio'&&!a)throw Error('请选择有效的音视频素材，时长不超过两小时。')
  const file='edit-'+randomBytes(8).toString('hex')+(kind==='video'?'.mp4':'.wav'),dest=path.join(store.directory(id),file)
  const run=(args:string[],timeout=1800000)=>exec(path.join(bin,'ffmpeg.exe'),['-hide_banner','-v','error','-nostdin',...args],{windowsHide:true,timeout,maxBuffer:1024*1024})
  try{
    if(kind==='audio')await run(['-i',input,'-vn','-ac','2','-ar','48000',dest])
    else{let encoder='';for(const name of ['h264_mf','h264_qsv','h264_nvenc','h264_amf']){try{await run(['-f','lavfi','-i','color=s=320x180:r=30','-frames:v','1','-c:v',name,'-f','null','-'],15000);encoder=name;break}catch{}}
      if(!encoder)throw Error('本机没有可用的 H.264 编码器。')
      await run(['-i',input,'-map','0:v:0','-map','0:a:0?','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1','-c:v',encoder,'-b:v',String(Math.max(3000000,v.width*v.height*6)),'-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart',dest])
    }
    const checked=await probe(dest),video=checked.streams.find((s:any)=>s.codec_type==='video')
    const asset:EditAsset={file,name:path.basename(input).slice(0,150),kind,duration:Math.round(Number(checked.format.duration)*1000),width:video?.width??0,height:video?.height??0,audio:checked.streams.some((s:any)=>s.codec_type==='audio')}
    if(!Number.isFinite(asset.duration)||asset.duration<100)throw Error('导入结果无法读取。')
    const next={...store.get(id),assets:[...(store.get(id).assets??[]),asset]};store.write(next);return {project:next,asset}
  }catch(e){if(fs.existsSync(dest))fs.unlinkSync(dest);throw Error(e instanceof Error?e.message.slice(0,600):'素材导入失败。')}
}
