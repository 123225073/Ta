import type { RecordingSource, Rect } from './bridge'

export type CaptureMode = 'screen' | 'window' | 'region'

export function selectAfterRefresh(sources: RecordingSource[], previous: string, mode: CaptureMode) {
  const candidates = sources.filter(source => source.kind === (mode === 'window' ? 'window' : 'screen'))
  if (previous) return candidates.some(source => source.id === previous) ? previous : ''
  return mode !== 'window' && candidates.length === 1 ? candidates[0].id : ''
}

export function validRegion(region: Rect | undefined, width: number, height: number) {
  return !!region && Object.values(region).every(Number.isInteger) && region.x >= 0 && region.y >= 0 &&
    region.width >= 16 && region.height >= 16 && region.x + region.width <= width && region.y + region.height <= height
}

export function sourceSize(source?: RecordingSource) {
  if (source?.physical) return source.physical
  if (source?.bounds) return { width: Math.round(source.bounds.width * source.scale), height: Math.round(source.bounds.height * source.scale) }
}
