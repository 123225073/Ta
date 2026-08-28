import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { CaptureAction, OverlayPayload } from './types'
import {
  beginSelectionInteraction,
  updateSelectionInteraction,
  type InteractionTarget,
  type Point,
  type ResizeHandle,
  type SelectionInteraction,
  type SelectionRect,
} from './selection-geometry'
import { createOutsideMasks, findSmartSelection } from './smart-selection'

const actionNames: Record<CaptureAction, string> = {
  capture: '通用截图',
  ocr: '极速取字',
  copy: '快速截图',
  pin: '截图钉图',
  long: '滚动长截图',
  translate: '截图翻译',
}

const resizeHandles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function CaptureOverlay() {
  const [payload, setPayload] = useState<OverlayPayload>()
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 })
  const [selection, setSelection] = useState<SelectionRect>()
  const [interactionMode, setInteractionMode] = useState<SelectionInteraction['mode']>()
  const overlayRef = useRef<HTMLDivElement>(null)
  const interactionRef = useRef<SelectionInteraction | undefined>(undefined)
  const activePointerId = useRef<number | undefined>(undefined)
  const lastCaptureId = useRef<number | undefined>(undefined)
  const lastSelectionClick = useRef<{ at: number; point: Point } | undefined>(undefined)
  const candidateAtPointerDown = useRef<ReturnType<typeof findSmartSelection>>(undefined)
  const pendingCursor = useRef<Point>({ x: 0, y: 0 })
  const cursorFrame = useRef<number | undefined>(undefined)

  useEffect(() => {
    let active = true
    const applyPayload = (value: OverlayPayload) => {
      if (!active) return
      if (lastCaptureId.current !== value.captureId) {
        lastCaptureId.current = value.captureId
        interactionRef.current = undefined
        activePointerId.current = undefined
        lastSelectionClick.current = undefined
        candidateAtPointerDown.current = undefined
        if (cursorFrame.current !== undefined) cancelAnimationFrame(cursorFrame.current)
        cursorFrame.current = undefined
        setCursor(value.initialCursor ?? { x: 0, y: 0 })
        setSelection(undefined)
        setInteractionMode(undefined)
      }
      setPayload(value)
    }
    const refreshPayload = () => {
      void window.ta.getOverlayInit().then((value) => { if (value) applyPayload(value) })
    }
    refreshPayload()
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') refreshPayload() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refreshPayload)
    const unsubscribe = window.ta.onOverlayInit(applyPayload)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refreshPayload)
      unsubscribe()
      if (cursorFrame.current !== undefined) cancelAnimationFrame(cursorFrame.current)
    }
  }, [])
  useEffect(() => { if (payload) window.ta.reportOverlayReady() }, [payload])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.ta.cancelCapture()
      if (event.key === 'Enter' && selection && selection.width >= 4 && selection.height >= 4) window.ta.submitSelection(selection)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection])

  const pixelsFrozen = Boolean(payload?.pixelsFrozen || payload?.imageDataUrl)
  const smartCandidate = useMemo(() => (
    selection ? undefined : findSmartSelection(payload?.smartSelections, cursor)
  ), [cursor, payload?.smartSelections, selection])
  const maskTarget = selection && selection.width >= 1 && selection.height >= 1 ? selection : smartCandidate
  const masks = createOutsideMasks({ width: window.innerWidth, height: window.innerHeight }, maskTarget)
  const queueCursor = (point: Point) => {
    pendingCursor.current = point
    if (cursorFrame.current !== undefined) return
    cursorFrame.current = requestAnimationFrame(() => {
      cursorFrame.current = undefined
      setCursor(pendingCursor.current)
    })
  }

  const acceptsPointerEvent = (event: ReactPointerEvent<HTMLElement>) => (
    overlayRef.current?.dataset.e2eInputIsolation !== 'true'
    || Boolean((event.nativeEvent as PointerEvent & { __taE2E?: boolean }).__taE2E)
  )

  const begin = (event: ReactPointerEvent<HTMLElement>, target: InteractionTarget) => {
    if (!acceptsPointerEvent(event)) return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const point = { x: event.clientX, y: event.clientY }
    candidateAtPointerDown.current = target === 'canvas' ? smartCandidate : undefined
    const interaction = beginSelectionInteraction(selection, point, target)
    if (target !== 'selection') lastSelectionClick.current = undefined
    interactionRef.current = interaction
    activePointerId.current = event.pointerId
    try { overlayRef.current?.setPointerCapture(event.pointerId) } catch { /* synthetic and interrupted pointers can lack an active native stream */ }
    setCursor(point)
    setInteractionMode(interaction.mode)
    if (interaction.mode === 'creating' && !candidateAtPointerDown.current) setSelection({ x: point.x, y: point.y, width: 0, height: 0 })
  }

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!acceptsPointerEvent(event)) return
    const point = { x: event.clientX, y: event.clientY }
    const interaction = interactionRef.current
    if (!interaction) {
      if (!selection && pixelsFrozen) queueCursor(point)
      return
    }
    if (activePointerId.current !== event.pointerId) return
    if (Math.hypot(point.x - interaction.origin.x, point.y - interaction.origin.y) > 4) {
      lastSelectionClick.current = undefined
      candidateAtPointerDown.current = undefined
    }
    setSelection(updateSelectionInteraction(interaction, point, {
      width: window.innerWidth,
      height: window.innerHeight,
    }))
  }

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!acceptsPointerEvent(event)) return
    const interaction = interactionRef.current
    if (!interaction || activePointerId.current !== event.pointerId) return
    if (overlayRef.current?.hasPointerCapture(event.pointerId)) overlayRef.current.releasePointerCapture(event.pointerId)
    interactionRef.current = undefined
    activePointerId.current = undefined
    setInteractionMode(undefined)
    const point = { x: event.clientX, y: event.clientY }
    const travel = Math.hypot(point.x - interaction.origin.x, point.y - interaction.origin.y)
    const clickedCandidate = interaction.mode === 'creating' && travel <= 4 ? candidateAtPointerDown.current : undefined
    candidateAtPointerDown.current = undefined
    if (clickedCandidate) {
      lastSelectionClick.current = undefined
      setSelection({ x: clickedCandidate.x, y: clickedCandidate.y, width: clickedCandidate.width, height: clickedCandidate.height })
      return
    }
    setSelection((current) => current && current.width >= 4 && current.height >= 4 ? current : undefined)
    const shortSelectionClick = interaction.mode === 'moving'
      && travel <= 4
    if (!shortSelectionClick || !selection || selection.width < 4 || selection.height < 4) {
      lastSelectionClick.current = undefined
      return
    }
    const now = performance.now()
    const previous = lastSelectionClick.current
    if (previous && now - previous.at <= 420 && Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= 8) {
      lastSelectionClick.current = undefined
      window.ta.submitSelection(selection)
    } else {
      lastSelectionClick.current = { at: now, point }
    }
  }

  const ready = selection && selection.width >= 4 && selection.height >= 4
  const toolbarTop = selection ? Math.min(window.innerHeight - 58, selection.y + selection.height + 10) : 0
  const toolbarLeft = selection ? Math.max(12, Math.min(window.innerWidth - 356, selection.x + selection.width - 356)) : 0

  return (
    <div
      ref={overlayRef}
      className={`capture-overlay${pixelsFrozen ? '' : ' preparing'}`}
      data-testid="capture-overlay"
      data-capture-id={payload?.captureId}
      onPointerDown={(event) => begin(event, 'canvas')}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onContextMenu={(event) => { event.preventDefault(); window.ta.cancelCapture() }}
      style={{ backgroundImage: payload?.imageDataUrl ? `url(${payload.imageDataUrl})` : 'none' }}
    >
      {pixelsFrozen && masks.map((mask) => (
        <span
          key={mask.side}
          className={`capture-mask mask-${mask.side}`}
          data-mask-side={mask.side}
          style={{ left: mask.x, top: mask.y, width: mask.width, height: mask.height }}
        />
      ))}
      <div className="overlay-hint">
        <span className="seal-mini">拓</span>
        <strong>{payload ? actionNames[payload.action] : '截图准备中'}</strong>
        <span>{ready ? '框内拖动移动 · 边角缩放 · 双击完成 · Esc 取消' : pixelsFrozen ? '移动鼠标自动识别窗口 · 单击锁定 · 拖动自由框选' : '截图已启动 · 可立即移动鼠标'}</span>
      </div>
      {!interactionMode && !selection && (
        <>
          <span className="crosshair horizontal" style={{ top: cursor.y }} />
          <span className="crosshair vertical" style={{ left: cursor.x }} />
        </>
      )}
      {!selection && smartCandidate && pixelsFrozen && (
        <div
          className="smart-selection"
          data-testid="smart-selection"
          data-smart-kind={smartCandidate.kind}
          style={{ left: smartCandidate.x, top: smartCandidate.y, width: smartCandidate.width, height: smartCandidate.height }}
        >
          <span>{smartCandidate.label || (smartCandidate.kind === 'screen' ? '当前屏幕' : '窗口')}</span>
        </div>
      )}
      {selection && (
        <>
          <div
            className="selection-box"
            data-testid="selection-box"
            data-interaction={interactionMode ?? 'selected'}
            style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }}
            onPointerDown={(event) => begin(event, 'selection')}
            onDoubleClick={(event) => {
              event.stopPropagation()
              if (ready) window.ta.submitSelection(selection)
            }}
          >
            <span className="selection-size">{Math.round(selection.width * (payload?.scaleFactor ?? window.devicePixelRatio))} × {Math.round(selection.height * (payload?.scaleFactor ?? window.devicePixelRatio))}</span>
            {resizeHandles.map((handle) => (
              <i
                key={handle}
                className={`resize-handle handle-${handle}`}
                data-resize-handle={handle}
                onPointerDown={(event) => begin(event, handle)}
              />
            ))}
          </div>
          {!interactionMode && ready && (
            <div className="selection-toolbar" style={{ left: toolbarLeft, top: toolbarTop }} onPointerDown={(event) => event.stopPropagation()}>
              <span className="selection-toolbar-tip">可移动与缩放 · 双击也可完成</span>
              <button className="toolbar-cancel" onClick={() => window.ta.cancelCapture()}>取消</button>
              <button className="toolbar-confirm" onClick={() => window.ta.submitSelection(selection)}>完成 · Enter</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
