import type { Point, SelectionRect } from './selection-geometry'

export interface SmartSelectionRect extends SelectionRect {
  id: string
  kind: 'window' | 'screen'
  label?: string
}

export interface MaskRect extends SelectionRect {
  side: 'full' | 'top' | 'right' | 'bottom' | 'left'
}

export function findSmartSelection(candidates: SmartSelectionRect[] | undefined, point: Point) {
  return candidates?.find((candidate) => (
    candidate.width >= 4
    && candidate.height >= 4
    && point.x >= candidate.x
    && point.y >= candidate.y
    && point.x <= candidate.x + candidate.width
    && point.y <= candidate.y + candidate.height
  ))
}

export function createOutsideMasks(bounds: { width: number; height: number }, target?: SelectionRect): MaskRect[] {
  if (!target || target.width < 1 || target.height < 1) {
    return [{ side: 'full', x: 0, y: 0, width: bounds.width, height: bounds.height }]
  }
  const left = Math.max(0, Math.min(bounds.width, target.x))
  const top = Math.max(0, Math.min(bounds.height, target.y))
  const right = Math.max(left, Math.min(bounds.width, target.x + target.width))
  const bottom = Math.max(top, Math.min(bounds.height, target.y + target.height))
  const masks: MaskRect[] = [
    { side: 'top', x: 0, y: 0, width: bounds.width, height: top },
    { side: 'right', x: right, y: top, width: bounds.width - right, height: bottom - top },
    { side: 'bottom', x: 0, y: bottom, width: bounds.width, height: bounds.height - bottom },
    { side: 'left', x: 0, y: top, width: left, height: bottom - top },
  ]
  return masks.filter((rect) => rect.width > 0 && rect.height > 0)
}
