export const RECORDING_QUALITIES = [
  {id:'compact', label:'省空间'},
  {id:'balanced', label:'办公均衡'},
  {id:'original', label:'高画质'},
] as const

export type RecordingQuality = typeof RECORDING_QUALITIES[number]['id']
export const DEFAULT_RECORDING_QUALITY: RecordingQuality = 'balanced'
export function isRecordingQuality(value: unknown): value is RecordingQuality {
  return RECORDING_QUALITIES.some(preset => preset.id === value)
}

/** 30 fps H.264 targets in bits/s. Keep native pixels for small text at all three settings. */
export function recordingBitrate(quality: RecordingQuality, width: number, height: number) {
  const pixels = width * height
  if (quality === 'original') {
    return pixels >= 3840*2160 ? 45_000_000 : pixels >= 2560*1440 ? 28_000_000 : 18_000_000
  }
  const relativeArea = pixels / (1920*1080)
  const compact = Math.round(Math.max(0.75, Math.min(12, 4*relativeArea)) * 1_000_000)
  return quality === 'compact' ? compact : compact*2
}

/** Decimal MB of the canonical MP4; the default mix is 192 kb/s and dual capture adds two 128 kb/s tracks. */
function audioBitrate(mic:boolean, system:boolean) {
  return mic && system ? 448_000 : mic || system ? 192_000 : 0
}

export function estimateRecordingMBPerMinute(quality: RecordingQuality, width:number, height:number, mic:boolean, system:boolean) {
  return (recordingBitrate(quality, width, height) + audioBitrate(mic,system)) * 60 / 8_000_000
}

/** Finalization remuxes the screen stream into a new file before the drafts can be removed. */
export function finalizationReserve(videoBytes:number, elapsedMs:number, mic:boolean, system:boolean) {
  const encodedAudioBytes=audioBitrate(mic,system)*elapsedMs/8000
  return 512*1024*1024 + videoBytes + encodedAudioBytes
}

/** Older and imported projects retain the export targets they were created with. */
export function exportBitrate(quality: RecordingQuality | undefined, width:number, height:number) {
  return quality ? recordingBitrate(quality, width, height) : Math.max(3_000_000,width*height*6)
}
