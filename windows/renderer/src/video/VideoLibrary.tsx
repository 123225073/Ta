import {useMemo,useRef,useState} from 'react'
import {SourceActions,type SourceAvailability} from './SourceActions'
import {clockText,media,type VideoProject} from './bridge'

function MediaCard({project, previewing, onPreview, onOpen, onError, onRenamed, onRemove, deleteDisabled, deleting}:{
  project:VideoProject;previewing:boolean;onPreview:(id?:string)=>void;onOpen:(id:string)=>void;onError:(message:string)=>void
  onRenamed:()=>void;onRemove:(id:string)=>void;deleteDisabled:boolean;deleting:boolean
}){
  const [availability,setAvailability]=useState<SourceAvailability>('preparing')
  const previewTrigger=useRef<HTMLButtonElement>(null)
  const ready=availability==='ready'
  const audio=project.kind==='audio'
  const poster=media(project.id,'thumbnail.jpg')
  const label=audio?'录音':'录像'
  const coverLabel=ready?(audio?'播放 / 暂停':'播放录像'):availability==='unavailable'?'缺少原片 · 查看说明':availability==='error'?'暂不可播放 · 查看说明':'正在准备成品'
  const closePreview=()=>{onPreview();requestAnimationFrame(()=>previewTrigger.current?.focus())}
  return <article className="video-card-item">
    <div className="library-preview">
      {previewing&&!audio&&ready?<div className="library-player">
        <video key={project.id} src={media(project.id,'source')} controls autoPlay playsInline aria-label={'播放录像 '+project.title}
          onError={()=>{closePreview();onError('此录像暂时无法播放，请在「打开目录」中检查成品文件。')}}/>
        <button type="button" className="preview-close" onClick={closePreview} aria-label="关闭录像预览">关闭预览</button>
      </div>:<button type="button" className="media-cover media-preview-trigger" ref={previewTrigger} data-state={availability} disabled={availability==='preparing'}
        aria-label={(ready?'播放'+label:coverLabel)+' '+project.title} onClick={e=>{
          if(!ready){e.currentTarget.closest('article')?.querySelector<HTMLElement>('.source-status')?.focus();return}
          if(audio){
            const player=e.currentTarget.closest('article')?.querySelector('audio')
            if(player){if(player.paused)void player.play().catch(e=>onError(e.message));else player.pause()}
          }else onPreview(project.id)
        }}>
        {audio?<div className="audio-card-cover"><strong>MP3</strong><span>声音记录</span></div>:<img loading="lazy" decoding="async" src={poster} alt=""/>}
        <span className="media-play-label">{coverLabel}</span>
        <span className="media-duration">{clockText(project.duration)}</span>
      </button>}
    </div>
    {audio?<div className="video-card audio-card-meta"><b>{project.title}</b><span>MP3 录音</span><small>{new Date(project.createdAt).toLocaleString('zh-CN')}</small></div>:
      <button className="video-card media-edit-entry" title={'打开 SOP 工作区：'+project.title} onClick={()=>onOpen(project.id)}>
        <b>{project.title}</b><span>{project.width} × {project.height} · MP4{project.status==='recovered'?' · 已恢复片段':''}</span>
        <small>{new Date(project.createdAt).toLocaleString('zh-CN')}</small><strong>剪辑 / 整理 SOP <i aria-hidden="true">↗</i></strong>
      </button>}
    <SourceActions id={project.id} onError={onError} onRenamed={onRenamed} onAvailability={setAvailability}/>
    <button className="video-delete" aria-label={'删除 '+project.title} disabled={deleteDisabled} onClick={()=>onRemove(project.id)}>{deleting?'正在删除…':audio?'删除录音':'删除录屏'}</button>
  </article>
}

export function VideoLibrary({projects,importing,deleting,recording,onImport,onOpen,onRemove,onRefresh,onError}:{
  projects:VideoProject[];importing:boolean;deleting:string;recording:boolean
  onImport:()=>void;onOpen:(id:string)=>void;onRemove:(id:string)=>void;onRefresh:()=>void;onError:(message:string)=>void
}){
  const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[limit,setLimit]=useState(24)
  const [preview,setPreview]=useState<string>()
  const filtered=useMemo(()=>projects.filter(p=>(kind==='all'||(p.kind==='audio'?'audio':'video')===kind)&&p.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),[projects,kind,query])
  const videos=projects.filter(p=>p.kind!=='audio').length
  return <main className="video-library">
    <div className="library-heading"><div><span className="studio-kicker">你的创作档案</span><h1>素材库 <small>{projects.length} 个项目</small></h1><p>录完即保存。直接取用，或继续剪辑、整理成操作指引。</p></div><button className="primary" disabled={importing} onClick={onImport}>{importing?'正在导入…':'导入视频生成 SOP'}</button></div>
    <div className="media-library-tools"><div className="media-filters" aria-label="素材类型">{[['all','全部',projects.length],['video','视频',videos],['audio','录音',projects.length-videos]].map(([id,label,count])=><button key={id} aria-pressed={kind===id} className={kind===id?'chosen':''} onClick={()=>{setPreview(undefined);setKind(String(id));setLimit(24)}}>{label}<small>{count}</small></button>)}</div><input type="search" aria-label="搜索素材" placeholder="搜索素材名称…" value={query} onChange={e=>{setPreview(undefined);setQuery(e.target.value);setLimit(24)}}/></div>
    <div className="video-grid" onPlayCapture={event=>{
      for(const player of event.currentTarget.querySelectorAll<HTMLMediaElement>('video,audio'))if(player!==event.target&&!player.paused)player.pause()
    }}>{filtered.slice(0,limit).map(p=><MediaCard key={p.id} project={p} previewing={preview===p.id} onPreview={setPreview} onOpen={onOpen}
      onError={onError} onRenamed={onRefresh} onRemove={onRemove} deleteDisabled={!!deleting||importing||recording} deleting={deleting===p.id}/>)}</div>
    {!filtered.length&&<div className="video-empty"><h2>{projects.length?'没有匹配的素材':'从第一段记录开始'}</h2><p>{projects.length?'试试其他名称，或切换素材类型。':'在「新建录屏」或「独立录音」中开始，结束后会自动保存到这里。'}</p></div>}
    {filtered.length>limit&&<button className="media-load-more" onClick={()=>setLimit(n=>n+24)}>显示更多 · 还有 {filtered.length-limit} 项</button>}
  </main>
}
