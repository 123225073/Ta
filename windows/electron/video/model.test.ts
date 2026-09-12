import { describe,it,expect } from 'vitest'
import { keepSegments,viewportAt,previewToSource,sourceToPreview,sourceAt,outputAt,validateEdits,markSvg,type VideoProject } from './model'
const p:VideoProject={schemaVersion:1,id:'test',title:'测试',createdAt:'',revision:0,width:1920,height:1080,duration:10000,status:'ready',hasMic:false,hasSystem:false,marks:[],cuts:[{start:2000,end:4000}],mutes:[],zooms:[{id:'z',start:1000,end:7000,scale:2,cx:1100,cy:600}],crop:{x:200,y:100,width:1200,height:800},micVolume:1,systemVolume:1,exports:[]}
describe('OpenScreen source-time segment adaptation',()=>{
  it('nested and overlapping cuts never reintroduce deleted video',()=>expect(keepSegments(10000,[{start:2000,end:7000},{start:3000,end:4000},{start:6500,end:8000}])).toEqual([{start:0,end:2000},{start:8000,end:10000}]))
  it('audio, annotations and output time share the cut boundary',()=>{expect(sourceAt(p,2000)).toBe(4000);expect(outputAt(p,6000)).toBe(4000)})
  it('maps a new mark drawn in a cropped zoomed preview back to the same source',()=>{const v=viewportAt(p,5000),a=previewToSource(v,320,240,640,480);expect(sourceToPreview(v,a.x,a.y,1280,960)).toEqual({x:640,y:480});expect(viewportAt(p,8000)).toEqual(p.crop)})
  it('rejects immutable metadata replacement and invalid coordinates',()=>{expect(validateEdits({...p,id:'evil',width:10},p).id).toBe('test');expect(()=>validateEdits({...p,crop:{...p.crop,width:Infinity}},p)).toThrow();expect(()=>validateEdits({...p,cuts:[{start:0,end:10000}]},p)).toThrow()})
  it('escapes annotation text and rejects injected colors',()=>{const mark={id:'m',tool:'text' as const,x:10,y:10,width:20,height:20,start:0,end:1000,text:'<script>',stroke:3,color:'#ff0000',enabled:true};expect(markSvg(mark)).toContain('&lt;script&gt;');expect(()=>validateEdits({...p,marks:[{...mark,color:'url(file://a)'}]},p)).toThrow()})
})
