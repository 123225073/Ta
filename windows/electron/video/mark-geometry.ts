import {clamp,markFontSize,markTextLines,type Mark,type Rect} from './model'
export const textAdvance=(text:string,size:number)=>Array.from(text).reduce((n,ch)=>n+size*(/[\u0020-\u007e]/.test(ch)?.6:1),0)
export function markBounds(m:Mark):Rect {
  if(m.tool==='arrow')return {x:Math.min(m.x,m.x+m.width),y:Math.min(m.y,m.y+m.height),width:Math.abs(m.width),height:Math.abs(m.height)}
  if(m.tool==='text'){
    const size=markFontSize(m),lines=markTextLines(m)
    if(m.textDirection==='vertical')return {x:m.x,y:m.y,width:Math.max(size,lines.length*size*1.2),height:Math.max(size,...lines.map(s=>Array.from(s).length*size*1.2))}
    return {x:m.x,y:m.y,width:Math.max(size,...lines.map(s=>textAdvance(s,size)),m.textAutoSize!==false?0:m.width),height:Math.max(size*1.2,lines.length*size*1.2,m.textAutoSize!==false?0:m.height)}
  }
  return {x:m.x,y:m.y,width:Math.max(1,m.width),height:Math.max(1,m.height)}
}
export function moveMark(m:Mark,dx:number,dy:number,bounds:Rect):Mark {
  const b=markBounds(m);dx=clamp(dx,bounds.x-b.x,bounds.x+bounds.width-b.x-b.width);dy=clamp(dy,bounds.y-b.y,bounds.y+bounds.height-b.y-b.height)
  return {...m,x:m.x+dx,y:m.y+dy,points:m.points?.map(p=>({...p,x:p.x+dx,y:p.y+dy}))}
}
export function resizeMark(m:Mark,factor:number):Mark {
  factor=clamp(factor,.1,10);return {...m,width:m.width*factor,height:m.height*factor,fontSize:m.tool==='text'?clamp(markFontSize(m)*factor,8,1000):m.fontSize,points:m.points?.map(p=>({...p,x:m.x+(p.x-m.x)*factor,y:m.y+(p.y-m.y)*factor}))}
}
export function arrowEndpoint(m:Mark,end:'start'|'end',p:{x:number;y:number}):Mark {
  if(end==='end')return {...m,width:p.x-m.x,height:p.y-m.y}
  return {...m,x:p.x,y:p.y,width:m.x+m.width-p.x,height:m.y+m.height-p.y}
}
export const markAngle=(m:Mark)=>m.tool==='arrow'?Math.atan2(m.height,m.width)*180/Math.PI:m.rotation??0
export function rotateMark(m:Mark,angle:number):Mark {
  if(m.tool!=='arrow')return {...m,rotation:((angle+180)%360+360)%360-180}
  const r=Math.hypot(m.width,m.height)/2,cx=m.x+m.width/2,cy=m.y+m.height/2,dx=Math.cos(angle*Math.PI/180)*r,dy=Math.sin(angle*Math.PI/180)*r
  return {...m,x:cx-dx,y:cy-dy,width:dx*2,height:dy*2}
}
