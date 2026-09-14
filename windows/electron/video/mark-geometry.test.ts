import {describe,it,expect} from 'vitest'
import {markBounds,arrowEndpoint,moveMark,resizeMark,rotateMark} from './mark-geometry'
import {markSvg,markTextLines,type Mark} from './model'
const mark:Mark={id:'m',tool:'arrow',x:300,y:200,width:100,height:50,color:'#FF4D37',stroke:4,text:'',enabled:true,start:0,end:1000}
describe('standard annotation geometry',()=>{
  it.each([[100,0],[-100,0],[0,100],[0,-100],[100,100],[-100,100],[100,-100],[-100,-100]])('preserves arrow direction %s %s',(dx,dy)=>{const m=arrowEndpoint(mark,'end',{x:300+dx,y:200+dy}),b=markBounds(m);expect(m.width).toBe(dx);expect(m.height).toBe(dy);expect(b.width).toBe(Math.abs(dx));expect(markSvg(m)).toContain(`L${300+dx},${200+dy}`)})
  it('moves the starting handle without moving the tip',()=>{const m=arrowEndpoint(mark,'start',{x:420,y:280});expect(m.x+m.width).toBe(400);expect(m.y+m.height).toBe(250);expect(m.width).toBe(-20)})
  it('rotates and scales an arrow while preserving its center and length',()=>{const m=rotateMark(mark,180);expect(Math.hypot(m.width,m.height)).toBeCloseTo(Math.hypot(100,50));expect(m.x+m.width/2).toBe(350);expect(resizeMark(m,2).width).toBe(m.width*2)})
  it('moves actual pen points with the selection',()=>{const m=moveMark({...mark,tool:'pen',points:[{x:300,y:200},{x:400,y:250}]},20,10,{x:0,y:0,width:640,height:360});expect(m.points?.[0]).toEqual({x:320,y:210})})
  it('does not force point text into a narrow drawn rectangle',()=>{const m={...mark,tool:'text' as const,fontSize:32,textAutoSize:true,text:'这里需要勾选',width:20};expect(markTextLines(m)).toEqual(['这里需要勾选']);expect(markBounds(m).width).toBe(192);expect(markSvg({...m,rotation:90})).toContain('rotate(90')})
  it('opens old narrow text without accidental wrapping and retains explicit wrapping',()=>{const m={...mark,tool:'text' as const,fontSize:32,text:'这里需要勾选',width:64};expect(markTextLines(m)).toEqual(['这里需要勾选']);expect(markTextLines({...m,textAutoSize:false})).toHaveLength(3)})
  it('lays vertical text into explicit glyph positions for preview and export',()=>{const m={...mark,tool:'text' as const,fontSize:32,textAutoSize:true,textDirection:'vertical' as const,text:'第一步'};expect(markBounds(m).height).toBeCloseTo(115.2);expect(markSvg(m).match(/<tspan /g)).toHaveLength(3)})
  it('keeps old fluorescent strokes and creates new spotlight holes',()=>{expect(markSvg({...mark,tool:'highlight'})).toContain('polyline');expect(markSvg({...mark,tool:'highlight',highlightMode:'spotlight',dimOpacity:.7})).toContain('fill-rule="evenodd"')})
})
