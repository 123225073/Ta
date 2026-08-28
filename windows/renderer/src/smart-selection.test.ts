import { describe, expect, it } from 'vitest'
import { createOutsideMasks, findSmartSelection, type SmartSelectionRect } from './smart-selection'

const candidates: SmartSelectionRect[] = [
  { id: 'front', kind: 'window', label: 'Front', x: 20, y: 20, width: 200, height: 120 },
  { id: 'back', kind: 'window', label: 'Back', x: 0, y: 0, width: 400, height: 300 },
  { id: 'screen', kind: 'screen', x: 0, y: 0, width: 800, height: 600 },
]

describe('smart screenshot selection', () => {
  it('uses z-order and picks the first visible candidate below the pointer', () => {
    expect(findSmartSelection(candidates, { x: 80, y: 70 })?.id).toBe('front')
    expect(findSmartSelection(candidates, { x: 300, y: 200 })?.id).toBe('back')
    expect(findSmartSelection(candidates, { x: 700, y: 500 })?.id).toBe('screen')
  })

  it('does not pick an out-of-bounds or unusably small candidate', () => {
    expect(findSmartSelection([{ id: 'tiny', kind: 'window', x: 0, y: 0, width: 2, height: 2 }], { x: 1, y: 1 })).toBeUndefined()
    expect(findSmartSelection(candidates, { x: -1, y: 40 })).toBeUndefined()
  })

  it('creates four non-overlapping masks and leaves the target uncovered', () => {
    const masks = createOutsideMasks({ width: 800, height: 600 }, { x: 100, y: 80, width: 300, height: 220 })
    expect(masks).toEqual([
      { side: 'top', x: 0, y: 0, width: 800, height: 80 },
      { side: 'right', x: 400, y: 80, width: 400, height: 220 },
      { side: 'bottom', x: 0, y: 300, width: 800, height: 300 },
      { side: 'left', x: 0, y: 80, width: 100, height: 220 },
    ])
    expect(masks.some((rect) => 200 >= rect.x && 200 <= rect.x + rect.width && 150 >= rect.y && 150 <= rect.y + rect.height)).toBe(false)
  })

  it('dims the whole screen until a target is available and clamps edge targets', () => {
    expect(createOutsideMasks({ width: 800, height: 600 })).toEqual([
      { side: 'full', x: 0, y: 0, width: 800, height: 600 },
    ])
    expect(createOutsideMasks({ width: 800, height: 600 }, { x: -30, y: -20, width: 100, height: 80 }))
      .toEqual([
        { side: 'right', x: 70, y: 0, width: 730, height: 60 },
        { side: 'bottom', x: 0, y: 60, width: 800, height: 540 },
      ])
  })
})
