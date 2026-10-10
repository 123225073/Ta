// Explicit maintenance: prepare a reviewed manifest first, apply it separately.
const fs=require('fs'),path=require('path'),{VideoStore}=require('../dist-electron/video/store'),{SourceMedia}=require('../dist-electron/video/source-media');
const args=process.argv.slice(2),mode=args[0],metadata=args[1],manifest=args[2];
if(!['prepare','apply'].includes(mode)||!metadata||!manifest||!path.isAbsolute(metadata)||!path.isAbsolute(manifest))throw Error('Usage: node compact-existing-media.cjs prepare|apply <absolute metadata directory> <absolute manifest.json>');
const store=new VideoStore(metadata,''),service=new SourceMedia(path.resolve(__dirname,'../resources/video'),store);
(async()=>{try{
 if(mode==='prepare'){
  const projects=[];for(const p of store.list()){if(p.status==='recording')throw Error('Recording is active');if(p.retainOriginals===true)continue;await service.compact(p.id);const files=await service.cleanupPlan(p.id,true),next=store.get(p.id);projects.push({id:p.id,title:p.title,source:store.media(p.id,'source'),sourceBytes:fs.statSync(store.media(p.id,'source')).size,sourceTracks:next.sourceTracks,files});console.log(JSON.stringify({prepared:p.title,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)}))}
  const data={createdAt:new Date().toISOString(),metadata:path.resolve(metadata),projects};fs.writeFileSync(manifest,JSON.stringify(data,null,2),{flag:'wx',flush:true});console.log(JSON.stringify({manifest,projects:projects.length,bytes:projects.flatMap(p=>p.files).reduce((n,f)=>n+f.bytes,0)}));
 }else{
  const plan=JSON.parse(fs.readFileSync(manifest,'utf8'));if(plan.metadata!==path.resolve(metadata))throw Error('Manifest metadata mismatch');
  // Validate every project and every listed file before removing any file.
  const verified=[];for(const p of plan.projects){if(store.get(p.id).retainOriginals===true)throw Error('Lossless retention is now enabled');if(store.media(p.id,'source')!==p.source||fs.statSync(p.source).size!==p.sourceBytes)throw Error('Canonical source changed');const current=await service.cleanupPlan(p.id,true);if(JSON.stringify(current)!==JSON.stringify(p.files))throw Error('Cleanup plan changed; prepare a new manifest');verified.push(...current)}
  for(const f of verified)await fs.promises.unlink(f.file);
  fs.writeFileSync(manifest+'.applied.json',JSON.stringify({completedAt:new Date().toISOString(),removed:verified.length,bytes:verified.reduce((n,f)=>n+f.bytes,0)},null,2),{flag:'wx',flush:true});console.log(JSON.stringify({removed:verified.length,bytes:verified.reduce((n,f)=>n+f.bytes,0)}));
 }
}finally{await service.close()}})().catch(e=>{console.error(e);process.exitCode=1});
