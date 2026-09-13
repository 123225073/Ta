import { test,expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { FeishuService,validateFeishu,type CliRunner } from './feishu'
import type { SopDocument } from './model'
const doc={projectId:'test',title:'A < B & C',description:'说明',audience:'新手',steps:[{title:'操作',body:'第一行\n第二行',expected:'结果',note:'提示',images:[{file:'sop-1234567890123456.png',caption:'截图',time:3000}]}]} as SopDocument
test('publishes escaped XML and relative images in order using user identity and wiki document id',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-feishu-test-')),calls:string[][]=[],bodies:string[]=[]
  const source=path.join(root,'image.png');fs.writeFileSync(source,'fixture')
  const run:CliRunner=async(_s,args,cwd)=>{calls.push(args);if(args[0]==='auth')return {verified:true,identity:'user',identities:{user:{status:'needs_refresh',userName:'test'}}};expect(args).toContain('user');if(args.includes('--content'))bodies.push(fs.readFileSync(path.join(cwd,'content.xml'),'utf8'));if(args.includes('--file'))expect(fs.readFileSync(path.join(cwd,args[args.indexOf('--file')+1]),'utf8')).toBe('fixture');return {ok:true,data:{document:{document_id:'abc123',url:'https://test.feishu.cn/wiki/wiki123'}}}}
  try{const service=new FeishuService(root,run);const r=await service.publish(doc,()=>source,()=>{});expect(r.complete).toBe(true);expect(r.images).toBe(1);expect(calls.map(a=>a[1])).toEqual(['status','+create','+update','+media-insert','+update','+fetch']);expect(bodies[0]).toContain('A &lt; B &amp; C');expect(bodies[1]).toContain('第一行<br/>第二行');expect(calls[3]).toContain('abc123')}
  finally{for(const name of fs.readdirSync(root))fs.unlinkSync(path.join(root,name));fs.rmdirSync(root)}
})
test('reports partial publish without retrying or deleting external document',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-feishu-test-'));const calls:string[][]=[]
  const run:CliRunner=async(_s,args)=>{calls.push(args);if(args[0]==='auth')return {verified:true,identity:'user',identities:{user:{status:'ready'}}};if(args[1]==='+create')return {ok:true,data:{document:{document_id:'abc123',url:'https://test.feishu.cn/docx/abc123'}}};throw Error('offline')}
  try{const r=await new FeishuService(root,run).publish({...doc,steps:doc.steps.map(s=>({...s,images:[]}))},()=>'',()=>{});expect(r.complete).toBe(false);expect(r.url).toContain('abc123');expect(calls).toHaveLength(3)}finally{for(const name of fs.readdirSync(root))fs.unlinkSync(path.join(root,name));fs.rmdirSync(root)}
})
test('rejects executable shell scripts and injected profile/target arguments',()=>{
  const s={executable:'',profile:'',parentToken:''};expect(()=>validateFeishu({...s,executable:'evil.cmd'})).toThrow();expect(()=>validateFeishu({...s,profile:'a --as bot'})).toThrow();expect(()=>validateFeishu({...s,parentToken:'https://example.org'})).toThrow()
})
