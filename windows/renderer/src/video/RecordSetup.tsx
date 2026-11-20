import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import { clamp } from '../../../electron/video/model'
import { DEFAULT_RECORDING_QUALITY, RECORDING_QUALITIES, estimateRecordingMBPerMinute, type RecordingQuality } from '../../../electron/video/recording-quality'
import type { RecordingOptions, RecordingSource, Rect, VideoSettings } from './bridge'
import { selectAfterRefresh, sourceSize, validRegion, type CaptureMode } from './recording-selection'

const modes: { id: CaptureMode; label: string }[] = [
  { id: 'screen', label: '整个屏幕' }, { id: 'window', label: '单个窗口' }, { id: 'region', label: '指定区域' },
]
const coordinates = { x: '左', y: '上', width: '宽', height: '高' } as const
type Preferences = Pick<VideoSettings, 'quality' | 'mic' | 'micName' | 'system' | 'lastCaptureMode' | 'lastDisplayId'>

export function RecordSetup({ settings, disabled, switching = false, onError, onRecorded }: {
  settings: VideoSettings; disabled: boolean; switching?: boolean; onError: (message: string) => void
  onRecorded?: (options: Preferences) => void
}) {
  const [sources, setSources] = useState<RecordingSource[]>([])
  const [selected, setSelected] = useState('')
  const [mode, setMode] = useState<CaptureMode>(modes.find(item => item.id === settings.lastCaptureMode)?.id ?? 'screen')
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState<Rect>()
  const [mics, setMics] = useState<string[]>([])
  const [mic, setMic] = useState(settings.mic), [system, setSystem] = useState(settings.system)
  const [micName, setMicName] = useState(settings.micName)
  const [quality, setQuality] = useState<RecordingQuality>(settings.quality ?? DEFAULT_RECORDING_QUALITY)
  const [loading, setLoading] = useState(true), [submitting, setSubmitting] = useState(false)
  const [count, setCount] = useState<number | null>(null), [notice, setNotice] = useState('')
  const [windowSize, setWindowSize] = useState<{ width: number; height: number }>()
  const ticket = useRef(0), request = useRef(0), dragging = useRef<{ x: number; y: number } | undefined>(undefined)
  const allowSingle = useRef(true), searchId = useId()
  const locked = disabled || loading || submitting
  const source = sources.find(item => item.id === selected)
  const size = source?.kind === 'window' ? windowSize : sourceSize(source)
  const width = size?.width ?? 0, height = size?.height ?? 0
  const candidates = sources.filter(item => item.kind === (mode === 'window' ? 'window' : 'screen'))
  const visible = candidates.filter(item => mode !== 'window' || item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const ready = !!source && (mode !== 'region' || validRegion(region, width, height))
  const target = source ? source.name + (mode === 'region' && region ? ' · ' + region.width + ' × ' + region.height : '') : ''

  async function refresh(initial = false) {
    const sequence = ++request.current
    setLoading(true)
    try {
      const next = await window.taVideo.sources()
      if (request.current !== sequence) return
      const remembered = initial && !switching && mode !== 'window' ? settings.lastDisplayId : undefined
      const nextId = remembered ? next.find(item => item.kind === 'screen' && item.displayId === remembered)?.id ?? ''
        : allowSingle.current || selected ? selectAfterRefresh(next, selected, mode) : ''
      const oldSize = sourceSize(source), newSize = sourceSize(next.find(item => item.id === nextId))
      if ((selected || remembered) && !nextId) {
        allowSingle.current = false
        setNotice('原录制目标已不可用，请重新选择。')
        setRegion(undefined)
      } else if (region && (oldSize?.width !== newSize?.width || oldSize?.height !== newSize?.height)) {
        setRegion(undefined)
        setNotice('屏幕尺寸已变化，请重新设置录制区域。')
      }
      setSources(next)
      setSelected(nextId)
    } catch (error) {
      if (request.current === sequence) {
        setSources([]); setSelected(''); setRegion(undefined); allowSingle.current = false
        setNotice('读取录制来源失败，请刷新重试。')
        onError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (request.current === sequence) setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    void refresh(true)
    if (!switching) void window.taVideo.microphones().then(items => { if (mounted) setMics(items) }).catch(() => {})
    return () => { mounted = false; request.current++; ticket.current++ }
  }, [])

  useEffect(() => {
    let active = true
    setWindowSize(undefined)
    if (source?.kind === 'window') void window.taVideo.sourceDimensions(source.id).then(dimensions => {
      if (active) setWindowSize(dimensions)
    }).catch(() => {})
    return () => { active = false }
  }, [source])

  function chooseMode(next: CaptureMode) {
    if (next === mode) return
    const keepDisplay = mode !== 'window' && next !== 'window'
    setMode(next)
    allowSingle.current = true
    setSelected(selectAfterRefresh(sources, keepDisplay ? selected : '', next))
    setRegion(undefined); setNotice(''); setQuery('')
  }

  function choose(id: string) {
    setSelected(id); setRegion(undefined); setNotice(''); allowSingle.current = true
  }

  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: Math.round(clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * width),
      y: Math.round(clamp((event.clientY - bounds.top) / bounds.height, 0, 1) * height) }
  }

  async function start() {
    if (locked || !ready) return
    const run = ++ticket.current
    const options: RecordingOptions = { sourceId: selected, ...(mode === 'region' && region ? { region: { ...region } } : {}), mic, micName, system, quality }
    setSubmitting(true); setNotice(''); onError('')
    try {
      if (switching) {
        await window.taVideo.switchSource({ sourceId: options.sourceId, region: options.region })
      } else {
        for (let remaining = settings.countdown; remaining > 0; remaining--) {
          setCount(remaining)
          await new Promise(resolve => setTimeout(resolve, 1000))
          if (ticket.current !== run) return
        }
        setCount(null)
        await window.taVideo.start(options)
        onRecorded?.({ mic, micName, system, quality, lastCaptureMode:mode, lastDisplayId:source?.kind==='screen'?source.displayId:settings.lastDisplayId })
      }
    } catch (error) {
      if (ticket.current === run) {
        onError(error instanceof Error ? error.message : String(error))
        await refresh()
      }
    } finally {
      if (ticket.current === run) { setSubmitting(false); setCount(null) }
    }
  }

  function cancelCountdown() {
    ticket.current++
    setCount(null); setSubmitting(false)
  }

  const estimateWidth = mode === 'region' ? region?.width : width
  const estimateHeight = mode === 'region' ? region?.height : height
  const estimate = estimateWidth && estimateHeight ? estimateRecordingMBPerMinute(quality, estimateWidth, estimateHeight, mic, system) : undefined
  return <main className="video-setup" data-mode={mode}>
    <div className="video-heading"><div><h1>{switching ? '切换录制范围' : '新建录屏'}</h1><p>{switching ? '选择新目标后继续写入同一个视频。' : '选好画面和声音，录完即可在素材库打开 MP4。'}</p></div>
      <div className="capture-instrument" aria-hidden="true"><i className="instrument-stand"/><i className="instrument-back"/><i className="instrument-face"><i className="instrument-glass"/><i className="instrument-mark"/></i></div>
    </div>
    <div className="video-row video-mode-picker" role="group" aria-label="录制模式">{modes.map(item =>
      <button key={item.id} data-mode={item.id} aria-pressed={mode === item.id} className={mode === item.id ? 'chosen' : ''} disabled={locked} onClick={() => chooseMode(item.id)}>{item.label}</button>)}</div>
    <div className="video-source-layout"><div className="video-source-browser">
      <div className="video-source-meta"><strong>{mode === 'window' ? '应用窗口' : '显示器'} · {candidates.length}</strong><button disabled={locked} onClick={() => void refresh()}>刷新来源</button></div>
      {mode === 'window' && <label className="video-source-search" htmlFor={searchId}><input id={searchId} type="search" aria-label="搜索窗口标题" placeholder="搜索窗口标题" disabled={locked} value={query} onChange={event => {
        const value = event.target.value; setQuery(value)
        if (source && !source.name.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase())) choose('')
      }}/></label>}
      <div className="video-source-list" role="group" aria-label={mode === 'window' ? '可录制窗口' : '可录制显示器'}>{visible.map(item => {
        const dimensions = sourceSize(item)
        return <button key={item.id} className={item.id === selected ? 'chosen' : ''} aria-pressed={item.id === selected} disabled={locked} title={item.name} onClick={() => choose(item.id)}>
          {item.thumbnail && <img src={item.thumbnail} alt=""/>}<span>{item.name}</span>{item.kind === 'screen' && dimensions && <small>{dimensions.width} × {dimensions.height}</small>}
        </button>
      })}{visible.length === 0 && <p>{loading ? '正在读取来源…' : query.trim() ? '没有匹配的窗口，请更换关键词。' : mode === 'window' ? '暂无可录制窗口。打开目标窗口后刷新。' : '暂无显示器，请连接后刷新。'}</p>}</div>
    </div><section aria-label="录制目标预览">
      <div className={'video-source-preview ' + mode} style={{ aspectRatio: width && height ? width + '/' + height : '16/9', width: 'min(100%, calc(var(--preview-height, 36vh) * ' + (width && height ? width / height : 16 / 9) + '))' }}
        onPointerDown={event => {
          if (locked || mode !== 'region' || !source || event.button !== 0) return
          dragging.current = point(event); event.currentTarget.setPointerCapture(event.pointerId)
        }} onPointerMove={event => {
          if (!dragging.current || locked) return
          const a = dragging.current, b = point(event)
          setRegion({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) })
        }} onPointerUp={() => { dragging.current = undefined }} onLostPointerCapture={() => { dragging.current = undefined }}>
        {source?.thumbnail ? <img draggable={false} src={source.thumbnail} alt={'预览：' + source.name}/> : <span className="video-selection-state">{source ? '此来源暂未提供预览' : mode === 'window' ? '请选择要录制的窗口' : '请选择要录制的显示器'}</span>}
        {mode === 'region' && region && width > 0 && height > 0 && <div className="video-region" style={{left:region.x/width*100+'%',top:region.y/height*100+'%',width:region.width/width*100+'%',height:region.height/height*100+'%'}}/>}
      </div>
      <p className="video-source-summary" role="status">{notice || (target ? '录制目标 · ' + target : '尚未选择录制目标')}</p>
      {mode === 'region' && source && <><p>拖动预览框选范围，或直接输入像素坐标。</p><div className="video-row video-region-inputs">{(Object.keys(coordinates) as (keyof Rect)[]).map(key =>
        <label key={key}>{coordinates[key]}<input type="number" disabled={locked} min={key === 'width' || key === 'height' ? 16 : 0} max={key === 'x' || key === 'width' ? width : height} value={region?.[key] ?? ''} onChange={event => {
          const value = Number(event.target.value)
          setRegion(current => ({ x: 0, y: 0, width, height, ...current, [key]: value }))
        }}/></label>)}</div>{region && !ready && <p role="alert">录制框须位于屏幕内，宽高至少 16 像素。</p>}</>}
    </section></div>
    <footer className="video-record-footer">{!switching && <>
      <label>画质 <select aria-label="录制画质" disabled={locked} value={quality} onChange={event => setQuality(event.target.value as RecordingQuality)}>{RECORDING_QUALITIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label><input type="checkbox" disabled={locked} checked={mic} onChange={event => setMic(event.target.checked)}/>麦克风</label>
      {mic && <select aria-label="麦克风设备" value={micName} disabled={locked} onChange={event => setMicName(event.target.value)}><option value="">默认麦克风</option>{mics.map(name => <option key={name}>{name}</option>)}</select>}
      <label><input type="checkbox" disabled={locked} checked={system} onChange={event => setSystem(event.target.checked)}/>电脑声音</label>
      <span className="video-size-summary">{!mic && !system && '无声录制 · '}{estimate ? '成品约 ' + Math.round(estimate) + ' MB/分钟' : '选择有效范围后预估大小'}{settings.retainOriginals && ' · 另存底稿'}</span>
    </>}
    <button className="primary" disabled={locked || !ready} onClick={() => void start()}>{count !== null ? count + ' 秒后开始' : submitting ? '正在准备…' : switching ? '切换并继续录制' : '开始录制'}</button>
    {count !== null && <button onClick={cancelCountdown}>取消倒计时</button>}</footer>
  </main>
}
