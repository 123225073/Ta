import { describe, expect, it } from 'vitest'
import {
  beginSelectionInteraction,
  updateSelectionInteraction,
  type SelectionRect,
} from './selection-geometry'

const bounds = { width: 1000, height: 700 }

describe('selection interaction', () => {
  it('keeps the rectangle selected after the initial drag is released', () => {
    const interaction = beginSelectionInteraction(undefined, { x: 100, y: 80 }, 'canvas')
    expect(updateSelectionInteraction(interaction, { x: 460, y: 330 }, bounds)).toEqual({
      x: 100,
      y: 80,
      width: 360,
      height: 250,
    })
  })

  it('moves an existing rectangle instead of starting a new selection', () => {
    const selection: SelectionRect = { x: 100, y: 80, width: 360, height: 250 }
    const interaction = beginSelectionInteraction(selection, { x: 240, y: 160 }, 'selection')

    expect(updateSelectionInteraction(interaction, { x: 300, y: 210 }, bounds)).toEqual({
      x: 160,
      y: 130,
      width: 360,
      height: 250,
    })
  })

  it('resizes from all four edges and four corners', () => {
    const selection: SelectionRect = { x: 100, y: 80, width: 360, height: 250 }
    const cases = [
      ['nw', { x: 100, y: 80 }, { x: 70, y: 50 }, { x: 70, y: 50, width: 390, height: 280 }],
      ['n', { x: 280, y: 80 }, { x: 280, y: 50 }, { x: 100, y: 50, width: 360, height: 280 }],
      ['ne', { x: 460, y: 80 }, { x: 500, y: 50 }, { x: 100, y: 50, width: 400, height: 280 }],
      ['e', { x: 460, y: 205 }, { x: 500, y: 205 }, { x: 100, y: 80, width: 400, height: 250 }],
      ['se', { x: 460, y: 330 }, { x: 500, y: 370 }, { x: 100, y: 80, width: 400, height: 290 }],
      ['s', { x: 280, y: 330 }, { x: 280, y: 370 }, { x: 100, y: 80, width: 360, height: 290 }],
      ['sw', { x: 100, y: 330 }, { x: 70, y: 370 }, { x: 70, y: 80, width: 390, height: 290 }],
      ['w', { x: 100, y: 205 }, { x: 70, y: 205 }, { x: 70, y: 80, width: 390, height: 250 }],
    ] as const

    for (const [handle, start, end, expected] of cases) {
      const interaction = beginSelectionInteraction(selection, start, handle)
      expect(updateSelectionInteraction(interaction, end, bounds)).toEqual(expected)
    }
  })

  it('keeps a moved rectangle inside the current display', () => {
    const selection: SelectionRect = { x: 850, y: 600, width: 120, height: 80 }
    const interaction = beginSelectionInteraction(selection, { x: 900, y: 630 }, 'selection')
    expect(updateSelectionInteraction(interaction, { x: 1100, y: 800 }, bounds)).toEqual({
      x: 880,
      y: 620,
      width: 120,
      height: 80,
    })
  })

  it('normalizes reverse dragging and clamps it to the display', () => {
    const interaction = beginSelectionInteraction(undefined, { x: 800, y: 600 }, 'canvas')
    expect(updateSelectionInteraction(interaction, { x: -300, y: -200 }, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    })
  })

  it('does not invert or lose a selection when a handle is dragged past its opposite edge', () => {
    const selection: SelectionRect = { x: 100, y: 80, width: 360, height: 250 }
    const adversarialPointers = [
      ['nw', { x: 100, y: 80 }, { x: 10_000, y: 10_000 }],
      ['ne', { x: 460, y: 80 }, { x: -10_000, y: 10_000 }],
      ['se', { x: 460, y: 330 }, { x: -10_000, y: -10_000 }],
      ['sw', { x: 100, y: 330 }, { x: 10_000, y: -10_000 }],
    ] as const

    for (const [handle, start, end] of adversarialPointers) {
      const interaction = beginSelectionInteraction(selection, start, handle)
      const result = updateSelectionInteraction(interaction, end, bounds)
      expect(result.width).toBeGreaterThanOrEqual(4)
      expect(result.height).toBeGreaterThanOrEqual(4)
      expect(result.x).toBeGreaterThanOrEqual(0)
      expect(result.y).toBeGreaterThanOrEqual(0)
      expect(result.x + result.width).toBeLessThanOrEqual(bounds.width)
      expect(result.y + result.height).toBeLessThanOrEqual(bounds.height)
    }
  })
})
