import {it,expect} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {VideoStore} from './store'
import {VideoCLI,planEdits} from './cli-engine'
import {VideoExporter} from './export'
import {migrateTimeline} from './timeline'
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ta-cli-test-')),store=new VideoStore(path.join(dir,'meta'),path.join(dir,'projects')),p=store.create(640,360,true,false);p.duration=6000;p.status='ready';p.timeline=migrateTimeline(p);store.write(p);return {dir,store,p,cli:new VideoCLI(store,'',new VideoExporter('',store,()=>{}))}}
it('dry-runs, applies and reverses an atomic CLI batch with revision checks',async()=>{const {dir,store,p,cli}=fixture();try{const ops=[{op:'clip.split',clipId:p.timeline!.tracks[0].clips[0].id,time:2000},{op:'mark.add',trackId:'marks',start:1000,end:3000,mark:{tool:'arrow',x:400,y:180,width:-200,height:0}}];ops[1].trackId=p.timeline!.tracks.find(t=>t.kind==='mark')!.id
  await cli.execute({command:'apply',projectId:p.id,revision:0,operations:ops,dryRun:true});expect(store.get(p.id).revision).toBe(0)
  await cli.execute({command:'apply',projectId:p.id,revision:0,operations:ops});expect(store.get(p.id).timeline!.tracks[0].clips).toHaveLength(2)
  await expect(cli.execute({command:'apply',projectId:p.id,revision:0,operations:ops})).rejects.toThrow('REVISION_CONFLICT')
  await cli.execute({command:'undo',projectId:p.id,revision:1});expect(store.get(p.id).timeline!.tracks[0].clips).toHaveLength(1)
  await cli.execute({command:'redo',projectId:p.id,revision:2});expect(store.get(p.id).timeline!.tracks[0].clips).toHaveLength(2)
}finally{fs.rmSync(dir,{recursive:true,force:true})}})
it('rejects the entire batch when its final operation is invalid',()=>{const {dir,p}=fixture();try{expect(()=>planEdits(p,[{op:'clip.split',clipId:p.timeline!.tracks[0].clips[0].id,time:2000},{op:'mark.add',trackId:'missing',start:0,end:2000}])).toThrow();expect(p.timeline!.tracks[0].clips).toHaveLength(1)}finally{fs.rmSync(dir,{recursive:true,force:true})}})
