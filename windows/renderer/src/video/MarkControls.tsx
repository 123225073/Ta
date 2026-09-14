import {useEffect,useRef,useState,type PointerEvent} from 'react'
import {clamp,markFontSize,markSvg,type Mark,type Rect} from '../../../electron/video/model'
import {markBounds,moveMark,resizeMark,rotateMark,markAngle,arrowEndpoint} from '../../../electron/video/mark-geometry'
type Mode='move'|'resize'|'rotate'|'start'|'end'
export function MarkControls({mark,crop,selected,editing,onSelect,onEdit,onCommit}:{mark:Mark;crop:Rect;selected:boolean;editing:boolean;onSelect:()=>void;onEdit:(v:boolean)=>void;onCommit:(m:Mark)=>void}) {
  const host=useRef<HTMLDivElement>(null),[draft,setDraft]=useState<Mark>(),[unit,setUnit]=useState(1),gesture=useRef<{mark:Mark;x:number;y:number;mode:Mode}|undefined>(undefined),pending=useRef<Mark|undefined>(undefined)
  const m=draft??mark,b=markBounds(m),size=markFontSize(m),center={x:b.x+b.width/2,y:b.y+b.height/2},rotation=m.tool==='arrow'?0:m.rotation??0
  useEffect(()=>{const el=host.current;if(!el)return;const obs=new ResizeObserver(()=>setUnit(crop.width/Math.max(1,el.getBoundingClientRect().width)));obs.observe(el);return()=>obs.disconnect()},[crop.width])
  const point=(e:PointerEvent)=>{const r=host.current!.getBoundingClientRect();return {x:crop.x+(e.clientX-r.x)/r.width*crop.width,y:crop.y+(e.clientY-r.y)/r.height*crop.height}}
  const begin=(e:PointerEvent,mode:Mode)=>{e.stopPropagation();e.preventDefault();onSelect();gesture.current={mark:structuredClone(mark),...point(e),mode};e.currentTarget.setPointerCapture(e.pointerId)}
  const move=(e:PointerEvent)=>{const g=gesture.current;if(!g)return;const p=point(e),bb=markBounds(g.mark),cx=bb.x+bb.width/2,cy=bb.y+bb.height/2;let next:Mark
    if(g.mode==='move')next=moveMark(g.mark,p.x-g.x,p.y-g.y,crop)
    else if(g.mode==='start'||g.mode==='end')next=arrowEndpoint(g.mark,g.mode,{x:clamp(p.x,crop.x,crop.x+crop.width),y:clamp(p.y,crop.y,crop.y+crop.height)})
    else if(g.mode==='rotate'){let angle=markAngle(g.mark)+(Math.atan2(p.y-cy,p.x-cx)-Math.atan2(g.y-cy,g.x-cx))*180/Math.PI;if(e.shiftKey)angle=Math.round(angle/15)*15;next=rotateMark(g.mark,angle)}
    else {const angle=-(g.mark.rotation??0)*Math.PI/180,dx=(p.x-g.x)*Math.cos(angle)-(p.y-g.y)*Math.sin(angle),dy=(p.x-g.x)*Math.sin(angle)+(p.y-g.y)*Math.cos(angle);next=g.mark.tool==='text'||e.shiftKey?resizeMark(g.mark,Math.max((bb.width+dx)/Math.max(1,bb.width),(bb.height+dy)/Math.max(1,bb.height))):{...g.mark,width:clamp(g.mark.width+dx,2,crop.width),height:clamp(g.mark.height+dy,2,crop.height)}}
    if(next.x<0||next.y<0||next.x>crop.x+crop.width||next.y>crop.y+crop.height||Math.abs(next.width)>crop.width||Math.abs(next.height)>crop.height)return
    pending.current=next;setDraft(next)
  }
  const end=()=>{if(pending.current)onCommit(pending.current);gesture.current=undefined;pending.current=undefined;setDraft(undefined)}
  const cancel=()=>{gesture.current=undefined;pending.current=undefined;setDraft(undefined)}
  const handle=(mode:Mode,x:number,y:number,label:string)=><circle key={mode} className={'mark-handle '+(mode==='resize'?'timeline-object-resize':mode==='move'?'timeline-object-move':'')} aria-label={label} cx={x} cy={y} r={5*unit} style={{cursor:mode==='rotate'?'grab':mode==='resize'?'nwse-resize':'move'}} onPointerDown={e=>begin(e,mode)}/>
  return <div ref={host} className={'timeline-mark-controls '+(draft?'is-dragging':'')}>
    {draft&&<svg viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`} preserveAspectRatio="none" dangerouslySetInnerHTML={{__html:markSvg(draft)}}/>}
    <svg className="mark-interaction" viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`} preserveAspectRatio="none" onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}>
      <g transform={`rotate(${rotation} ${center.x} ${center.y})`}>
        {!editing&&(m.tool==='arrow'?<line x1={m.x} y1={m.y} x2={m.x+m.width} y2={m.y+m.height} stroke="transparent" strokeWidth={Math.max(m.stroke,16*unit)} style={{pointerEvents:'stroke',cursor:'move'}} onPointerDown={e=>begin(e,'move')}/>:<rect x={b.x} y={b.y} width={b.width} height={b.height} fill="transparent" style={{pointerEvents:'all',cursor:'move'}} onPointerDown={e=>begin(e,'move')} onDoubleClick={()=>{onSelect();if(m.tool==='text')onEdit(true)}}/>)}
        {selected&&!editing&&<><rect x={b.x} y={b.y} width={Math.max(1,b.width)} height={Math.max(1,b.height)} fill="none" stroke="var(--va)" vectorEffect="non-scaling-stroke"/>
          {m.tool==='arrow'?<>{handle('start',m.x,m.y,'箭头起点')}{handle('end',m.x+m.width,m.y+m.height,'箭头终点')}</>:handle('resize',b.x+b.width,b.y+b.height,'缩放画面标记')}
          {handle('move',m.tool==='arrow'?center.x:b.x,m.tool==='arrow'?center.y:b.y,'拖动画面标记')}<line x1={center.x} y1={b.y} x2={center.x} y2={b.y-26*unit} stroke="var(--va)" vectorEffect="non-scaling-stroke"/>{handle('rotate',center.x,b.y-26*unit,'旋转画面标记')}
        </>}
        {editing&&<foreignObject x={m.x} y={m.y} width={m.textDirection==='vertical'?Math.max(b.width,size*1.2):Math.max(b.width,crop.width*.4)} height={Math.max(b.height,size*2.4)} style={{pointerEvents:'all'}}><InlineText key={mark.id} mark={mark} onDone={text=>{if(text!==undefined&&text!==mark.text)onCommit({...mark,text});onEdit(false)}}/></foreignObject>}
      </g>
    </svg>
    {selected&&!editing&&m.tool==='text'&&<div className="mark-quick" style={{left:(b.x-crop.x)/crop.width*100+'%',top:((b.y+b.height+8*unit-crop.y)/crop.height*100)+'%'}} onPointerDown={e=>e.stopPropagation()}><button onClick={()=>onEdit(true)}>编辑文字</button><button aria-label="缩小文字" onClick={()=>onCommit({...mark,fontSize:clamp(size/1.2,8,1000)})}>A−</button><button aria-label="放大文字" onClick={()=>onCommit({...mark,fontSize:clamp(size*1.2,8,1000)})}>A＋</button><input aria-label="画面文字颜色" type="color" value={mark.color} onChange={e=>onCommit({...mark,color:e.target.value})}/></div>}
  </div>
}
function InlineText({mark,onDone}:{mark:Mark;onDone:(text?:string)=>void}) {
  const [text,setText]=useState(mark.text),done=useRef(false)
  const finish=(cancel=false)=>{if(done.current)return;done.current=true;onDone(cancel?undefined:text)}
  return <textarea ref={el=>{if(el&&!done.current)el.focus()}} aria-label="画面文字编辑" className="timeline-inline-text" value={text} placeholder="输入文字" wrap="off" maxLength={500} style={{fontSize:markFontSize(mark),color:mark.color,writingMode:mark.textDirection==='vertical'?'vertical-rl':'horizontal-tb',textOrientation:'upright'}} onChange={e=>setText(e.target.value)} onPointerDown={e=>e.stopPropagation()} onBlur={()=>finish()} onKeyDown={e=>{e.stopPropagation();if(e.nativeEvent.isComposing)return;if(e.key==='Escape'){e.preventDefault();finish(true)}else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();finish()}}}/>
}
