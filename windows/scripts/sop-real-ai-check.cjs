// Explicit opt-in only. Never logs credentials or sends user recordings.
if(process.env.TA_ALLOW_REAL_SOP_AI!=='1')throw Error('Real AI validation requires explicit user permission and TA_ALLOW_REAL_SOP_AI=1.')
const {app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const out=path.resolve(__dirname,'../output/sop-real-ai-'+Date.now()),root=path.resolve(__dirname,'..'),settingsFile=path.join(process.env.APPDATA,'ta-windows/settings.json')
fs.mkdirSync(path.join(out,'profile'),{recursive:true})
// Windows safeStorage uses the encrypted OSCrypt key in Local State. Copy that
// encrypted state into the isolated test profile; never open the user's profile.
const localState=path.join(path.dirname(settingsFile),'Local State')
if(fs.existsSync(localState))fs.copyFileSync(localState,path.join(out,'profile','Local State'))
app.setPath('userData',path.join(out,'profile'))
let key=''
app.whenReady().then(async()=>{
  const bytes=fs.readFileSync(settingsFile),hash=crypto.createHash('sha256').update(bytes).digest('hex'),settings=JSON.parse(bytes),candidates=settings.providers.filter(p=>/cpa/i.test(p.id+' '+p.name)),profile=candidates.find(p=>p.id===settings.activeProviderId)??(candidates.length===1?candidates[0]:undefined)
  if(!profile||!settings.encryptedApiKeys?.[profile.id])throw Error('Current provider is not configured.')
  key=safeStorage.decryptString(Buffer.from(settings.encryptedApiKeys[profile.id],'base64'))
  const {VideoStore}=require(process.env.TA_REAL_USE_BUILD==='1'?'../dist-electron/video/store':'../release/win-unpacked/resources/app.asar/dist-electron/video/store'),{SopService}=require(process.env.TA_REAL_USE_BUILD==='1'?'../dist-electron/sop/service':'../release/win-unpacked/resources/app.asar/dist-electron/sop/service')
  const store=new VideoStore(path.join(out,'metadata'),path.join(out,'projects')),service=new SopService(store,path.join(root,process.env.TA_REAL_USE_BUILD==='1'?'resources/video':'release/win-unpacked/resources/video'),()=>({profile,apiKey:key}),p=>{if(p.message)console.log(p.message)})
  const fixture=process.argv[2];if(!fixture||!path.resolve(fixture).startsWith(path.join(root,'output','sop-ui-'))||path.basename(fixture)!=='tutorial.mp4')throw Error('Only the self-created SOP test fixture is allowed.')
  const p=await service.importVideo(path.resolve(fixture)),start=Date.now();let d=await service.generate(p.id);fs.writeFileSync(path.join(out,'generated.json'),JSON.stringify(d,null,2))
  if(d.steps.length<2||!d.steps.some(s=>s.images.length))throw Error('The generated sample lacks usable steps or images.')
  const selected=d.steps.find(s=>/选择.*模型/.test(s.title))??d.steps[0]
  // Exercise an actual missing-image case; otherwise a good editor may simply
  // caption an existing picture instead of adding a duplicate.
  selected.images=[];d=service.save(d,'测试：模拟漏图')
  const count=d.steps.reduce((n,s)=>n+s.images.length,0)
  d=await service.chat(p.id,'请在当前步骤再补一张视频中选择模型后的截图，补充图注，并把当前步骤的说明改得适合第一次操作的人。不要增加视频中不存在的操作。',selected.id,3500)
  if(d.steps.reduce((n,s)=>n+s.images.length,0)<=count)throw Error('Real model did not insert the requested frame.')
  fs.writeFileSync(path.join(out,'edited.json'),JSON.stringify(d,null,2));fs.writeFileSync(path.join(out,'guide.html'),service.html(d))
  if(crypto.createHash('sha256').update(fs.readFileSync(settingsFile)).digest('hex')!==hash)throw Error('Settings changed during validation; investigate before continuing.')
  const result={ready:true,model:profile.model,steps:d.steps.length,elapsedMs:Date.now()-start,frameInserted:true,userSettingsUnchanged:true,output:out};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(0)
}).catch(e=>{const message=String(e.message).split(key||'__no_key__').join('[redacted]');fs.writeFileSync(path.join(out,'error.txt'),message);console.error(message);app.exit(1)})
