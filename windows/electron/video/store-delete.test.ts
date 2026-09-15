import {it,expect} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {VideoStore} from './store'
it('moves the complete owned project to trash before removing its index, leaving external exports intact',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-delete-')),meta=path.join(root,'meta'),store=new VideoStore(meta,path.join(root,'projects')),p=store.create(640,360,true,false);p.status='ready';store.write(p);
 const dir=store.directory(p.id);fs.writeFileSync(path.join(dir,'screen.mp4'),'recording');fs.writeFileSync(path.join(dir,'sop.json'),'sop');const outside=path.join(root,'export.mp4');fs.writeFileSync(outside,'export');
 await expect(store.trash(p.id,async()=>{throw Error('trash failed')})).rejects.toThrow('trash failed');expect(store.list()).toHaveLength(1);expect(fs.existsSync(dir)).toBe(true);
 const trash=path.join(root,'recycle');await store.trash(p.id,async d=>{expect(d).toBe(dir);fs.renameSync(d,trash)});expect(store.list()).toHaveLength(0);expect(new VideoStore(meta,'').list()).toHaveLength(0);expect(fs.readFileSync(path.join(trash,'screen.mp4'),'utf8')).toBe('recording');expect(fs.readFileSync(path.join(trash,'sop.json'),'utf8')).toBe('sop');expect(fs.readFileSync(outside,'utf8')).toBe('export');
})
it('refuses active recordings, unknown IDs and an index pointing outside the owned project directory',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ta-delete-safe-')),meta=path.join(root,'meta'),store=new VideoStore(meta,path.join(root,'projects')),p=store.create(640,360,false,false);let calls=0;const trash=async()=>{calls++};await expect(store.trash(p.id,trash)).rejects.toThrow('正在录制');await expect(store.trash('../',trash)).rejects.toThrow();p.status='ready';store.write(p);
 fs.writeFileSync(path.join(root,'project.json'),JSON.stringify(p));fs.writeFileSync(path.join(meta,'index.json'),JSON.stringify({[p.id]:root}));await expect(new VideoStore(meta,'').trash(p.id,trash)).rejects.toThrow('目录校验');expect(calls).toBe(0);
})
