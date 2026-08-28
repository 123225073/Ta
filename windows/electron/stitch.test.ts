import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { findVerticalOverlap, frameMeanDifference, stitchVerticalFrames } from './stitch'

async function makeScrollingFrames() {
  const width = 180
  const height = 880
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      pixels[offset] = (x * 17 + y * 7 + (y % 29) * 13) % 256
      pixels[offset + 1] = (x * 3 + y * 19 + (x % 17) * 11) % 256
      pixels[offset + 2] = (x * 23 + y * 5) % 256
    }
  }
  const master = sharp(pixels, { raw: { width, height, channels: 3 } })
  return Promise.all([0, 240, 480].map((top) => master.clone().extract({ left: 0, top, width, height: 400 }).png().toBuffer()))
}

describe('Windows long screenshot stitching', () => {
  it('detects unchanged frames', async () => {
    const [frame] = await makeScrollingFrames()
    expect(await frameMeanDifference(frame, frame)).toBe(0)
  })

  it('finds the vertical displacement between adjacent frames', async () => {
    const frames = await makeScrollingFrames()
    const match = await findVerticalOverlap(frames[0], frames[1])
    expect(match.shift).toBeGreaterThanOrEqual(238)
    expect(match.shift).toBeLessThanOrEqual(242)
    expect(match.score).toBeLessThan(1)
  })

  it('stitches scrolling frames without duplicating their overlap', async () => {
    const frames = await makeScrollingFrames()
    const { png, matches } = await stitchVerticalFrames(frames)
    const metadata = await sharp(png).metadata()
    expect(matches).toHaveLength(2)
    expect(metadata.width).toBe(180)
    expect(metadata.height).toBeGreaterThanOrEqual(876)
    expect(metadata.height).toBeLessThanOrEqual(884)
  })
})
