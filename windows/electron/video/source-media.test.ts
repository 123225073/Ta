import {describe,it,expect} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {SourceMedia,mediaName} from './source-media'
import {VideoStore} from './store'
describe('ready originals',()=>{
 it('makes safe names while retaining Chinese and removing duplicate extensions',()=>{expect(mediaName('示范.mp4')).toBe('示范.mp4');expect(mediaName('CON')).toBe('_CON.mp4');expect(mediaName('../录音:一',true)).toBe('..-录音-一.mp3')})
 it('serializes copy and rename, keeps dates and avoids overwriting files',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-source-test-'));try{const store=new VideoStore(path.join(root,'meta'),path.join(root,'media')),p=store.create(640,480,false,false);p.status='ready';p.sourceFile='旧名.mp4';store.write(p);const dir=path.join(store.directory(p.id),'原片');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,p.sourceFile),'fixture');const service=new SourceMedia('',store);
   await Promise.all([service.copy(p.id,path.join(root,'copy.mp4')),service.rename(p.id,'新名字')]);expect(fs.readFileSync(path.join(root,'copy.mp4'),'utf8')).toBe('fixture');expect(path.basename(store.media(p.id,'source'))).toBe('新名字.mp4');expect(store.get(p.id).createdAt).toBe(p.createdAt);await expect(service.copy(p.id,path.join(root,'copy.mp4'))).rejects.toThrow();fs.writeFileSync(path.join(dir,'冲突.mp4'),'unrelated');await expect(service.rename(p.id,'冲突')).rejects.toThrow();expect(store.get(p.id).title).toBe('新名字');expect(fs.readFileSync(path.join(dir,'冲突.mp4'),'utf8')).toBe('unrelated');await expect(service.rename(p.id,' ')).rejects.toThrow();
  }finally{fs.rmSync(root,{recursive:true,force:true})}
 })
 it('does not prepare an active recording or allow a stored path escape',async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-source-test-'));try{const store=new VideoStore(path.join(root,'meta'),path.join(root,'media')),p=store.create(640,480,false,false);await expect(new SourceMedia('',store).ensure(p.id)).rejects.toThrow('录制');p.sourceFile='../outside.mp4';store.write(p);expect(()=>store.media(p.id,'source')).toThrow()}finally{fs.rmSync(root,{recursive:true,force:true})}})
})
