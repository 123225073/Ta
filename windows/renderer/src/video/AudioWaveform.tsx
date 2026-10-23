import {memo,useEffect,useMemo,useState} from 'react'
import type {TimelineClip} from '../../../electron/video/timeline'
import type {Waveform} from '../../../electron/video/waveform'
export const AudioWaveform=memo(function AudioWaveform({projectId,clip}:{projectId:string;clip:TimelineClip}) {
  const [data,setData]=useState<Waveform>(),[failed,setFailed]=useState(false)
  useEffect(()=>{let active=true;setData(undefined);setFailed(false);if(window.taVideo.waveform)void window.taVideo.waveform(projectId,clip.asset).then(v=>{if(active)setData(v)},()=>{if(active)setFailed(true)});return()=>{active=false}},[projectId,clip.asset])
  const shape=useMemo(()=>{if(!data)return;const a=Math.floor(clip.in/data.duration*data.peaks.length),b=Math.max(a+1,Math.ceil(clip.out/data.duration*data.peaks.length)),peaks=data.peaks.slice(a,b),max=Math.max(.02,...data.peaks);return{width:Math.max(1,peaks.length),path:peaks.map((p,i)=>`M${i} ${16-p/max*15}V${16+p/max*15}`).join('')}},[data,clip.in,clip.out])
  if(!shape)return <span className="waveform-status">{failed?'波形不可用':'读取波形…'}</span>
  return <svg className="audio-waveform" aria-label="音频波形" viewBox={`0 0 ${shape.width} 32`} preserveAspectRatio="none"><path d={shape.path} fill="none" stroke="currentColor" strokeWidth=".8"/></svg>
})
