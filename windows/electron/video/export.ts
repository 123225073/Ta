import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import sharp from 'sharp'
import { keepSegments,viewportAt,markSvg,type VideoProject,type ExportProgress } from './model'
import { VideoStore } from './store'
export class VideoExporter {
  private child?:ChildProcess; private canceled=false; busy=false
  constructor(private bin:string,private store:VideoStore,private notify:(p:ExportProgress)=>void){}
  cancel(){this.canceled=true;this.child?.kill()}
  private run(args:string[],progress?:(time:number)=>void):Promise<string>{
    return new Promise((resolve,reject)=>{
      const child=spawn(path.join(this.bin,'ffmpeg.exe'),args,{windowsHide:true});this.child=child
      let log='',line='';child.stdout?.on('data',d=>{line+=d;const lines=line.split('\n');line=lines.pop()??'';for(const l of lines)if(l.startsWith('out_time_us='))progress?.(Number(l.split('=')[1])/1000)})
      child.stderr?.on('data',d=>{log=(log+d).slice(-6000)})
      child.on('error',reject);child.on('close',code=>{if(this.child===child)this.child=undefined;code===0&&!this.canceled?resolve(log):reject(Error(this.canceled?'已取消导出。':log.slice(-1800)||'编码失败。'))})
    })
  }
  async export(p:VideoProject,destination:string,maxHeight:number){
    if(this.busy)throw Error('已有视频正在导出。');this.busy=true;this.canceled=false
    const job=path.join(this.store.directory(p.id),'exports',Date.now().toString());fs.mkdirSync(job,{recursive:true})
    const target=path.join(job,'finished.mp4'),full=path.join(this.store.directory(p.id),'screen.mp4')
    const scale=Math.min(1,maxHeight/p.crop.height), w=Math.max(2,Math.floor(p.crop.width*scale/2)*2),h=Math.max(2,Math.floor(p.crop.height*scale/2)*2)
    try{
      this.notify({id:p.id,phase:'rendering',progress:0,message:'正在准备编码器'})
      let encoder=''
      for(const name of ['h264_mf','h264_qsv','h264_nvenc','h264_amf']){
        if(this.canceled)throw Error('已取消导出。')
        try{await this.run(['-v','error','-f','lavfi','-i','color=s=320x180:r=30','-frames:v','3','-c:v',name,'-pix_fmt','yuv420p','-f','null','-']);encoder=name;break}catch{if(this.canceled)throw Error('已取消导出。')}
      }
      if(!encoder)throw Error('本机没有可用的 H.264 编码器，原录像和编辑项目已保存。')
      // Split at effect boundaries: every rendered piece uses exactly the same
      // source-time viewport as the preview. No target recognition is involved.
      const frame=(t:number)=>Math.round(t*30/1000), ms=(f:number)=>f*1000/30
      const kept=keepSegments(frame(p.duration),p.cuts.map(s=>({start:frame(s.start),end:frame(s.end)}))).map(s=>({start:ms(s.start),end:ms(s.end)}))
      const boundaries=[...new Set([...p.zooms.flatMap(z=>[z.start,z.end]),...p.marks.filter(m=>m.enabled).flatMap(m=>[m.start,m.end,m.points?.at(-1)?.t??m.start])].map(t=>ms(frame(t))))]
      const segments=kept.flatMap(s=>{const edges=[s.start,...boundaries.filter(t=>t>s.start&&t<s.end),s.end].sort((a,b)=>a-b);return edges.slice(1).map((end,i)=>({start:edges[i],end})).filter(s=>frame(s.end)>frame(s.start))})
      const total=segments.reduce((n,s)=>n+s.end-s.start,0);let done=0;const parts:string[]=[]
      for(const [index,s] of segments.entries()){
        if(this.canceled)throw Error('已取消导出。')
        const center=(s.start+s.end)/2, v=viewportAt(p,center), marks=p.marks.filter(m=>m.enabled&&m.start<=center&&m.end>center)
        const overlay=path.join(job,`mark-${index}.png`)
        const animated=marks.some(m=>m.points?.some(pt=>pt.t!==undefined&&pt.t>s.start&&pt.t<s.end))
        const render=(file:string,t:number)=>sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}">${marks.map(m=>markSvg(m,t)).join('')}</svg>`)).png().toFile(file)
        if(marks.length){if(animated){for(let f=0;f<frame(s.end)-frame(s.start);f++){if(this.canceled)throw Error('已取消导出。');await render(path.join(job,`mark-${index}-${String(f).padStart(6,'0')}.png`),s.start+ms(f))}}else await render(overlay,center)}
        const args=['-hide_banner','-v','warning','-y','-ss',(s.start/1000).toFixed(6),'-i',full]
        const filters:string[]=[]
        let video='0:v'
        if(marks.length){args.push(...(animated?['-framerate','30','-i',path.join(job,`mark-${index}-%06d.png`)]:['-loop','1','-i',overlay]));filters.push(`[0:v]setpts=PTS-STARTPTS[base];[base][1:v]overlay=0:0:format=auto[marked]`);video='marked'}
        filters.push(`[${video}]crop=${Math.max(2,Math.floor(v.width/2)*2)}:${Math.max(2,Math.floor(v.height/2)*2)}:${Math.floor(v.x/2)*2}:${Math.floor(v.y/2)*2},scale=${w}:${h}:flags=lanczos,setsar=1,fps=30,format=yuv420p[outv]`)
        const part=path.join(job,`part-${index}.mp4`);parts.push(part)
        args.push('-filter_complex',filters.join(';'),'-map','[outv]','-an','-frames:v',String(frame(s.end)-frame(s.start)),'-c:v',encoder,'-b:v',String(Math.max(3000000,w*h*6)),'-g','30','-movflags','+faststart','-progress','pipe:1',part)
        await this.run(args,t=>this.notify({id:p.id,phase:'rendering',progress:Math.min(.97,(done+t)/total*.97),message:`正在导出 ${index+1}/${segments.length}`}));done+=s.end-s.start
      }
      fs.writeFileSync(path.join(job,'concat.txt'),parts.map(f=>`file '${path.basename(f)}'`).join('\n'))
      // Encode AAC once across the entire edited timeline. Encoding audio per
      // effect slice would accumulate encoder padding and cause sync drift.
      const mux=['-v','error','-f','concat','-safe','1','-i',path.join(job,'concat.txt')],af:string[]=[],audioNames:string[]=[]
      let input=1
      for(const [name,enabled,volume] of [['system.wav',p.hasSystem,p.systemVolume],['mic.wav',p.hasMic,p.micVolume]] as const){if(enabled){mux.push('-i',this.store.file(p.id,name));af.push(`[${input++}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,volume=${volume},apad[a${audioNames.length}]`);audioNames.push(`[a${audioNames.length}]`)}}
      if(!audioNames.length){mux.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');af.push(`[${input}:a]anull[a0]`);audioNames.push('[a0]')}
      const mute=p.mutes.length?`,volume=0:enable='${p.mutes.map(s=>`between(t,${s.start/1000},${s.end/1000})`).join('+')}'`:''
      af.push(`${audioNames.join('')}amix=inputs=${audioNames.length}:normalize=0${mute},asplit=${kept.length}${kept.map((_,i)=>`[split${i}]`).join('')}`)
      kept.forEach((s,i)=>af.push(`[split${i}]atrim=start=${s.start/1000}:end=${s.end/1000},asetpts=PTS-STARTPTS[clip${i}]`))
      af.push(`${kept.map((_,i)=>`[clip${i}]`).join('')}concat=n=${kept.length}:v=0:a=1[outa]`)
      await this.run([...mux,'-filter_complex',af.join(';'),'-map','0:v','-map','[outa]','-c:v','copy','-c:a','aac','-ar','48000','-ac','2','-b:a','192k','-t',String(total/1000),'-movflags','+faststart',target])
      if(this.canceled)throw Error('已取消导出。')
      // Exclusive copy prevents a race from overwriting an existing user file.
      fs.copyFileSync(target,destination,fs.constants.COPYFILE_EXCL)
      const current=this.store.get(p.id);current.exports.push({name:destination,createdAt:new Date().toISOString()});this.store.write(current)
      this.notify({id:p.id,phase:'done',progress:1,message:'视频已导出'})
      return destination
    }catch(e){this.notify({id:p.id,phase:this.canceled?'canceled':'error',progress:0,message:e instanceof Error?e.message:String(e)});throw e}finally{
      // Only files generated by this export job; never source media or outputs
      // chosen by the user. Avoid accumulating full duplicate videos/PNG frames.
      for(const name of fs.readdirSync(job)){if(/^(mark-\d+(?:-\d+)?\.png|part-\d+\.mp4|concat\.txt|finished\.mp4)$/.test(name)){try{fs.unlinkSync(path.join(job,name))}catch{}}}
      try{fs.rmdirSync(job)}catch{}this.busy=false
    }
  }
}
