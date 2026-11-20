import {describe,it,expect} from 'vitest'
import {DEFAULT_RECORDING_QUALITY,recordingBitrate,estimateRecordingMBPerMinute,exportBitrate,finalizationReserve} from './recording-quality'

describe('recording and export quality',()=>{
  it('keeps full-size office capture below the legacy target and uses the same preset for an edited export',()=>{
    expect(recordingBitrate(DEFAULT_RECORDING_QUALITY,1920,1080)).toBe(8_000_000)
    expect(recordingBitrate('compact',1920,1080)).toBe(4_000_000)
    expect(recordingBitrate('original',1920,1080)).toBe(18_000_000)
    expect(recordingBitrate('original',3840,2160)).toBe(45_000_000)
    expect(exportBitrate('compact',3840,2160)).toBe(recordingBitrate('compact',3840,2160))
    expect(exportBitrate(undefined,1920,1080)).toBe(1920*1080*6)
    expect(recordingBitrate('compact',320,180)).toBe(750_000)
  })
  it('includes the reusable mix and actual side tracks in decimal MB and reserves room for finalization',()=>{
    expect(estimateRecordingMBPerMinute('balanced',1920,1080,false,false)).toBe(60)
    expect(estimateRecordingMBPerMinute('balanced',1920,1080,true,false)).toBe(61.44)
    expect(estimateRecordingMBPerMinute('balanced',1920,1080,true,true)).toBe(63.36)
    expect(finalizationReserve(1_000_000_000,60_000,true,true)).toBe(512*1024*1024+1_003_360_000)
  })
})
