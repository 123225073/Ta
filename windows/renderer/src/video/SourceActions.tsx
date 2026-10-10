import {useEffect,useState} from 'react'
import {media,type VideoProject} from './bridge'
const message=(e:unknown)=>String(e instanceof Error?e.message:e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'')
export function SourceActions({id,onError,onRenamed}:{id:string;onError:(message:string)=>void;onRenamed?:(p:VideoProject)=>void}){
  const [busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[editing,setEditing]=useState(false),[name,setName]=useState(''),[p,setProject]=useState<VideoProject>()
  const [source,setSource]=useState<{ready:boolean;busy:boolean;queued:boolean;error?:string;progress:number;file?:string;tracks?:{mic?:number;system?:number};retainOriginals?:boolean}>()
  useEffect(()=>{let live=true;void window.taVideo.get(id).then(p=>{if(live){setProject(p);setName(p.title)}}).catch(e=>onError(message(e)));const refresh=()=>void window.taVideo.sourceState(id).then(s=>{if(live)setSource(s)}).catch(()=>{});refresh();const timer=setInterval(refresh,1000);return()=>{live=false;clearInterval(timer)}},[id])
  const act=(fn:()=>Promise<unknown>)=>{setBusy(true);void fn().catch(e=>onError(message(e))).finally(()=>setBusy(false))}
  const rename=()=>act(async()=>{const next=await window.taVideo.rename(id,name);setProject(next);setEditing(false);onRenamed?.(next);setSource(await window.taVideo.sourceState(id))})
  return <div className="video-source-actions">
    {p?.kind==='audio'&&source?.ready&&<audio key={p.revision} controls preload="metadata" src={media(id,'source')}/>}
    <button disabled={busy} onClick={()=>act(()=>window.taVideo.folder(id))}>打开目录</button>
    <button disabled={busy} onClick={()=>{setSaved(false);act(async()=>{const file=await window.taVideo.saveSource(id);setSaved(!!file)})}}>{busy?'处理中…':p?.kind==='audio'?'另存 MP3':'另存视频'}</button>
    <button disabled={busy||!p} onClick={()=>{setName(p?.title??'');setEditing(true)}}>重命名</button>
    {editing&&<form className="source-rename" onSubmit={e=>{e.preventDefault();rename()}}><input aria-label="素材名称" autoFocus maxLength={100} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setEditing(false)}}/><button disabled={busy||!name.trim()} type="submit">保存名称</button><button type="button" onClick={()=>setEditing(false)}>取消</button></form>}
    <small role="status">{source?.queued?'等待自动保存 · 正在排队，录制期间暂缓开始':source?.busy?`正在自动保存 ${p?.kind==='audio'?'MP3':'MP4'}… ${Math.round(source.progress*100)}%`:saved?'已复制到所选位置':source?.ready?`${p?.kind==='audio'?'MP3':'MP4'} 已自动保存 · 另存无需重新编码`:source?.error?'自动保存未完成，原始录制仍保留。'+message(source.error):'等待自动保存，无需点击'}</small>
    {source?.error&&!source.busy&&!source.ready&&<button disabled={busy} onClick={()=>act(async()=>{await window.taVideo.prepareSource(id);setSource(await window.taVideo.sourceState(id))})}>重试自动保存</button>}
    {source?.ready&&source.tracks&&<small>声音：{[source.tracks.mic!==undefined?'麦克风':null,source.tracks.system!==undefined?'电脑声音':null].filter(Boolean).join('、')||'无录音'}{p?.kind!=='audio'&&' · 可分别编辑；另存使用混合声音'}</small>}
    {source?.ready&&<small className="source-path" title={source.file}>{source.file}</small>}
  </div>
}
