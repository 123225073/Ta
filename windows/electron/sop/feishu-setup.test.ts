import {test,expect,vi} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {FeishuSetup} from './feishu-setup'
const empty={executable:'',profile:'',parentToken:''}
test('detects existing profile without exposing app identifiers and reuses existing installation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-cli-setup-'));let settings={...empty,executable:process.execPath}
 const run=vi.fn(async()=>[{name:'work',user:'user',active:true,appId:'private-app-id'}]),setup=new FeishuSetup(root,()=>settings,s=>settings=s,run)
 try{const d=await setup.install();expect(d.installed).toBe(true);expect(settings.profile).toBe('work');expect(d.profiles).toEqual([{name:'work',user:'user',active:true}]);expect(run.mock.calls).toHaveLength(1)}finally{fs.rmdirSync(root)}
})
test('rejects unsigned or corrupted installer before extracting executables',async()=>{
 const setup=new FeishuSetup(os.tmpdir(),()=>empty,s=>s,async()=>[]);vi.spyOn(setup,'discover').mockResolvedValue({installed:false,version:'',profiles:[],settings:empty})
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({assets:[{name:'lark-cli-1.0.1-windows-amd64.zip',digest:'sha256:'+'0'.repeat(64),size:3,browser_download_url:'https://github.com/larksuite/cli/releases/download/v1.0.1/package.zip'}]})))
 try{fetch.mockResolvedValueOnce(new Response(JSON.stringify({assets:[]})));await expect(setup.install()).rejects.toThrow('校验信息');fetch.mockResolvedValueOnce(new Response(JSON.stringify({assets:[{name:'lark-cli-1.0.1-windows-amd64.zip',digest:'sha256:'+'0'.repeat(64),size:3,browser_download_url:'https://github.com/larksuite/cli/releases/download/v1.0.1/package.zip'}]}))).mockResolvedValueOnce(new Response('bad'));await expect(setup.install()).rejects.toThrow('校验失败')}finally{fetch.mockRestore()}
})
