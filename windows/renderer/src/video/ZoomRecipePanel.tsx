import {useEffect,useRef,useState} from 'react'
import {clipDuration,clipEnd,type TimelineClip} from '../../../electron/video/timeline'
import {configureZoom,type ZoomRecipe} from '../../../electron/video/edit-actions'

export function ZoomRecipePanel({clip,onApply,onError,onRegion}:{clip:TimelineClip;onApply:(c:TimelineClip)=>void;onError:(s:string)=>void;onRegion:()=>void}) {
  const read=():ZoomRecipe=>{const peak=clip.keys.reduce((a,b)=>b.scale>a.scale?b:a,{time:0,scale:1,cx:.5,cy:.5}),matches=clip.keys.filter(k=>k.scale===peak.scale);return {start:clip.start,end:clipEnd(clip),scale:peak.scale,cx:peak.cx,cy:peak.cy,enter:matches[0]?.time??350,exit:Math.max(0,clipDuration(clip)-(matches.at(-1)?.time??clipDuration(clip)-350)),ease:clip.keys[0]?.ease??'smooth'}}
  const [draft,setDraft]=useState(read),[changed,setChanged]=useState(false)
  useEffect(()=>{setDraft(read());setChanged(false)},[clip.id,clip.start,clip.out,JSON.stringify(clip.keys)])
  const field=(key:keyof Omit<ZoomRecipe,'ease'>,label:string,factor=1000)=><label>{label}<ZoomNumber label={'放大'+label} value={draft[key]/factor} onCommit={n=>{setDraft(v=>({...v,[key]:n*factor}));setChanged(true)}}/></label>
  return <section className="zoom-recipe"><h3>局部放大</h3><p>先框选重点，再设置出现时段。进入后保持放大，结束前回到全景。</p><button onClick={onRegion}>在画面上重新框选重点</button><div className="zoom-fields">{field('start','开始秒数')}{field('end','结束秒数')}{field('scale','倍率',1)}{field('enter','进入秒数')}{field('exit','退出秒数')}<label>过渡<select aria-label="放大过渡" value={draft.ease} onChange={e=>{setDraft({...draft,ease:e.target.value as ZoomRecipe['ease']});setChanged(true)}}><option value="smooth">平滑</option><option value="linear">匀速</option><option value="hold">直接切换</option></select></label></div><div className="zoom-ramp" aria-hidden="true">全景 ↗ 放大保持 ↘ 全景</div><button className={changed?'primary':''} onClick={()=>{try{onApply(configureZoom(clip,draft));setChanged(false)}catch(e){onError((e as Error).message)}}}>应用放大设置</button></section>
}

function ZoomNumber({label,value,onCommit}:{label:string;value:number;onCommit:(n:number)=>void}){
  const [text,setText]=useState<string|null>(null),pending=useRef<string|null>(null)
  const commit=()=>{const raw=pending.current;pending.current=null;if(raw!==null&&raw.trim()&&Number.isFinite(Number(raw)))onCommit(Number(raw));setText(null)}
  return <input aria-label={label} type="number" step={.1} value={text??Number(value.toFixed(3))} onChange={e=>{pending.current=e.target.value;setText(e.target.value)}} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){pending.current=null;setText(null);e.currentTarget.blur()}}}/>
}
