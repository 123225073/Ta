// Read-only regression probe for an existing recording. Set TA_INSPECT_VIDEO to its path.
const {app,BrowserWindow,protocol,net}=require('electron')
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process')
protocol.registerSchemesAsPrivileged([{scheme:'ta-video',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}])
app.whenReady().then(async()=>{
  const file=process.env.TA_INSPECT_VIDEO;if(!file)throw Error('TA_INSPECT_VIDEO required')
  const expected=Number(execFileSync(path.resolve(__dirname,'../resources/video/ffprobe.exe'),['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{encoding:'utf8',windowsHide:true}).trim())
  let requests=0,ranges=0
  protocol.handle('ta-video',async request=>{requests++;const r=process.env.TA_INSPECT_LEGACY==='1'?await net.fetch(pathToFileURL(file).href,{headers:request.headers}):require('../dist-electron/video/media-response').mediaResponse(file,request);if(r.status===206)ranges++;return r})
  const w=new BrowserWindow({show:false,webPreferences:{contextIsolation:true}})
  await w.loadURL('data:text/html,<video preload="metadata" src="ta-video://media/test/screen.mp4"></video>')
  const js=s=>w.webContents.executeJavaScript(s)
  const until=async(condition)=>{for(let i=0;i<150;i++){if(await js(condition))return;await new Promise(r=>setTimeout(r,100))}throw Error('Video duration or seek did not settle')}
  await until('document.querySelector("video").readyState>=1&&Math.abs(document.querySelector("video").duration-'+expected+')<0.05')
  const target=Math.min(100,expected/2)
  await js('document.querySelector("video").currentTime='+target)
  await until('!document.querySelector("video").seeking&&Math.abs(document.querySelector("video").currentTime-'+target+')<0.05')
  const report={ready:true,expected,duration:await js('document.querySelector("video").duration'),target,actual:await js('document.querySelector("video").currentTime'),requests,ranges}
  const out=path.resolve(__dirname,'../output/source-seek-'+Date.now()+'.json');fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,output:out}));app.exit(0)
}).catch(e=>{console.error(e);app.exit(1)})
