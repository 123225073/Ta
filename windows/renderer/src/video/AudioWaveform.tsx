import {useEffect,useState} from 'react'
import type {TimelineClip} from '../../../electron/video/timeline'
import type {Waveform} from '../../../electron/video/waveform'
export function AudioWaveform({projectId,clip}:{projectId:string;clip:TimelineClip}) {
  const [data,setData]=useState<Waveform>(),[failed,setFailed]=useState(false)
  useEffect(()=>{let active=true;setData(undefined);setFailed(false);if(window.taVideo.waveform)void window.taVideo.waveform(projectId,clip.asset).then(v=>{if(active)setData(v)},()=>{if(active)setFailed(true)});return()=>{active=false}},[projectId,clip.asset])
  if(!data)return <span className="waveform-status">{failed?'波形不可用':'读取波形…'}</span>
  const a=Math.floor(clip.in/data.duration*data.peaks.length),b=Math.max(a+1,Math.ceil(clip.out/data.duration*data.peaks.length)),peaks=data.peaks.slice(a,b),max=Math.max(.02,...data.peaks)
  return <svg className="audio-waveform" aria-label="音频波形" viewBox={`0 0 ${peaks.length} 32`} preserveAspectRatio="none"><path d={peaks.map((p,i)=>`M${i} ${16-p/max*15}V${16+p/max*15}`).join('')} fill="none" stroke="currentColor" strokeWidth=".8"/></svg>
}
