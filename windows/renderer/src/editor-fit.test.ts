import { describe, expect, it } from 'vitest'
import { computeEditorFitScale } from './editor-fit'

describe('computeEditorFitScale', () => {
  it('fits a wide screenshot by height when height is the limiting edge', () => {
    expect(computeEditorFitScale(2612, 1526, 1123, 522)).toBeCloseTo(522 / 1526, 6)
  })

  it('fits a portrait screenshot by height without cropping', () => {
    expect(computeEditorFitScale(900, 2400, 1200, 600)).toBeCloseTo(0.25, 6)
  })

  it('never enlarges an image that already fits', () => {
    expect(computeEditorFitScale(640, 360, 1200, 700)).toBe(1)
  })

  it('keeps very large images fully visible below five percent when needed', () => {
    expect(computeEditorFitScale(20_000, 12_000, 800, 420)).toBeCloseTo(0.035, 6)
  })

  it('falls back safely while layout dimensions are not ready', () => {
    expect(computeEditorFitScale(2612, 1526, 0, 522)).toBe(1)
  })
})
