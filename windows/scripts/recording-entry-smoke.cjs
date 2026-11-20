// The controller and recorder are real. Only the selectable list is restricted to this fixture.
const { app, BrowserWindow, dialog, protocol, screen } = require('electron')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const output = process.env.TA_RECORD_ENTRY_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'ta-record-entry-'))
const profile = path.join(output, 'profile'), media = path.join(output, 'projects')
const resources = process.env.TA_VIDEO_RESOURCES_DIR
const base = resources ? path.join(resources, 'app.asar') : path.resolve(__dirname, '..')
const bin = resources ? path.join(resources, 'video') : path.join(base, 'resources/video')
if (resources) {
  Object.defineProperty(app, 'isPackaged', { value:true })
  Object.defineProperty(process, 'resourcesPath', { value:resources })
}
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
protocol.registerSchemesAsPrivileged([{scheme:'ta-video', privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}])
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, description) {
  for (let i=0; i<200; i++) { if (await fn()) return; await wait(100) }
  throw Error('Timed out: '+description)
}
async function run() {
  const meta=path.join(profile,'video')
  fs.mkdirSync(meta,{recursive:true})
  fs.writeFileSync(path.join(meta,'settings.json'),JSON.stringify({root:media,countdown:0,startKey:'',stopKey:'',pauseKey:'',annotateKey:''}))
  const sample=new BrowserWindow({width:900,height:600,frame:false,title:'办公录屏样例',webPreferences:{backgroundThrottling:false}})
  const rows=Array.from({length:80},(_,i)=>'<tr><td>PO '+(4500000+i)+'</td><td>采购订单 · 行项目 '+(i+1)+'</td><td>'+((i+1)*17.82).toFixed(2)+'</td><td>已核对</td></tr>').join('')
  await sample.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<title>办公录屏样例</title><style>*{box-sizing:border-box}html{scrollbar-width:none}body{background:#f6f3ec;color:#202629;font:18px Microsoft YaHei UI;margin:0}header{position:sticky;top:0;background:#20363a;color:#fff;padding:24px}table{width:100%;border-collapse:collapse}td{padding:8px 14px;border-bottom:1px solid #b9c2bc}tr:nth-child(even){background:#fffdf8}</style><header>采购订单查询 · 录制测试</header><table>'+rows+'</table>'))
  sample.show()
  await wait(700)
  let preview
  await until(async()=>{
    try { const frame=await sample.capturePage(); if(frame.isEmpty())return false; preview=frame.resize({width:480}).toDataURL(); return true }
    catch { return false }
  },'fixture thumbnail')
  const source={id:'window:'+sample.getNativeWindowHandle().readBigUInt64LE()+':0',name:'办公录屏样例',kind:'window',thumbnail:preview,scale:1}
  const {VideoController}=require(path.join(base,'dist-electron/video/controller'))
  const controller=new VideoController((w,r)=>w.loadFile(path.join(base,'dist/index.html'),{hash:r}),()=> 'dark')
  const enumerate=controller.getSources.bind(controller)
  controller.getSources=async()=>{controller.sources=[source];return controller.sources}
  dialog.showMessageBox=async()=>({response:1})
  await controller.open()
  const win=controller.window, js=code=>win.webContents.executeJavaScript(code,true)
  const click=async selector=>{
    const q=JSON.stringify(selector)
    await until(()=>js('document.querySelector('+q+')?.disabled === false'),selector)
    await js('document.querySelector('+q+').click()')
  }
  const measurements=[]
  for(const quality of ['balanced','original','compact']) {
    await click('.video-mode-picker [data-mode="window"]')
    await click('.video-source-list button')
    await until(()=>js('document.querySelector(".video-source-summary")?.textContent.includes("办公录屏样例")'),'selected target')
    await js('(()=>{const s=document.querySelector("select[aria-label=录制画质]");s.value='+JSON.stringify(quality)+';s.dispatchEvent(new Event("change",{bubbles:true}))})()')
    if (quality==='balanced' && process.env.TA_QA_PREVIEW_DIR) {
      const previewDir=process.env.TA_QA_PREVIEW_DIR
      for(const theme of ['dark','light']){
        await js('document.documentElement.dataset.theme='+JSON.stringify(theme))
        await wait(300)
        fs.writeFileSync(path.join(previewDir,'录屏台-'+theme+'.png'),(await win.capturePage()).toPNG())
      }
      await js('document.documentElement.dataset.theme="dark"')
    }
    await click('.video-record-footer .primary')
    await until(()=>controller.state.phase==='recording','native recording started')
    const id=controller.state.id
    await sample.webContents.executeJavaScript('clearInterval(window.motion);scrollTo(0,0);window.n=0;window.motion=setInterval(()=>scrollTo(0,(window.n++%140)*4),33)')
    await wait(4300)
    await sample.webContents.executeJavaScript('clearInterval(window.motion);scrollTo(0,0)')
    const hud=controller.hud
    await hud.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("停止")).click()',true)
    await until(()=>controller.state.phase==='idle','automatic MP4 save')
    const p=controller.store.get(id),file=controller.store.media(id,'source')
    assert.equal(p.quality,quality)
    const probe=JSON.parse(execFileSync(path.join(bin,'ffprobe.exe'),['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8',windowsHide:true}))
    const video=probe.streams.find(s=>s.codec_type==='video')
    assert.equal(video.codec_name,'h264'); assert.ok(Number(probe.format.duration)>3)
    const colorAt=(x,y)=>execFileSync(path.join(bin,'ffmpeg.exe'),['-v','error','-ss','1','-i',file,'-frames:v','1','-vf','crop=2:2:iw*'+x+':ih*'+y+',scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true})
    const header=colorAt(0.8,0.03),paper=colorAt(0.98,0.6)
    assert.ok([32,54,58].every((n,i)=>Math.abs(n-header[i])<18)&&[...paper].every(n=>n>185),'wrong recorded window')
    const events=fs.readFileSync(path.join(controller.store.directory(id),'recording-events.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line))
    const bitrate=events.find(e=>e.event==='video-bitrate')
    assert.ok(bitrate,'native bitrate event missing')
    measurements.push({quality,bytes:fs.statSync(file).size,seconds:Number(probe.format.duration),width:video.width,height:video.height,native:bitrate.detail})
    await click('.media-preview-trigger')
    await until(()=>js('document.querySelector(".video-library video")?.currentTime>0'),'saved MP4 playback')
    if(quality!=='compact')await js('[...document.querySelectorAll("nav button")].find(b=>b.textContent==="新建录屏").click()')
  }
  assert.equal(new Set(measurements.map(m=>m.width+'x'+m.height)).size,1)
  assert.ok(measurements[1].native.target > measurements[0].native.target && measurements[0].native.target > measurements[2].native.target,'native encoder must use the selected bitrate')
  const perSecond=measurements.map(take=>take.bytes/take.seconds)
  assert.ok(perSecond[1]>perSecond[0]&&perSecond[0]>perSecond[2],'recorded file sizes do not separate on this scrolling fixture')
  const display=screen.getPrimaryDisplay()
  sample.setBounds(display.bounds)
  sample.setAlwaysOnTop(true,'screen-saver')
  sample.setFullScreen(true)
  sample.show()
  await sample.webContents.executeJavaScript('document.body.innerHTML="<div style=\'width:35vw;height:45vh;background:lime\'></div>";document.body.style.background="red"')
  await wait(400)
  const selectedDisplay=(await enumerate()).find(s=>s.kind==='screen'&&s.displayId===String(display.id))
  assert.ok(selectedDisplay,'primary display not enumerated')
  controller.getSources=async()=>{controller.sources=[selectedDisplay,source];return controller.sources}
  const checkedScopes=[]
  async function fillRegion(container=''){
    await js(`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const inputs=document.querySelectorAll(${JSON.stringify(container+'.video-region-inputs input')});[0,0,320,240].forEach((n,i)=>{set.call(inputs[i],String(n));inputs[i].dispatchEvent(new Event('input',{bubbles:true}))})})()`)
  }
  for(const mode of ['screen','region']){
    await js('[...document.querySelectorAll("nav button")].find(b=>b.textContent==="新建录屏").click()')
    await click('.video-mode-picker [data-mode="'+mode+'"]')
    await click('.video-source-list button')
    if(mode==='region')await fillRegion()
    await click('.video-record-footer .primary')
    await until(()=>controller.state.phase==='recording',mode+' recording started')
    const id=controller.state.id
    await wait(1800)
    if(mode==='screen'){
      const hudClick=label=>controller.hud.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent==='+JSON.stringify(label)+').click()',true)
      await hudClick('暂停')
      await until(()=>controller.state.phase==='paused','paused')
      await hudClick('继续')
      await until(()=>controller.state.phase==='recording','resumed')
      await hudClick('切换范围')
      const overlay='.video-switch-overlay '
      await click(overlay+'button[data-mode="region"]')
      await click(overlay+'.video-source-list button')
      await fillRegion(overlay)
      await click(overlay+'.video-record-footer .primary')
      await until(()=>!controller.state.choosingSource&&!controller.state.switching,'region switch acknowledged')
      await wait(1600)
    }
    await controller.hud.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("停止")).click()',true)
    await until(()=>controller.state.phase==='idle',mode+' MP4 saved')
    const p=controller.store.get(id),file=controller.store.media(id,'source')
    assert.equal(p.width,mode==='region'?320:Math.floor(selectedDisplay.physical.width/2)*2)
    assert.equal(p.height,mode==='region'?240:Math.floor(selectedDisplay.physical.height/2)*2)
    const rgb=execFileSync(path.join(bin,'ffmpeg.exe'),['-v','error','-ss','0.8','-i',file,'-frames:v','1','-vf','crop=2:2:iw/2:ih/2,scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true})
    assert.ok(mode==='region'?rgb[1]>180&&rgb[0]<80:rgb[0]>180&&rgb[1]<80,mode+' recorded the wrong pixels: '+[...rgb])
    if(mode==='screen'){
      const switched=execFileSync(path.join(bin,'ffmpeg.exe'),['-v','error','-sseof','-0.8','-i',file,'-frames:v','1','-vf','crop=2:2:iw/2:ih/2,scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true})
      assert.ok(switched[1]>180&&switched[0]<80,'in-session switch did not capture the requested region')
    }
    checkedScopes.push({mode,width:p.width,height:p.height})
  }
  await until(()=>js('document.querySelectorAll(".media-preview-trigger:not(:disabled)").length===5'),'all five final library cards ready')
  console.log(JSON.stringify({recordedAndPlayed:measurements,verifiedDisplayAndRegion:checkedScopes}))
  await win.loadURL('about:blank')
  await controller.exporter.sources.close()
  sample.destroy(); win.destroy()
}
app.whenReady().then(run).then(()=>app.exit(0)).catch(e=>{console.error(e);console.error('Diagnostic directory:',output);app.exit(1)})
