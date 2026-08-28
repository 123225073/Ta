export type Point = { x: number; y: number }
export type SelectionRect = { x: number; y: number; width: number; height: number }
export type SelectionBounds = { width: number; height: number }
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export type InteractionTarget = 'canvas' | 'selection' | ResizeHandle

export type SelectionInteraction =
  | { mode: 'creating'; origin: Point }
  | { mode: 'moving'; origin: Point; initial: SelectionRect }
  | { mode: 'resizing'; origin: Point; initial: SelectionRect; handle: ResizeHandle }

const MIN_SELECTION_SIZE = 4

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function clampPoint(point: Point, bounds: SelectionBounds): Point {
  return {
    x: clamp(point.x, 0, bounds.width),
    y: clamp(point.y, 0, bounds.height),
  }
}

export function beginSelectionInteraction(
  selection: SelectionRect | undefined,
  origin: Point,
  target: InteractionTarget,
): SelectionInteraction {
  if (selection && target === 'selection') return { mode: 'moving', origin, initial: selection }
  if (selection && target !== 'canvas' && target !== 'selection') {
    return { mode: 'resizing', origin, initial: selection, handle: target }
  }
  return { mode: 'creating', origin }
}

export function updateSelectionInteraction(
  interaction: SelectionInteraction,
  pointer: Point,
  bounds: SelectionBounds,
): SelectionRect {
  const point = clampPoint(pointer, bounds)

  if (interaction.mode === 'creating') {
    const origin = clampPoint(interaction.origin, bounds)
    return {
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      width: Math.abs(point.x - origin.x),
      height: Math.abs(point.y - origin.y),
    }
  }

  const { initial, origin } = interaction
  const deltaX = point.x - origin.x
  const deltaY = point.y - origin.y

  if (interaction.mode === 'moving') {
    return {
      x: clamp(initial.x + deltaX, 0, Math.max(0, bounds.width - initial.width)),
      y: clamp(initial.y + deltaY, 0, Math.max(0, bounds.height - initial.height)),
      width: initial.width,
      height: initial.height,
    }
  }

  let left = initial.x
  let top = initial.y
  let right = initial.x + initial.width
  let bottom = initial.y + initial.height

  if (interaction.handle.includes('w')) left = clamp(initial.x + deltaX, 0, right - MIN_SELECTION_SIZE)
  if (interaction.handle.includes('e')) right = clamp(initial.x + initial.width + deltaX, left + MIN_SELECTION_SIZE, bounds.width)
  if (interaction.handle.includes('n')) top = clamp(initial.y + deltaY, 0, bottom - MIN_SELECTION_SIZE)
  if (interaction.handle.includes('s')) bottom = clamp(initial.y + initial.height + deltaY, top + MIN_SELECTION_SIZE, bounds.height)

  return { x: left, y: top, width: right - left, height: bottom - top }
}
