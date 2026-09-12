// Runs only against a fresh isolated profile and our synthetic test window.
const {app,BrowserWindow,screen,protocol,dialog}=require('electron')
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process')
const out=path.resolve(__dirname,'../output/video-ui-'+Date.now()),packaged=process.env.TA_VIDEO_PACKAGED==='1',bundle=process.env.TA_VIDEO_RESOURCES_DIR || path.resolve(__dirname,'../release/win-unpacked/resources'),bin=packaged?path.join(bundle,'video'):path.resolve(__dirname,'../resources/video')
if(packaged){Object.defineProperty(app,'isPackaged',{value:true});process.resourcesPath=bundle}
const mode=process.env.TA_VIDEO_SOURCE_KIND||'region'
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'))
app.on('window-all-closed',()=>{})
protocol.registerSchemesAsPrivileged([{scheme:'ta-video',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}])
const wait=ms=>new Promise(r=>setTimeout(r,ms))
const until=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await wait(100)}throw Error('UI condition timeout')}
let controller,bg,errors=[]
app.whenReady().then(async()=>{
  if(packaged)Object.defineProperty(process,'resourcesPath',{value:bundle})
  fs.mkdirSync(path.join(out,'profile/video'),{recursive:true});fs.writeFileSync(path.join(out,'profile/video/settings.json'),JSON.stringify({root:path.join(out,'projects'),startKey:'',pauseKey:'',stopKey:'',annotateKey:'',countdown:0}))
  const {VideoStore}=require(packaged?path.join(bundle,'app.asar/dist-electron/video/store'):'../dist-electron/video/store'),fixture=new VideoStore(path.join(out,'profile/video'),path.join(out,'projects')),interrupted=fixture.create(734,560,false,false)
  fs.copyFileSync(path.resolve(__dirname,'../output/video-probe/screen.mp4'),fixture.file(interrupted.id,'screen.mp4'));interrupted.duration=4000;fixture.write(interrupted)
  const {VideoController}=require(packaged?path.join(bundle,'app.asar/dist-electron/video/controller'): '../dist-electron/video/controller')
  controller=new VideoController(async(w,route)=>{w.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});await w.loadFile(packaged?path.join(bundle,'app.asar/dist/index.html'):path.resolve(__dirname,'../dist/index.html'),{hash:route})},()=> 'dark')
  if(packaged)console.log(JSON.stringify({packaged:app.isPackaged,resources:process.resourcesPath,bin:controller.bin}))
  await controller.open();const win=controller.window
  await until(()=>win.webContents.executeJavaScript('Boolean(document.querySelector(".video-setup"))'))
  const recovered=await win.webContents.executeJavaScript(`window.taVideo.get(${JSON.stringify(interrupted.id)})`),recovery=recovered.status==='recovered'&&recovered.duration>1000
  await wait(500);fs.writeFileSync(path.join(out,'setup.png'),(await win.capturePage()).toPNG())
  const d=screen.getPrimaryDisplay(), b=d.bounds
  bg=new BrowserWindow({x:b.x+100,y:b.y+180,width:640,height:400,frame:false,alwaysOnTop:true,title:'TA SYNTHETIC VIDEO',webPreferences:{backgroundThrottling:false}})
  await bg.loadURL('data:text/html,'+encodeURIComponent('<title>TA SYNTHETIC VIDEO</title><body style="margin:0;background:#18a064;color:white;font:24px Segoe UI"><div style="position:absolute;left:50px;top:50px;width:120px;height:80px;background:#203080">REFERENCE</div><canvas id="c" width="600" height="380"></canvas><script>setInterval(()=>{let x=c.getContext("2d");x.clearRect(0,0,600,380);x.fillStyle="white";x.fillText(Date.now(),200,250)},33)</script>'))
  bg.show();bg.moveTop()
  if(mode==='screen'){bg.setBounds(b);bg.show();bg.moveTop();await wait(300)}
  const sources=await win.webContents.executeJavaScript('window.taVideo.sources()'),source=mode==='window'?sources.find(s=>s.kind==='window'&&s.name==='TA SYNTHETIC VIDEO'):sources.find(s=>s.kind==='screen'&&s.displayId===String(d.id));if(!source)throw Error('No display source')
  const physical=screen.dipToScreenRect(null,{x:b.x+100,y:b.y+180,width:640,height:400}),db=screen.dipToScreenRect(null,b)
  const devices=await win.webContents.executeJavaScript('window.taVideo.microphones()'),micName=devices.find(m=>m.includes('立体声混音'))||''
  const options={sourceId:source.id,...(mode==='region'?{region:{x:physical.x-db.x,y:physical.y-db.y,width:physical.width,height:physical.height}}:{}),mic:Boolean(micName),micName,system:true}
  await win.webContents.executeJavaScript(`window.taVideo.start(${JSON.stringify(options)})`)
  if(mode==='window')console.log(JSON.stringify({bg:bg.getBounds(),info:execFileSync(path.join(bin,'ta-recorder.exe'),['--window-info',source.id.split(':')[1]],{encoding:'utf8'}),state:await win.webContents.executeJavaScript('window.taVideo.init().then(v=>v.state)')}))
  await wait(900)
  const hud=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#video-hud'));if(!hud)throw Error('HUD missing')
  const mark={id:'test-mark',tool:'rect',x:50*d.scaleFactor,y:50*d.scaleFactor,width:120*d.scaleFactor,height:80*d.scaleFactor,start:0,end:5000,enabled:true,color:'#FF4D37',stroke:4,text:''}
  await hud.webContents.executeJavaScript(`window.taVideo.mark(${JSON.stringify(mark)})`)
  await hud.webContents.executeJavaScript('window.taVideo.pause(true)');await wait(350);await hud.webContents.executeJavaScript('window.taVideo.pause(false)');await wait(1800)
  await win.webContents.executeJavaScript('window.taVideo.stop()');bg.destroy();bg=undefined
  await until(()=>win.webContents.executeJavaScript('Boolean(document.querySelector(".sop-workspace"))'))
  await win.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent==="视频剪辑").click()')
  await until(()=>win.webContents.executeJavaScript('Boolean(document.querySelector(".video-editor"))'))
  await until(()=>win.webContents.executeJavaScript('document.querySelector("video")?.readyState>=2'))
  const projects=await win.webContents.executeJavaScript('window.taVideo.list()'),p=projects[0]
  if(p.status!=='ready'||p.marks.length!==1||p.hasSystem!==true)throw Error('Project did not persist')
  const raw=path.join(out,'projects',String(new Date(p.createdAt).getFullYear()),String(new Date(p.createdAt).getMonth()+1).padStart(2,'0'),String(new Date(p.createdAt).getDate()).padStart(2,'0'),p.id,'screen.mp4')
  const crypto=require('node:crypto'),hash=()=>crypto.createHash('sha256').update(fs.readFileSync(raw)).digest('hex'),before=hash()
  p.marks[0].end=p.duration;p.zooms=[{id:'test-zoom',start:1000,end:p.duration,scale:2,cx:200*d.scaleFactor,cy:150*d.scaleFactor}];p.cuts=[{start:400,end:700}]
  p.marks.push({id:'progressive-pen',tool:'pen',x:500,y:500,width:100,height:0,start:100,end:500,enabled:true,color:'#ffffff',stroke:10,text:'',points:[{x:500,y:500,t:100},{x:550,y:500,t:200},{x:600,y:500,t:300}]})
  await win.webContents.executeJavaScript(`window.taVideo.save(${JSON.stringify(p.id)},${JSON.stringify(p)})`)
  // Reopen via real library card to verify the saved project is the editor source.
  await win.webContents.executeJavaScript('[...document.querySelectorAll("nav button")].find(b=>b.textContent==="视频库").click()');await wait(600)
  await win.webContents.executeJavaScript('document.querySelector(".video-card").click()');await until(()=>win.webContents.executeJavaScript('document.querySelector("video")?.readyState>=2'))
  await win.webContents.executeJavaScript('document.querySelector("video").currentTime=1.5');await wait(500)
  fs.writeFileSync(path.join(out,'editor-dark.png'),(await win.capturePage()).toPNG())
  await win.webContents.executeJavaScript('document.documentElement.dataset.theme="light"');await wait(200);fs.writeFileSync(path.join(out,'editor-light.png'),(await win.capturePage()).toPNG())
  const result=path.join(out,'marked.mp4');dialog.showSaveDialog=async()=>({canceled:false,filePath:result})
  await win.webContents.executeJavaScript(`window.taVideo.export(${JSON.stringify(p.id)},720)`)
  const info=JSON.parse(execFileSync(path.join(bin,'ffprobe.exe'),['-v','error','-show_streams','-show_format','-of','json',result],{encoding:'utf8',windowsHide:true}))
  const clean=path.join(out,'clean.mp4');p.marks.forEach(m=>m.enabled=false);await win.webContents.executeJavaScript(`window.taVideo.save(${JSON.stringify(p.id)},${JSON.stringify(p)})`);dialog.showSaveDialog=async()=>({canceled:false,filePath:clean});await win.webContents.executeJavaScript(`window.taVideo.export(${JSON.stringify(p.id)},720)`)
  const sourceHashUnchanged=hash()===before
  const canceledOutput=path.join(out,'canceled.mp4');dialog.showSaveDialog=async()=>({canceled:false,filePath:canceledOutput})
  const pending=win.webContents.executeJavaScript(`window.taVideo.export(${JSON.stringify(p.id)},720).then(()=>false,e=>e.message.includes('取消'))`);await wait(60);await win.webContents.executeJavaScript('window.taVideo.cancelExport()');const cancellation=await pending&&!fs.existsSync(canceledOutput)
  const pixel=(file,t,x,y)=>[...execFileSync(path.join(bin,'ffmpeg.exe'),['-v','error','-ss',String(t),'-i',file,'-vf',`crop=2:2:${x}:${y},format=rgb24`,'-frames:v','1','-f','rawvideo','pipe:1'],{windowsHide:true}).subarray(0,3)]
  const scale=Math.min(1,720/p.height),markedPixel=pixel(result,.1,Math.round(mark.x*scale),Math.round((mark.y+mark.height/2)*scale)),cleanPixel=pixel(clean,.1,Math.round(mark.x*scale),Math.round((mark.y+mark.height/2)*scale))
  const selective=markedPixel[0]>cleanPixel[0]+50&&markedPixel[0]>markedPixel[1]
  const penBefore=pixel(result,.1333,Math.round(590*scale),Math.round(500*scale)),penAfter=pixel(result,.3333,Math.round(590*scale),Math.round(500*scale)),progressivePen=penAfter[0]>penBefore[0]+80&&penAfter[1]>180
  const rawPixel=pixel(raw,1.5,Math.round(mark.x),Math.round(mark.y+mark.height/2)),cleanOriginal=rawPixel[0]<150
  const {viewportAt}=require('../dist-electron/video/model'),viewport=viewportAt(p,1400),vw=info.streams.find(s=>s.codec_type==='video').width,vh=info.streams.find(s=>s.codec_type==='video').height
  const zx=Math.round((mark.x-viewport.x)/viewport.width*vw),zy=Math.round((mark.y+mark.height/2-viewport.y)/viewport.height*vh)
  const zoomPixel=pixel(result,1.1,zx,zy),zoomClean=pixel(clean,1.1,zx,zy),zoomAligned=zoomPixel[0]>zoomClean[0]+50
  const expectedFrames=Math.round(p.duration*.03)-9,actualFrames=Number(info.streams.find(s=>s.codec_type==='video').nb_frames)
  await win.webContents.executeJavaScript(`(()=>{const input=document.querySelector('input[aria-label="项目名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'关闭保存验证');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  win.close();await until(()=>win.isDestroyed());const closeSaved=JSON.parse(fs.readFileSync(path.join(path.dirname(raw),'project.json'),'utf8')).title==='关闭保存验证'
  const report={ready:closeSaved&&recovery&&cancellation&&p.duration>=2500&&sourceHashUnchanged&&selective&&progressivePen&&zoomAligned&&cleanOriginal&&actualFrames===expectedFrames&&info.streams.some(s=>s.codec_name==='h264')&&info.streams.some(s=>s.codec_name==='aac'),packaged,mode,recovery,cancellation,closeSaved,mic:p.hasMic,width:p.width,height:p.height,project:p.id,duration:p.duration,outputDuration:Number(info.format.duration),expectedFrames,actualFrames,selective,markedPixel,cleanPixel,penBefore,penAfter,progressivePen,rawPixel,cleanOriginal,zoomPixel,zoomClean,zoomAligned,sourceHashUnchanged,consoleErrors:errors,output:out}
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(report.ready?0:1)
}).catch(async e=>{console.error(e);fs.writeFileSync(path.join(out,'error.txt'),String(e.stack));if(controller?.active())await controller.stop().catch(()=>{});bg?.destroy();app.exit(1)})
