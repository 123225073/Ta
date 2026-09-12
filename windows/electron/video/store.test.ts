import { describe,it,expect,vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {VideoStore} from './store'
describe('video project persistence',()=>{
  it('keeps old projects reachable after changing the destination and rejects path traversal',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-video-store-')),store=new VideoStore(path.join(root,'index'),path.join(root,'old'))
    const p=store.create(640,360,false,true);store.saveSettings({...store.settings,root:path.join(root,'new')})
    expect(store.get(p.id).width).toBe(640);expect(store.directory(p.id)).toContain(path.join(root,'old'))
    expect(()=>store.file(p.id,'../screen.mp4')).toThrow();expect(()=>store.directory('../elsewhere')).toThrow()
    expect(()=>store.save(p.id,p)).toThrow('录制完成')
  })
  it('recovers the last complete project file and never replaces source metadata from edits',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-video-recovery-')),store=new VideoStore(path.join(root,'index'),path.join(root,'media'))
    const p=store.create(640,360,false,false);p.status='ready';p.duration=3000;store.write(p)
    store.save(p.id,{...p,title:'编辑后的项目',duration:999999});expect(store.get(p.id).duration).toBe(3000)
    fs.writeFileSync(store.file(p.id,'project.json'),'{broken');expect(store.get(p.id).status).toBe('ready')
  })
  it('retries a transient Windows sharing lock without discarding either project version',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-video-lock-')),store=new VideoStore(path.join(root,'index'),path.join(root,'media')),p=store.create(640,360,false,false)
    p.status='ready';p.duration=3000;const original=fs.renameSync
    const rename=vi.spyOn(fs,'renameSync').mockImplementationOnce(()=>{throw Object.assign(Error('sharing lock'),{code:'EPERM'})}).mockImplementation(original)
    try{store.write(p);expect(store.get(p.id).duration).toBe(3000);expect(rename).toHaveBeenCalledTimes(2)}finally{rename.mockRestore()}
  })
})
