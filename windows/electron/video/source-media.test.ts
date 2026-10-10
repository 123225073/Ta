import {describe,it,expect,vi} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {SourceMedia,mediaName} from './source-media'
import {VideoStore} from './store'
describe('ready originals',()=>{
 it('automatically queues missing originals once, skips active and ready projects, and defers during recording',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-source-queue-')),store=new VideoStore(path.join(root,'meta'),path.join(root,'media')),service=new SourceMedia('',store);let recording=true,running=0,peak=0;
  try{
   const active=store.create(640,480,false,false),ready=store.create(640,480,false,false),missing=store.create(640,480,false,false),recovered=store.create(640,480,false,false);
   const complete=(id:string)=>{const p=store.get(id);p.sourceFile=mediaName(p.title);const dir=path.join(store.directory(id),'原片');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,p.sourceFile),'fixture');store.write(p);return path.join(dir,p.sourceFile)};
   ready.status=missing.status='ready';recovered.status='recovered';for(const p of [ready,missing,recovered])store.write(p);complete(ready.id);
   const prepare=vi.spyOn(service as any,'prepare').mockImplementation(async(id:any)=>{running++;peak=Math.max(peak,running);await new Promise(r=>setTimeout(r,10));running--;return complete(id)});
   service.startAutomatic(()=>!recording);service.enqueueMissing();expect(prepare).not.toHaveBeenCalled();expect(service.state(missing.id).queued).toBe(true);expect(service.state(active.id).busy).toBe(false);
   recording=false;await vi.waitFor(()=>expect(service.state(missing.id).ready&&service.state(recovered.id).ready).toBe(true),{timeout:2000});
   service.enqueueMissing();expect(prepare).toHaveBeenCalledTimes(2);expect(peak).toBe(1);expect(service.state(ready.id).ready).toBe(true);
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true})}
 })
 it('continues after an automatic failure, avoids retry loops and resumes missing work after reopening',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-source-resume-')),store=new VideoStore(path.join(root,'meta'),path.join(root,'media')),service=new SourceMedia('',store);
  try{
   const good=store.create(640,480,false,false);await new Promise(r=>setTimeout(r,2));const bad=store.create(640,480,false,false);bad.status=good.status='ready';store.write(bad);store.write(good);
   const complete=(id:string)=>{const p=store.get(id);p.sourceFile=mediaName(p.title);const dir=path.join(store.directory(id),'原片');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,p.sourceFile),'fixture');store.write(p);return path.join(dir,p.sourceFile)};
   const prepare=vi.spyOn(service as any,'prepare').mockImplementation(async(id:any)=>{if(id===bad.id)throw Error('disk full');return complete(id)});
   service.startAutomatic();await vi.waitFor(()=>{expect(service.state(bad.id).error).toBe('disk full');expect(service.state(good.id).ready).toBe(true)});service.enqueueMissing();expect(prepare).toHaveBeenCalledTimes(2);await service.close();
   const reopened=new SourceMedia('',store);try{const retry=vi.spyOn(reopened as any,'prepare').mockImplementation(async(id:any)=>complete(id));reopened.startAutomatic();await vi.waitFor(()=>expect(reopened.state(bad.id).ready).toBe(true));expect(retry).toHaveBeenCalledTimes(1)}finally{await reopened.close()}
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true})}
 })
 it('makes safe names while retaining Chinese and removing duplicate extensions',()=>{expect(mediaName('示范.mp4')).toBe('示范.mp4');expect(mediaName('CON')).toBe('_CON.mp4');expect(mediaName('../录音:一',true)).toBe('..-录音-一.mp3')})
 it('serializes copy and rename, keeps dates and avoids overwriting files',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-source-test-'));try{const store=new VideoStore(path.join(root,'meta'),path.join(root,'media')),p=store.create(640,480,false,false);p.status='ready';p.sourceFile='旧名.mp4';store.write(p);const dir=path.join(store.directory(p.id),'原片');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,p.sourceFile),'fixture');const service=new SourceMedia('',store);
   await Promise.all([service.copy(p.id,path.join(root,'copy.mp4')),service.rename(p.id,'新名字')]);expect(fs.readFileSync(path.join(root,'copy.mp4'),'utf8')).toBe('fixture');expect(path.basename(store.media(p.id,'source'))).toBe('新名字.mp4');expect(store.get(p.id).createdAt).toBe(p.createdAt);await expect(service.copy(p.id,path.join(root,'copy.mp4'))).rejects.toThrow();fs.writeFileSync(path.join(dir,'冲突.mp4'),'unrelated');await expect(service.rename(p.id,'冲突')).rejects.toThrow();expect(store.get(p.id).title).toBe('新名字');expect(fs.readFileSync(path.join(dir,'冲突.mp4'),'utf8')).toBe('unrelated');await expect(service.rename(p.id,' ')).rejects.toThrow();
  }finally{fs.rmSync(root,{recursive:true,force:true})}
 })
 it('does not prepare an active recording or allow a stored path escape',async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-source-test-'));try{const store=new VideoStore(path.join(root,'meta'),path.join(root,'media')),p=store.create(640,480,false,false);await expect(new SourceMedia('',store).ensure(p.id)).rejects.toThrow('录制');p.sourceFile='../outside.mp4';store.write(p);expect(()=>store.media(p.id,'source')).toThrow()}finally{fs.rmSync(root,{recursive:true,force:true})}})
})
