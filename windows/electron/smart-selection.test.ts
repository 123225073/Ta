import { describe, expect, it } from 'vitest'
import { mapWindowCandidatesToDisplay } from './smart-selection'

describe('native window candidate mapping', () => {
  it('maps physical DWM bounds into display-local logical coordinates and preserves z-order', () => {
    const result = mapWindowCandidatesToDisplay(
      { id: 7, bounds: { x: 1920, y: 0, width: 1280, height: 720 } },
      { x: 1920, y: 0, width: 2560, height: 1440 },
      [
        { handle: '22', processId: 2, z: 1, x: 2120, y: 200, width: 1000, height: 600, title: 'Back' },
        { handle: '11', processId: 1, z: 0, x: 2020, y: 100, width: 600, height: 400, title: 'Front' },
      ],
    )
    expect(result[0]).toMatchObject({ id: 'window:11:7', x: 50, y: 50, width: 300, height: 200, label: 'Front' })
    expect(result[1]).toMatchObject({ id: 'window:22:7', x: 100, y: 100, width: 500, height: 300, label: 'Back' })
    expect(result.at(-1)).toMatchObject({ id: 'screen:7', kind: 'screen', width: 1280, height: 720 })
  })

  it('clips a spanning window to the current display and drops non-intersecting windows', () => {
    const result = mapWindowCandidatesToDisplay(
      { id: 2, bounds: { x: -1280, y: 0, width: 1280, height: 720 } },
      { x: -2560, y: 0, width: 2560, height: 1440 },
      [
        { handle: 'clip', processId: 3, z: 0, x: -2700, y: -100, width: 700, height: 500, title: 'Clipped' },
        { handle: 'other', processId: 4, z: 1, x: 100, y: 100, width: 500, height: 500, title: 'Other display' },
      ],
    )
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'window:clip:2', x: 0, y: 0, width: 280, height: 200 })
  })
})
