import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { analyzeImageContent } from './image-content'

describe('analyzeImageContent', () => {
  it('rejects a uniformly black desktop capture', async () => {
    const png = await sharp({
      create: { width: 640, height: 360, channels: 3, background: '#000000' },
    }).png().toBuffer()

    const stats = await analyzeImageContent(png)

    expect(stats.probablyBlack).toBe(true)
    expect(stats.nearBlackRatio).toBe(1)
  })

  it('accepts dark screenshots that still contain visible content', async () => {
    const svg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
        <rect width="640" height="360" fill="#050505"/>
        <rect x="40" y="40" width="260" height="120" fill="#14c86e"/>
        <text x="50" y="260" fill="#ffffff" font-size="48">TA WINDOWS</text>
      </svg>
    `)
    const png = await sharp(svg).png().toBuffer()

    const stats = await analyzeImageContent(png)

    expect(stats.probablyBlack).toBe(false)
    expect(stats.luminanceStdDev).toBeGreaterThan(4)
  })
})
