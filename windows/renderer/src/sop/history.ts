import type { SopDocument } from '../../../electron/sop/model'
const content=(d:SopDocument)=>JSON.stringify({...d,revision:0,updatedAt:''})
export class SopHistory {
  past:SopDocument[]=[]
  future:SopDocument[]=[]
  private group:unknown
  private at=0
  record(before:SopDocument,after:SopDocument,group?:unknown,now=Date.now()) {
    if(content(before)===content(after))return
    if(!group||this.group!==group||now-this.at>800){this.past.push(structuredClone(before));if(this.past.length>100)this.past.shift()}
    this.group=group;this.at=now;this.future=[]
  }
  breakGroup(){this.group=undefined}
  travel(current:SopDocument,redo=false){
    const source=redo?this.future:this.past,target=redo?this.past:this.future,next=source.pop()
    if(!next)return
    target.push(structuredClone(current));this.breakGroup()
    return {...structuredClone(next),revision:current.revision,updatedAt:current.updatedAt}
  }
}
