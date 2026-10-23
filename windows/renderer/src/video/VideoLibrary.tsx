import {useMemo,useState} from 'react'
import {SourceActions} from './SourceActions'
import {clockText,media,type VideoProject} from './bridge'

export function VideoLibrary({projects,importing,deleting,recording,onImport,onOpen,onRemove,onRefresh,onError}:{
  projects:VideoProject[];importing:boolean;deleting:string;recording:boolean
  onImport:()=>void;onOpen:(id:string)=>void;onRemove:(id:string)=>void;onRefresh:()=>void;onError:(message:string)=>void
}){
  const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[limit,setLimit]=useState(24)
  const filtered=useMemo(()=>projects.filter(p=>(kind==='all'||(p.kind==='audio'?'audio':'video')===kind)&&p.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),[projects,kind,query])
  const videos=projects.filter(p=>p.kind!=='audio').length
  return <main className="video-library">
    <div className="library-heading"><div><span className="studio-kicker">你的创作档案</span><h1>素材库 <small>{projects.length} 个项目</small></h1><p>录完即保存。直接取用，或继续剪辑、整理成操作指引。</p></div><button className="primary" disabled={importing} onClick={onImport}>{importing?'正在导入…':'导入视频生成 SOP'}</button></div>
    <div className="media-library-tools"><div className="media-filters" aria-label="素材类型">{[['all','全部',projects.length],['video','视频',videos],['audio','录音',projects.length-videos]].map(([id,label,count])=><button key={id} aria-pressed={kind===id} className={kind===id?'chosen':''} onClick={()=>{setKind(String(id));setLimit(24)}}>{label}<small>{count}</small></button>)}</div><input type="search" aria-label="搜索素材" placeholder="搜索素材名称…" value={query} onChange={e=>{setQuery(e.target.value);setLimit(24)}}/></div>
    <div className="video-grid">{filtered.slice(0,limit).map(p=><article key={p.id} className="video-card-item">
      <button className="video-card" title={p.kind==='audio'?'播放或暂停录音':'打开 SOP 工作区'} onClick={e=>{if(p.kind==='audio'){const audio=e.currentTarget.closest('article')?.querySelector('audio');if(audio){if(audio.paused)void audio.play().catch(e=>onError(e.message));else audio.pause()}}else onOpen(p.id)}}>
        <div className="media-cover">{p.kind==='audio'?<div className="audio-card-cover"><strong>MP3</strong><span>声音记录</span></div>:<img loading="lazy" decoding="async" src={media(p.id,'thumbnail.jpg')} alt="录像预览"/>}<span className="media-duration">{clockText(p.duration)}</span></div>
        <b>{p.title}</b><span>{p.kind==='audio'?'MP3 录音':`${p.width} × ${p.height} · MP4`}{p.status==='recovered'?' · 已恢复片段':''}</span><small>录制于 {new Date(p.createdAt).toLocaleString('zh-CN')}</small>
      </button>
      <SourceActions id={p.id} onError={onError} onRenamed={onRefresh}/>
      <button className="video-delete" aria-label={'删除 '+p.title} disabled={!!deleting||importing||recording} onClick={()=>onRemove(p.id)}>{deleting===p.id?'正在删除…':p.kind==='audio'?'删除录音':'删除录屏'}</button>
    </article>)}</div>
    {!filtered.length&&<div className="video-empty"><h2>{projects.length?'没有匹配的素材':'从第一段记录开始'}</h2><p>{projects.length?'试试其他名称，或切换素材类型。':'在「新建录屏」或「独立录音」中开始，结束后会自动保存到这里。'}</p></div>}
    {filtered.length>limit&&<button className="media-load-more" onClick={()=>setLimit(n=>n+24)}>显示更多 · 还有 {filtered.length-limit} 项</button>}
  </main>
}
