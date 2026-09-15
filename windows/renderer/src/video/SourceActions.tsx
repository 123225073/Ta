import {useState} from 'react'
import './bridge'
export function SourceActions({id,onError}:{id:string;onError:(message:string)=>void}){
  const [saving,setSaving]=useState(false),[saved,setSaved]=useState(false);
  return <div className="video-source-actions"><button onClick={()=>void window.taVideo.folder(id).catch(e=>onError(e.message))}>打开目录</button><button disabled={saving} onClick={()=>{setSaving(true);setSaved(false);void window.taVideo.saveSource(id).then(file=>setSaved(!!file)).catch(e=>onError(e.message)).finally(()=>setSaving(false))}}>{saving?'正在另存…':'另存视频'}</button>{saved&&<small role="status">已保存到所选位置</small>}</div>
}
