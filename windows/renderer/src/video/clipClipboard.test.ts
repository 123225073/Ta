import {describe,it,expect} from 'vitest'
import {copyClips,pasteClips} from './clipClipboard'
import {makeClip,type Timeline} from '../../../electron/video/timeline'
import {markSvg,markTextLines,type Mark} from '../../../electron/video/model'
import {allowEditorPermission} from '../../../electron/video/permissions'
describe('editor operations',()=>{
  it('copies linked recording audio with fresh identities and keeps the source untouched',()=>{
    const video={...makeClip('v','video','screen.mp4',6000,1000),link:'group'},audio={...makeClip('a','audio','mic.wav',6000,1000),link:'group'}
    const t:Timeline={version:1,tracks:[{id:'v1',name:'video',kind:'video',muted:false,clips:[video]},{id:'a1',name:'audio',kind:'audio',muted:false,clips:[audio]},{id:'v2',name:'video2',kind:'video',muted:false,clips:[]}]}
    let id=0;const result=pasteClips(t,copyClips(t,'v')!,'v2',9000,()=>String(++id)),v=result.timeline.tracks[2].clips[0],a=result.timeline.tracks[1].clips[1]
    expect(v.start).toBe(9000);expect(a.start).toBe(9000);expect(v.link).toBe(a.link);expect(v.link).not.toBe(video.link);expect(v.asset).toBe('screen.mp4');expect(t.tracks[2].clips).toHaveLength(0)
  })
  it('pastes a mark into a second track of the same kind without sharing mutable keys',()=>{
    const c={...makeClip('m','mark','',3000),keys:[{time:0,scale:2,cx:.5,cy:.5}]},t:Timeline={version:1,tracks:[{id:'m1',name:'mark',kind:'mark',muted:false,clips:[c]},{id:'m2',name:'mark2',kind:'mark',muted:false,clips:[]}]}
    const data=copyClips(t,'m')!;c.keys[0].scale=3;const result=pasteClips(t,data,'m2',1000,()=> 'new');expect(result.timeline.tracks[1].clips[0].keys[0].scale).toBe(2)
  })
  it('wraps text and escapes markup in the common preview/export renderer',()=>{
    const m:Mark={id:'m',tool:'text',color:'#FFFFFF',stroke:3,text:'教程文字\n<test>',fontSize:40,textAutoSize:false,enabled:true,start:0,end:1000,x:0,y:0,width:80,height:200}
    expect(markTextLines(m).slice(0,2)).toEqual(['教程','文字']);expect(markSvg(m)).toContain('font-size="40"');expect(markSvg(m)).not.toContain('<test>');expect(markSvg({...m,fontSize:undefined})).toContain('font-size="20"')
  })
  it('allows fullscreen only for the actual editor',()=>{expect(allowEditorPermission('fullscreen',4,4)).toBe(true);expect(allowEditorPermission('fullscreen',3,4)).toBe(false);expect(allowEditorPermission('media',4,4)).toBe(false);expect(allowEditorPermission('fullscreen',undefined,undefined)).toBe(false)})
})
