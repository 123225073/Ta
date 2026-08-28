import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'

export function PinWindow() {
  const [image, setImage] = useState('')
  const [rotation, setRotation] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [opacity, setOpacity] = useState(1)
  const dragPointerId = useRef<number | undefined>(undefined)

  useEffect(() => {
    let active = true
    void window.ta.getPinInit().then((value) => { if (active && value) setImage(value.imageDataUrl) })
    const unsubscribe = window.ta.onPinInit(({ imageDataUrl }) => setImage(imageDataUrl))
    return () => { active = false; unsubscribe() }
  }, [])

  const beginMove = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragPointerId.current = event.pointerId
    window.ta.pinCommand('move-start', { x: event.screenX, y: event.screenY })
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* synthetic tests may not own a native pointer */ }
  }

  const move = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (dragPointerId.current !== event.pointerId) return
    window.ta.pinCommand('move', { x: event.screenX, y: event.screenY })
  }

  const endMove = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (dragPointerId.current !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragPointerId.current = undefined
    window.ta.pinCommand('move-end')
  }

  return (
    <main className="pin-window">
      {image && <img src={image} alt="钉图" draggable={false} onPointerDown={beginMove} onPointerMove={move} onPointerUp={endMove} onPointerCancel={endMove} style={{ transform: `rotate(${rotation}deg) scaleX(${flipped ? -1 : 1})` }} />}
      <div className="pin-tools" onMouseEnter={() => window.ta.pinCommand('interactive')}>
        <button title="旋转" onClick={() => setRotation((value) => (value + 90) % 360)}>↻</button>
        <button title="水平翻转" onClick={() => setFlipped((value) => !value)}>↔</button>
        <label title="透明度"><span>◐</span><input type="range" min="20" max="100" value={opacity * 100} onChange={(event) => { const next = Number(event.target.value) / 100; setOpacity(next); window.ta.pinCommand('opacity', next) }} /></label>
        <button title="鼠标穿透（移到工具栏恢复）" onClick={() => window.ta.pinCommand('passthrough')}>⌁</button>
        <button title="关闭" onClick={() => window.ta.pinCommand('close')}>×</button>
      </div>
    </main>
  )
}
