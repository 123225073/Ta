// Adapted from westpoint-io/mimik src/core/export/utils.ts (MIT).
// Copyright (c) Westpoint. Full license: MIMIK-LICENSE.txt.
export function escapeHtml(text:string):string{return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
export function containFit(srcWidth:number,srcHeight:number,boxWidth:number,boxHeight:number){if(!(srcWidth>0)||!(srcHeight>0))return{width:boxWidth,height:boxHeight,x:0,y:0};const scale=Math.min(boxWidth/srcWidth,boxHeight/srcHeight),width=srcWidth*scale,height=srcHeight*scale;return{width,height,x:(boxWidth-width)/2,y:(boxHeight-height)/2}}
