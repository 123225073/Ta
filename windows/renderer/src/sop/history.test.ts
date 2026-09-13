import { test,expect } from 'vitest'
import { SopHistory } from './history'
import type { SopDocument } from '../../../electron/sop/model'
const doc=(title:string,revision=1)=>({schemaVersion:1,projectId:'test',revision,title,description:'',audience:'',detail:'standard',instructions:'',steps:[],transcript:[],chat:[],updatedAt:'now'}) as SopDocument
test('groups typing, preserves current disk revision and invalidates redo after branching',()=>{
  const h=new SopHistory(),a=doc('A'),b=doc('AB'),c=doc('ABC',5)
  h.record(a,b,'title',100);h.record(b,c,'title',200)
  const restored=h.travel(c)!;expect(restored.title).toBe('A');expect(restored.revision).toBe(5);expect(h.past).toHaveLength(0)
  expect(h.travel({...restored,revision:6},true)?.title).toBe('ABC')
  h.travel(c);h.record(restored,doc('new'));expect(h.future).toHaveLength(0)
})
test('AI transaction restores steps, images, chat and transcript together; autosave creates no edit',()=>{
  const h=new SopHistory(),a=doc('A'),b={...doc('B',2),chat:[{role:'assistant' as const,text:'edited'}],transcript:[{start:0,end:100,text:'speech'}]}
  h.record(a,{...a,revision:2});expect(h.past).toHaveLength(0)
  h.record(a,b);const r=h.travel(b)!;expect(r.chat).toEqual([]);expect(r.transcript).toEqual([]);expect(h.travel(r,true)).toEqual(b)
})
