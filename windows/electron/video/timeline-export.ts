import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import {clipDuration,clipEnd,keyAt,timelineDuration,type TimelineClip,type Timeline} from './timeline'
import {markSvg,type VideoProject} from './model'
export type RenderRun=(args:string[],progress?:(time:number)=>void)=>Promise<string>
function keyExpression(c:TimelineClip,field:'scale'|'cx'|'cy',offset=0){
  const keys=[...c.keys].sort((a,b)=>a.time-b.time);if(!keys.length)return String(field==='scale'?1:.5)
  let expression=String(keys.at(-1)![field]);for(let i=keys.length-2;i>=0;i--){const a=keys[i],b=keys[i+1],u=`clip((on/30-${(offset+a.time)/1000})/${(b.time-a.time)/1000},0,1)`,f=`(${u}*${u}*(3-2*${u}))`;expression=`if(lt(on/30,${(offset+b.time)/1000}),${a[field]}+(${b[field]-a[field]})*${f},${expression})`}
  return `if(lt(on/30,${(offset+keys[0].time)/1000}),${keys[0][field]},${expression})`
}
export function cameraExpressions(t:Timeline){const result={scale:'1',cx:'.5',cy:'.5'};for(const track of t.tracks.filter(t=>t.kind==='zoom'&&!t.muted))for(const c of track.clips.filter(c=>c.enabled))for(const field of ['scale','cx','cy'] as const)result[field]=`if(between(on/30,${c.start/1000},${(clipEnd(c)-.001)/1000}),${keyExpression(c,field,c.start)},${result[field]})`;return result}
const zoomFilter=(e:{scale:string;cx:string;cy:string},w:number,h:number)=>`zoompan=z='${e.scale}':x='max(0,min(iw-iw/zoom,iw*(${e.cx})-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*(${e.cy})-ih/zoom/2))':d=1:s=${w}x${h}:fps=30`
const tempo=(speed:number)=>speed<.5?`atempo=0.5,atempo=${speed/.5}`:speed>2?`atempo=2,atempo=${speed/2}`:`atempo=${speed}`
export async function renderTimeline(p:VideoProject,job:string,destination:string,height:number,asset:(file:string)=>string,run:RenderRun,canceled:()=>boolean,notify:(progress:number,message:string)=>void){
  const t=p.timeline!,duration=timelineDuration(t)/1000,factor=Math.min(1,height/p.crop.height),w=Math.max(2,Math.floor(p.crop.width*factor/2)*2),h=Math.max(2,Math.floor(p.crop.height*factor/2)*2)
  let encoder='';for(const name of ['h264_mf','h264_qsv','h264_nvenc','h264_amf']){try{await run(['-v','error','-f','lavfi','-i','color=s=320x180:r=30','-frames:v','1','-c:v',name,'-f','null','-']);encoder=name;break}catch{if(canceled())throw Error('已取消导出。')}}if(!encoder)throw Error('没有可用的 H.264 编码器。')
  const args=['-hide_banner','-v','warning','-y','-filter_complex_threads','1','-f','lavfi','-i',`color=c=black:s=${w}x${h}:r=30:d=${duration}`,'-f','lavfi','-i',`anullsrc=r=48000:cl=stereo:d=${duration}`],graph:string[]=[],audios=['1:a'];let input=2,layer='0:v',count=0
  for(const track of t.tracks){if(track.muted||track.kind==='zoom')continue;for(const c of track.clips){if(!c.enabled)continue;if(canceled())throw Error('已取消导出。');const n=input++,id=count++,len=clipDuration(c)/1000,end=clipEnd(c)/1000
    if(track.kind==='mark'){
      const png=path.join(job,`timeline-mark-${id}.png`),m=c.mark!
      await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}">${markSvg(m)}</svg>`)).extract({left:Math.floor(p.crop.x),top:Math.floor(p.crop.y),width:Math.floor(p.crop.width),height:Math.floor(p.crop.height)}).resize(w,h).png().toFile(png)
      args.push('-loop','1','-i',png)
    }else args.push('-ss',String(c.in/1000),'-t',String((c.out-c.in)/1000),'-i',asset(c.asset))
    const info=p.assets?.find(a=>a.file===c.asset)
    if(track.kind==='audio'||track.kind==='video'&&info?.audio){graph.push(`[${n}:a]atrim=duration=${(c.out-c.in)/1000},asetpts=PTS-STARTPTS,${tempo(c.speed)},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${c.volume},apad,atrim=duration=${len},adelay=${Math.round(c.start)}:all=1[a${id}]`);audios.push(`a${id}`)}
    if(track.kind!=='audio'){
      const cw=Math.max(2,Math.round(w*c.rect.width/2)*2),ch=Math.max(2,Math.round(h*c.rect.height/2)*2),crop=c.asset==='screen.mp4'?`crop=${p.crop.width}:${p.crop.height}:${p.crop.x}:${p.crop.y},`:''
      const timing=track.kind==='mark'?`trim=duration=${len},setpts=PTS-STARTPTS`:`trim=duration=${(c.out-c.in)/1000},setpts=(PTS-STARTPTS)/${c.speed}`
      const fit=track.kind==='mark'||c.asset==='screen.mp4'?`scale=${cw}:${ch}`:`scale=${cw}:${ch}:force_original_aspect_ratio=decrease,pad=${cw}:${ch}:(ow-iw)/2:(oh-ih)/2:color=black`
      graph.push(`[${n}:v]${timing},fps=30,${crop}${fit},setsar=1${c.keys.length?','+zoomFilter({scale:keyExpression(c,'scale'),cx:keyExpression(c,'cx'),cy:keyExpression(c,'cy')},cw,ch):''},setpts=PTS+${c.start/1000}/TB[v${id}]`)
      graph.push(`[${layer}][v${id}]overlay=x=${Math.round(c.rect.x*w)}:y=${Math.round(c.rect.y*h)}:enable='gte(t,${c.start/1000})*lt(t,${end})':eof_action=pass:repeatlast=0:format=auto[layer${id}]`);layer=`layer${id}`
    }
  }}
  graph.push(`[${layer}]${zoomFilter(cameraExpressions(t),w,h)},format=yuv420p[outv]`)
  graph.push(`${audios.map(a=>`[${a}]`).join('')}amix=inputs=${audios.length}:normalize=0:duration=longest,alimiter=limit=0.95:level=0[outa]`)
  const script=path.join(job,'timeline-filter.txt');fs.writeFileSync(script,graph.join(';'))
  await run([...args,'-filter_complex_script',script,'-map','[outv]','-map','[outa]','-c:v',encoder,'-b:v',String(Math.max(3000000,w*h*6)),'-g','30','-c:a','aac','-ar','48000','-ac','2','-t',String(duration),'-movflags','+faststart','-progress','pipe:1',destination],ms=>notify(Math.min(.99,ms/(duration*1000)),'正在导出多轨道视频'))
}
