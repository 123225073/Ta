import { describe, expect, it } from 'vitest'
import type { RecordingSource } from './bridge'
import { selectAfterRefresh, sourceSize, validRegion } from './recording-selection'

const screen: RecordingSource = { id:'screen:1', name:'主屏', kind:'screen', displayId:'1', scale:1.5, thumbnail:'', bounds:{x:0,y:0,width:1280,height:720} }
const windowA: RecordingSource = { id:'window:11', name:'A', kind:'window', displayId:'', scale:1, thumbnail:'' }
const windowB: RecordingSource = { ...windowA, id:'window:12', name:'B' }

describe('录制目标确认', () => {
  it('窗口即使只有一个也需要明确选择，关闭后不会自动提交另一窗口', () => {
    expect(selectAfterRefresh([screen,windowA], '', 'window')).toBe('')
    expect(selectAfterRefresh([windowA,windowB], windowB.id, 'window')).toBe(windowB.id)
    expect(selectAfterRefresh([screen,windowA], windowB.id, 'window')).toBe('')
  })
  it('允许唯一显示器作为默认目标，多屏或原显示器断开时需要重新确认', () => {
    const external = { ...screen, id:'screen:2', displayId:'2' }
    expect(selectAfterRefresh([screen,windowA], '', 'screen')).toBe(screen.id)
    expect(selectAfterRefresh([screen,external], '', 'region')).toBe('')
    expect(selectAfterRefresh([screen],external.id,'screen')).toBe('')
  })
  it('按物理像素核验区域，可在没有指针拖动时直接输入坐标', () => {
    expect(sourceSize(screen)).toMatchObject({width:1920,height:1080})
    const rect = {x:1904,y:1064,width:16,height:16}
    expect(validRegion(rect,1920,1080)).toBe(true)
    expect(validRegion({...rect,x:1905},1920,1080)).toBe(false)
    expect(validRegion({...rect,width:15},1920,1080)).toBe(false)
    expect(validRegion({...rect,height:Number.NaN},1920,1080)).toBe(false)
    expect(validRegion(undefined,1920,1080)).toBe(false)
  })
})
