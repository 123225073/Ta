import {describe,it,expect} from 'vitest'
import {RecordingHealth,type CaptureHealth} from './health'
const ok:CaptureHealth={frames:100,black:false,videoAgeMs:10,systemPeak:.2,micPeak:0}
describe('recording health',()=>{
  it('ignores brief transitions, alerts sustained black, rate limits and resets',()=>{const h=new RecordingHealth();expect(h.check({...ok,black:true},1000,true,false)).toEqual([]);expect(h.check(ok,3000,true,false)).toEqual([]);expect(h.check({...ok,black:true},4000,true,false)).toEqual([]);expect(h.check({...ok,black:true},8000,true,false)[0]).toContain('黑画面');expect(h.check({...ok,black:true},9000,true,false)).toEqual([]);h.reset();expect(h.check(ok,10000,true,false)).toEqual([])})
  it('detects dead capture independently of audio, while not interpreting a static image as black',()=>{const h=new RecordingHealth();expect(h.check({...ok,videoAgeMs:8000},1000,true,false)[0]).toContain('没有更新');expect(h.check(ok,2000,true,false)).toEqual([])})
  it('warns on silence only for enabled tracks and preserves audio-only activity',()=>{const h=new RecordingHealth(),silent={...ok,systemPeak:0};h.check(silent,1000,true,false);expect(h.check(silent,30000,true,false)[0]).toContain('30 秒');h.reset();h.check(silent,1000,false,false);expect(h.check(silent,40000,false,false)).toEqual([]);h.reset();h.check({...silent,micPeak:.1},1000,true,true);expect(h.check({...silent,micPeak:.1},40000,true,true)).toEqual([])})
})
