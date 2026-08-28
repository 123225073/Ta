import sharp from 'sharp'

export interface ImageContentStats {
  width: number
  height: number
  meanLuminance: number
  luminanceStdDev: number
  nearBlackRatio: number
  minLuminance: number
  maxLuminance: number
  opaqueRatio: number
  probablyTransparent: boolean
  probablyBlack: boolean
}

export function analyzePixelContent(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
  offsets: { red: number; green: number; blue: number; alpha?: number } = { red: 0, green: 1, blue: 2 },
): ImageContentStats {
  const pixelCount = Math.max(1, width * height)
  let sum = 0
  let sumSquares = 0
  let nearBlackPixels = 0
  let opaquePixels = 0
  let minLuminance = 255
  let maxLuminance = 0

  for (let offset = 0; offset < data.length; offset += channels) {
    const red = data[offset + offsets.red]
    const green = data[offset + offsets.green]
    const blue = data[offset + offsets.blue]
    const luminance = (77 * red + 150 * green + 29 * blue) / 256
    sum += luminance
    sumSquares += luminance * luminance
    minLuminance = Math.min(minLuminance, luminance)
    maxLuminance = Math.max(maxLuminance, luminance)
    if (red <= 12 && green <= 12 && blue <= 12) nearBlackPixels += 1
    if (offsets.alpha === undefined || data[offset + offsets.alpha] >= 250) opaquePixels += 1
  }

  const meanLuminance = sum / pixelCount
  const variance = Math.max(0, sumSquares / pixelCount - meanLuminance * meanLuminance)
  const luminanceStdDev = Math.sqrt(variance)
  const nearBlackRatio = nearBlackPixels / pixelCount
  const opaqueRatio = opaquePixels / pixelCount

  return {
    width,
    height,
    meanLuminance: Number(meanLuminance.toFixed(2)),
    luminanceStdDev: Number(luminanceStdDev.toFixed(2)),
    nearBlackRatio: Number(nearBlackRatio.toFixed(6)),
    minLuminance: Number(minLuminance.toFixed(2)),
    maxLuminance: Number(maxLuminance.toFixed(2)),
    opaqueRatio: Number(opaqueRatio.toFixed(6)),
    probablyTransparent: opaqueRatio < 0.99,
    probablyBlack: meanLuminance < 4 && luminanceStdDev < 4 && nearBlackRatio > 0.995,
  }
}

export async function analyzeImageContent(png: Buffer): Promise<ImageContentStats> {
  const { data, info } = await sharp(png)
    .resize({ width: 320, height: 180, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return analyzePixelContent(data, info.width, info.height, info.channels)
}
