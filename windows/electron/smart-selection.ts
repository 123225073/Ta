import type { SmartSelectionRect } from './contracts'

export interface PhysicalWindowRect {
  handle: string
  processId: number
  z: number
  x: number
  y: number
  width: number
  height: number
  title?: string
  className?: string
}

export interface PhysicalScreenRect {
  x: number
  y: number
  width: number
  height: number
}

export interface LogicalDisplayRect {
  id: number
  bounds: { x: number; y: number; width: number; height: number }
}

export function mapWindowCandidatesToDisplay(
  display: LogicalDisplayRect,
  capturedScreen: PhysicalScreenRect,
  windows: PhysicalWindowRect[],
): SmartSelectionRect[] {
  const screenRight = capturedScreen.x + capturedScreen.width
  const screenBottom = capturedScreen.y + capturedScreen.height
  const scaleX = display.bounds.width / capturedScreen.width
  const scaleY = display.bounds.height / capturedScreen.height
  const mapped = [...windows].sort((left, right) => left.z - right.z).flatMap((window) => {
    const left = Math.max(capturedScreen.x, window.x)
    const top = Math.max(capturedScreen.y, window.y)
    const right = Math.min(screenRight, window.x + window.width)
    const bottom = Math.min(screenBottom, window.y + window.height)
    if (right - left < 4 || bottom - top < 4) return []
    const rect: SmartSelectionRect = {
      id: `window:${window.handle}:${display.id}`,
      kind: 'window',
      label: (window.title || window.className || '窗口').trim().slice(0, 160),
      x: Math.max(0, Math.round((left - capturedScreen.x) * scaleX)),
      y: Math.max(0, Math.round((top - capturedScreen.y) * scaleY)),
      width: Math.min(display.bounds.width, Math.max(1, Math.round((right - left) * scaleX))),
      height: Math.min(display.bounds.height, Math.max(1, Math.round((bottom - top) * scaleY))),
    }
    rect.width = Math.min(rect.width, display.bounds.width - rect.x)
    rect.height = Math.min(rect.height, display.bounds.height - rect.y)
    return rect.width >= 4 && rect.height >= 4 ? [rect] : []
  })
  mapped.push({
    id: `screen:${display.id}`,
    kind: 'screen',
    label: '当前屏幕',
    x: 0,
    y: 0,
    width: display.bounds.width,
    height: display.bounds.height,
  })
  return mapped
}
