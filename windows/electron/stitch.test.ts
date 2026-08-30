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

async function makeFramesWithFixedBrowserChrome() {
  const width = 180
  const fixedTop = 48
  const fixedBottom = 32
  const viewportHeight = 400
  const frameHeight = fixedTop + viewportHeight + fixedBottom
  const scrollOffsets = [0, 240, 480]
  const contentHeight = viewportHeight + scrollOffsets.at(-1)!
  const contentPixels = Buffer.alloc(width * contentHeight * 3)
  for (let y = 0; y < contentHeight; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      contentPixels[offset] = (x * 17 + y * 7 + (y % 29) * 13) % 256
      contentPixels[offset + 1] = (x * 3 + y * 19 + (x % 17) * 11) % 256
      contentPixels[offset + 2] = (x * 23 + y * 5) % 256
    }
  }
  const content = sharp(contentPixels, { raw: { width, height: contentHeight, channels: 3 } })
  const toolbar = await sharp({ create: { width, height: fixedTop, channels: 3, background: { r: 28, g: 31, b: 38 } } }).png().toBuffer()
  const statusbar = await sharp({ create: { width, height: fixedBottom, channels: 3, background: { r: 51, g: 43, b: 78 } } }).png().toBuffer()
  const frames = await Promise.all(scrollOffsets.map(async (scrollTop) => {
    const viewport = await content.clone().extract({ left: 0, top: scrollTop, width, height: viewportHeight }).png().toBuffer()
    return sharp({ create: { width, height: frameHeight, channels: 3, background: '#fff' } })
      .composite([{ input: toolbar, top: 0, left: 0 }, { input: viewport, top: fixedTop, left: 0 }, { input: statusbar, top: fixedTop + viewportHeight, left: 0 }])
      .png().toBuffer()
  }))
  return { frames, width, fixedTop, fixedBottom, expectedHeight: fixedTop + contentHeight + fixedBottom }
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

  it('keeps fixed browser chrome only once while stitching the selected scrolling region', async () => {
    const fixture = await makeFramesWithFixedBrowserChrome()
    const { png, matches, fixedBands } = await stitchVerticalFrames(fixture.frames)
    const output = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let toolbarRows = 0
    let statusbarRows = 0
    for (let y = 0; y < output.info.height; y += 1) {
      const offset = y * output.info.width * output.info.channels
      const [red, green, blue] = output.data.subarray(offset, offset + 3)
      if (red === 28 && green === 31 && blue === 38) toolbarRows += 1
      if (red === 51 && green === 43 && blue === 78) statusbarRows += 1
    }
    expect(toolbarRows).toBe(fixture.fixedTop)
    expect(statusbarRows).toBe(fixture.fixedBottom)
    expect(fixedBands).toEqual({ top: fixture.fixedTop, bottom: fixture.fixedBottom })
    expect(matches).toHaveLength(2)
    for (const match of matches) {
      expect(match.shift).toBeGreaterThanOrEqual(238)
      expect(match.shift).toBeLessThanOrEqual(242)
    }
    expect(output.info.width).toBe(fixture.width)
    expect(output.info.height).toBeGreaterThanOrEqual(fixture.expectedHeight - 16)
    expect(output.info.height).toBeLessThanOrEqual(fixture.expectedHeight + 16)
  })
})
