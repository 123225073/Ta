import sharp from 'sharp'

export interface StitchMatch {
  overlap: number
  score: number
  shift: number
}

export interface FixedBands {
  top: number
  bottom: number
}

export async function frameMeanDifference(firstPng: Buffer, secondPng: Buffer): Promise<number> {
  const first = await sharp(firstPng).resize({ width: 240, withoutEnlargement: true }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const second = await sharp(secondPng).resize(first.info.width, first.info.height).greyscale().raw().toBuffer()
  let total = 0
  for (let index = 0; index < first.data.length; index += 3) total += Math.abs(first.data[index] - second[index])
  return total / Math.ceil(first.data.length / 3)
}

async function sampledDifference(previous: Buffer, current: Buffer, width: number, height: number, shift: number) {
  const overlap = height - shift
  const xStart = Math.floor(width * 0.12)
  const xEnd = Math.ceil(width * 0.88)
  let total = 0
  let samples = 0
  const xStep = Math.max(3, Math.floor(width / 220))
  const yStep = Math.max(3, Math.floor(height / 160))
  for (let y = Math.floor(overlap * 0.08); y < Math.floor(overlap * 0.92); y += yStep) {
    const previousOffset = (y + shift) * width
    const currentOffset = y * width
    for (let x = xStart; x < xEnd; x += xStep) {
      total += Math.abs(previous[previousOffset + x] - current[currentOffset + x])
      samples += 1
    }
  }
  return samples ? total / samples : Number.POSITIVE_INFINITY
}

export async function findVerticalOverlap(previousPng: Buffer, currentPng: Buffer): Promise<StitchMatch> {
  const previousInfo = await sharp(previousPng).greyscale().raw().toBuffer({ resolveWithObject: true })
  const currentInfo = await sharp(currentPng).resize(previousInfo.info.width, previousInfo.info.height).greyscale().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = previousInfo.info
  let best: StitchMatch = { overlap: 0, score: Number.POSITIVE_INFINITY, shift: height }
  const minimumShift = Math.max(12, Math.floor(height * 0.08))
  const maximumShift = Math.floor(height * 0.88)
  const coarseStep = Math.max(4, Math.floor(height / 110))

  for (let shift = minimumShift; shift <= maximumShift; shift += coarseStep) {
    const score = await sampledDifference(previousInfo.data, currentInfo.data, width, height, shift)
    if (score < best.score) best = { overlap: height - shift, score, shift }
  }

  const start = Math.max(minimumShift, best.shift - coarseStep)
  const end = Math.min(maximumShift, best.shift + coarseStep)
  for (let shift = start; shift <= end; shift += 1) {
    const score = await sampledDifference(previousInfo.data, currentInfo.data, width, height, shift)
    if (score < best.score) best = { overlap: height - shift, score, shift }
  }
  return best
}

async function detectFixedBands(frames: Buffer[], width: number, height: number): Promise<FixedBands> {
  if (frames.length < 2 || height < 80) return { top: 0, bottom: 0 }
  const probeIndexes = [...new Set([0, 1, Math.floor((frames.length - 1) / 2), frames.length - 1])]
  const probes = await Promise.all(probeIndexes.map((index) => sharp(frames[index])
    .resize({ width: Math.min(360, width), withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })))
  const sampleWidth = probes[0].info.width
  const sampleHeight = probes[0].info.height
  if (!sampleWidth || !sampleHeight || probes.some((probe) => probe.info.width !== sampleWidth || probe.info.height !== sampleHeight)) return { top: 0, bottom: 0 }
  const xStart = Math.floor(sampleWidth * .04)
  const xEnd = Math.ceil(sampleWidth * .96)
  const xStep = Math.max(1, Math.floor(sampleWidth / 180))
  const rowIsStatic = (y: number) => {
    let similar = 0
    let comparisons = 0
    const first = probes[0].data
    for (let probeIndex = 1; probeIndex < probes.length; probeIndex += 1) {
      const candidate = probes[probeIndex].data
      for (let x = xStart; x < xEnd; x += xStep) {
        if (Math.abs(first[y * sampleWidth + x] - candidate[y * sampleWidth + x]) <= 7) similar += 1
        comparisons += 1
      }
    }
    return comparisons > 0 && similar / comparisons >= .94
  }
  const maximumBand = Math.floor(sampleHeight * .35)
  const minimumBand = Math.max(4, Math.floor(sampleHeight * .018))
  const scanFromEdge = (fromTop: boolean) => {
    let boundary = 0
    let dynamicStreak = 0
    for (let offset = 0; offset < maximumBand; offset += 1) {
      const y = fromTop ? offset : sampleHeight - 1 - offset
      if (rowIsStatic(y)) {
        boundary = offset + 1
        dynamicStreak = 0
      } else {
        dynamicStreak += 1
        if (dynamicStreak >= 3) break
      }
    }
    if (boundary < minimumBand) return 0
    return Math.min(height - 1, Math.round(boundary * height / sampleHeight))
  }
  const top = scanFromEdge(true)
  const bottom = scanFromEdge(false)
  if (top + bottom > height * .55 || height - top - bottom < 32) return { top: 0, bottom: 0 }
  return { top, bottom }
}

async function stitchScrollableFrames(frames: Buffer[], width: number, height: number) {
  if (!frames.length) throw new Error('没有可拼接的截图帧。')
  if (frames.length === 1) return { png: frames[0], matches: [] }

  const matches: StitchMatch[] = []
  const additions: Array<{ input: Buffer; top: number; left: number }> = [{ input: frames[0], top: 0, left: 0 }]
  let totalHeight = height
  for (let index = 1; index < frames.length; index += 1) {
    const match = await findVerticalOverlap(frames[index - 1], frames[index])
    matches.push(match)
    const safeOverlap = match.score <= 38 ? match.overlap : 0
    const sliceTop = Math.max(0, Math.min(height - 1, safeOverlap))
    const sliceHeight = height - sliceTop
    const slice = await sharp(frames[index]).resize(width, height).extract({ left: 0, top: sliceTop, width, height: sliceHeight }).png().toBuffer()
    additions.push({ input: slice, top: totalHeight, left: 0 })
    totalHeight += sliceHeight
  }

  const png = await sharp({
    create: { width, height: totalHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).composite(additions).png().toBuffer()
  return { png, matches }
}

export async function stitchVerticalFrames(frames: Buffer[]): Promise<{ png: Buffer; matches: StitchMatch[]; fixedBands: FixedBands }> {
  if (!frames.length) throw new Error('没有可拼接的截图帧。')
  const firstMeta = await sharp(frames[0]).metadata()
  const width = firstMeta.width ?? 0
  const height = firstMeta.height ?? 0
  if (!width || !height) throw new Error('无法读取长截图尺寸。')
  if (frames.length === 1) return { png: frames[0], matches: [], fixedBands: { top: 0, bottom: 0 } }

  const fixedBands = await detectFixedBands(frames, width, height)
  if (!fixedBands.top && !fixedBands.bottom) {
    const stitched = await stitchScrollableFrames(frames, width, height)
    return { ...stitched, fixedBands }
  }

  const coreHeight = height - fixedBands.top - fixedBands.bottom
  const cores = await Promise.all(frames.map((frame) => sharp(frame)
    .extract({ left: 0, top: fixedBands.top, width, height: coreHeight })
    .png()
    .toBuffer()))
  const core = await stitchScrollableFrames(cores, width, coreHeight)
  const coreMeta = await sharp(core.png).metadata()
  const stitchedCoreHeight = coreMeta.height ?? coreHeight
  const additions: Array<{ input: Buffer; top: number; left: number }> = []
  let outputTop = 0
  if (fixedBands.top) {
    additions.push({ input: await sharp(frames[0]).extract({ left: 0, top: 0, width, height: fixedBands.top }).png().toBuffer(), top: outputTop, left: 0 })
    outputTop += fixedBands.top
  }
  additions.push({ input: core.png, top: outputTop, left: 0 })
  outputTop += stitchedCoreHeight
  if (fixedBands.bottom) {
    additions.push({ input: await sharp(frames.at(-1)!).extract({ left: 0, top: height - fixedBands.bottom, width, height: fixedBands.bottom }).png().toBuffer(), top: outputTop, left: 0 })
    outputTop += fixedBands.bottom
  }
  const png = await sharp({
    create: { width, height: outputTop, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).composite(additions).png().toBuffer()
  return { png, matches: core.matches, fixedBands }
}
