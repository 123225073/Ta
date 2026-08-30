import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { computeEditorFitScale } from './editor-fit'
import { isEditorCancelShortcut } from './editor-shortcuts'

type Tool = 'pen' | 'highlight' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'number' | 'mosaic' | 'blur' | 'eraser'
type Point = { x: number; y: number }

interface Mark {
  id: string
  tool: Tool
  start: Point
  end: Point
  points?: Point[]
  color: string
  width: number
  text?: string
  number?: number
}

interface EditorProps {
  imageDataUrl: string
  onCancel(): void
  onExport(dataUrl: string): void
}

const tools: Array<{ id: Tool; label: string; glyph: string }> = [
  { id: 'rect', label: '矩形', glyph: '□' },
  { id: 'ellipse', label: '椭圆', glyph: '○' },
  { id: 'arrow', label: '箭头', glyph: '↗' },
  { id: 'pen', label: '画笔', glyph: '✎' },
  { id: 'highlight', label: '高亮', glyph: '▰' },
  { id: 'text', label: '文字', glyph: 'T' },
  { id: 'number', label: '编号', glyph: '①' },
  { id: 'mosaic', label: '马赛克', glyph: '▦' },
  { id: 'blur', label: '模糊', glyph: '◌' },
  { id: 'eraser', label: '橡皮', glyph: '⌫' },
]

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2)
  context.beginPath()
  context.roundRect(x, y, width, height, r)
}

function drawArrow(context: CanvasRenderingContext2D, start: Point, end: Point, width: number) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const head = Math.max(13, width * 4)
  context.beginPath()
  context.moveTo(start.x, start.y)
  context.lineTo(end.x, end.y)
  context.stroke()
  context.beginPath()
  context.moveTo(end.x, end.y)
  context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6))
  context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6))
  context.closePath()
  context.fill()
}

function bounds(mark: Mark) {
  return {
    x: Math.min(mark.start.x, mark.end.x),
    y: Math.min(mark.start.y, mark.end.y),
    width: Math.abs(mark.end.x - mark.start.x),
    height: Math.abs(mark.end.y - mark.start.y),
  }
}

function drawMark(context: CanvasRenderingContext2D, mark: Mark, source: HTMLImageElement) {
  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = mark.width
  context.strokeStyle = mark.color
  context.fillStyle = mark.color
  const rect = bounds(mark)
  if (mark.tool === 'pen' || mark.tool === 'highlight') {
    context.globalAlpha = mark.tool === 'highlight' ? 0.28 : 1
    context.lineWidth = mark.tool === 'highlight' ? mark.width * 4 : mark.width
    context.beginPath()
    const points = mark.points ?? [mark.start, mark.end]
    points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y))
    context.stroke()
  } else if (mark.tool === 'rect') {
    roundedRect(context, rect.x, rect.y, rect.width, rect.height, 8)
    context.stroke()
  } else if (mark.tool === 'ellipse') {
    context.beginPath()
    context.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, Math.max(1, rect.width / 2), Math.max(1, rect.height / 2), 0, 0, Math.PI * 2)
    context.stroke()
  } else if (mark.tool === 'arrow') {
    drawArrow(context, mark.start, mark.end, mark.width)
  } else if (mark.tool === 'text') {
    context.font = `600 ${Math.max(18, mark.width * 6)}px "Microsoft YaHei UI"`
    context.textBaseline = 'top'
    context.fillText(mark.text ?? '', mark.start.x, mark.start.y)
  } else if (mark.tool === 'number') {
    const radius = Math.max(13, mark.width * 4)
    context.beginPath()
    context.arc(mark.start.x, mark.start.y, radius, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#fff'
    context.font = `700 ${radius}px "Segoe UI"`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(String(mark.number ?? 1), mark.start.x, mark.start.y + 1)
  } else if (mark.tool === 'mosaic' && rect.width > 2 && rect.height > 2) {
    const temp = document.createElement('canvas')
    const block = Math.max(4, Math.round(Math.min(rect.width, rect.height) / 18))
    temp.width = Math.max(1, Math.ceil(rect.width / block))
    temp.height = Math.max(1, Math.ceil(rect.height / block))
    const tempContext = temp.getContext('2d')!
    tempContext.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, temp.width, temp.height)
    context.imageSmoothingEnabled = false
    context.drawImage(temp, 0, 0, temp.width, temp.height, rect.x, rect.y, rect.width, rect.height)
    context.imageSmoothingEnabled = true
  } else if (mark.tool === 'blur' && rect.width > 2 && rect.height > 2) {
    context.filter = 'blur(10px)'
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height)
  }
  context.restore()
}

export function Editor({ imageDataUrl, onCancel, onExport }: EditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState('#ef2b17')
  const [width, setWidth] = useState(4)
  const [marks, setMarks] = useState<Mark[]>([])
  const [redo, setRedo] = useState<Mark[]>([])
  const [draft, setDraft] = useState<Mark>()
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [fitReady, setFitReady] = useState(false)

  useEffect(() => {
    const cancelWithKeyboard = (event: KeyboardEvent) => {
      if (!isEditorCancelShortcut(event.key)) return
      event.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', cancelWithKeyboard)
    return () => window.removeEventListener('keydown', cancelWithKeyboard)
  }, [onCancel])

  const fitToViewport = useCallback(() => {
    const stage = stageRef.current
    const source = sourceRef.current
    if (!stage || !source?.naturalWidth || !source.naturalHeight) return
    const style = getComputedStyle(stage)
    const availableWidth = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const availableHeight = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    setZoom(computeEditorFitScale(source.naturalWidth, source.naturalHeight, availableWidth, availableHeight))
    setFitReady(true)
  }, [])

  const render = useCallback(() => {
    const canvas = canvasRef.current
    const source = sourceRef.current
    if (!canvas || !source) return
    const context = canvas.getContext('2d')!
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, 0, 0)
    for (const mark of [...marks, ...(draft ? [draft] : [])]) drawMark(context, mark, source)
  }, [draft, marks])

  useEffect(() => {
    const source = new Image()
    source.onload = () => {
      setFitReady(false)
      sourceRef.current = source
      const canvas = canvasRef.current!
      canvas.width = source.naturalWidth
      canvas.height = source.naturalHeight
      setImageSize({ width: source.naturalWidth, height: source.naturalHeight })
      render()
    }
    source.src = imageDataUrl
  }, [imageDataUrl])

  useEffect(() => {
    if (!imageSize.width || !imageSize.height) return
    const frame = requestAnimationFrame(fitToViewport)
    const observer = new ResizeObserver(fitToViewport)
    if (stageRef.current) observer.observe(stageRef.current)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [fitToViewport, imageSize])

  useEffect(render, [render])

  const pointFromEvent = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }
  }

  const begin = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event)
    if (tool === 'text') {
      const text = window.prompt('输入标注文字')?.trim()
      if (text) setMarks((items) => [...items, { id: crypto.randomUUID(), tool, start: point, end: point, color, width, text }])
      return
    }
    if (tool === 'number') {
      setMarks((items) => [...items, { id: crypto.randomUUID(), tool, start: point, end: point, color, width, number: items.filter((item) => item.tool === 'number').length + 1 }])
      return
    }
    if (tool === 'eraser') {
      setMarks((items) => {
        const index = [...items].reverse().findIndex((item) => {
          const itemBounds = bounds(item)
          const padding = 18
          return point.x >= itemBounds.x - padding && point.x <= itemBounds.x + itemBounds.width + padding && point.y >= itemBounds.y - padding && point.y <= itemBounds.y + itemBounds.height + padding
        })
        if (index < 0) return items
        return items.filter((_, itemIndex) => itemIndex !== items.length - 1 - index)
      })
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setRedo([])
    setDraft({ id: crypto.randomUUID(), tool, start: point, end: point, points: [point], color, width })
  }

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!draft) return
    const point = pointFromEvent(event)
    setDraft((current) => current ? { ...current, end: point, points: current.tool === 'pen' || current.tool === 'highlight' ? [...(current.points ?? []), point] : current.points } : undefined)
  }

  const finish = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!draft) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    setMarks((items) => [...items, draft])
    setDraft(undefined)
  }

  const undo = () => setMarks((items) => {
    const removed = items.at(-1)
    if (removed) setRedo((redoItems) => [...redoItems, removed])
    return items.slice(0, -1)
  })
  const redoLast = () => setRedo((items) => {
    const restored = items.at(-1)
    if (restored) setMarks((markItems) => [...markItems, restored])
    return items.slice(0, -1)
  })

  const exportImage = () => {
    render()
    onExport(canvasRef.current!.toDataURL('image/png'))
  }

  const activeTool = useMemo(() => tools.find((item) => item.id === tool), [tool])

  return (
    <section className="editor-shell" aria-label="图片标注编辑器">
      <header className="editor-header">
        <div className="editor-title"><span className="seal-mini">拓</span><div><strong>原位标注</strong><small>{activeTool?.label} · {marks.length} 个对象</small></div></div>
        <div className="editor-actions"><button className="editor-cancel-button" aria-keyshortcuts="Escape" onClick={onCancel}>取消 <kbd>Esc</kbd></button><button className="button-primary" onClick={exportImage}>完成标注</button></div>
      </header>
      <div className="editor-toolbar">
        <div className="tool-group">
          {tools.map((item) => <button key={item.id} className={tool === item.id ? 'active' : ''} aria-pressed={tool === item.id} onClick={() => setTool(item.id)} title={item.label}><span>{item.glyph}</span>{item.label}</button>)}
        </div>
        <span className="toolbar-divider" />
        <label className="color-swatch" title="颜色"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /><i style={{ background: color }} /></label>
        <label className="width-control"><span>线宽</span><input type="range" min="2" max="12" value={width} onChange={(event) => setWidth(Number(event.target.value))} /><b>{width}</b></label>
        <span className="toolbar-divider" />
        <button disabled={!marks.length} onClick={undo}>↶ 撤销</button>
        <button disabled={!redo.length} onClick={redoLast}>↷ 重做</button>
        <button disabled={!marks.length} onClick={() => { setMarks([]); setRedo([]) }}>清空</button>
        <span className="toolbar-divider" />
        <div className="zoom-control" aria-label="画布缩放">
          <button title="缩小" onClick={() => setZoom((current) => Math.max(0.05, current - 0.1))}>−</button>
          <button className="fit-button" title="完整显示图片" onClick={fitToViewport}>适应窗口</button>
          <button title="放大" onClick={() => setZoom((current) => Math.min(4, current + 0.1))}>＋</button>
          <output>{Math.round(zoom * 100)}%</output>
        </div>
      </div>
      <div ref={stageRef} className="editor-stage"><canvas ref={canvasRef} style={{ width: imageSize.width ? imageSize.width * zoom : undefined, height: imageSize.height ? imageSize.height * zoom : undefined, visibility: fitReady ? 'visible' : 'hidden' }} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} /></div>
    </section>
  )
}
