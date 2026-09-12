const { app, BrowserWindow, screen } = require('electron')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs'), path = require('node:path')
const out = path.resolve(__dirname, '../output/video-probe')
const crash=process.env.TA_VIDEO_CRASH_PROBE==='1'
fs.mkdirSync(out,{recursive:true}); app.setPath('userData',path.join(out,'user'))
app.whenReady().then(async()=>{
  const display=screen.getPrimaryDisplay(), b=display.bounds, s=display.scaleFactor
  const bg=new BrowserWindow({x:b.x+100,y:b.y+100,width:420,height:320,frame:false,alwaysOnTop:true,webPreferences:{backgroundThrottling:false}})
  await bg.loadURL('data:text/html,'+encodeURIComponent('<body style="margin:0;background:rgb(24,160,100);height:100vh"><h1>TA VIDEO TEST</h1><canvas id="c" width="200" height="70"></canvas><script>setInterval(()=>{let x=c.getContext("2d");x.clearRect(0,0,200,70);x.fillStyle="white";x.fillText(Date.now(),10,30)},33)</script>'))
  const marker=new BrowserWindow({x:b.x+200,y:b.y+200,width:100,height:80,frame:false,transparent:true,alwaysOnTop:true})
  marker.setContentProtection(true)
  await marker.loadURL('data:text/html,'+encodeURIComponent('<body style="margin:0;background:#ff00ff;width:100vw;height:100vh"></body>'))
  bg.setContentProtection(false); bg.show(); bg.moveTop(); marker.show(); marker.moveTop()
  console.log(JSON.stringify({bg:bg.getBounds(),visible:bg.isVisible(),display:display.bounds,scale:s}))
  await new Promise(r=>setTimeout(r,700))
  const config={schemaVersion:2,sourceType:'display',displayId:display.id,displayX:Math.round(b.x*s),displayY:Math.round(b.y*s),displayW:Math.round(b.width*s),displayH:Math.round(b.height*s),hasDisplayBounds:true,cropX:Math.round(100*s),cropY:Math.round(100*s),cropW:Math.floor(420*s/2)*2,cropH:Math.floor(320*s/2)*2,fps:30,captureCursor:false,screenPath:path.join(out,'screen.mp4'),systemPath:path.join(out,'system.wav'),captureSystemAudio:true}
  const child=spawn(path.resolve(__dirname,'../resources/video/ta-recorder.exe'),[JSON.stringify(config)],{windowsHide:true})
  let log='', buffer=''; child.stderr.on('data',d=>log+=d)
  const timeout=setTimeout(()=>child.kill(),60000)
  child.stdout.on('data',d=>{log+=d;buffer+=d;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){if(line.startsWith('{')){let event;try{event=JSON.parse(line)}catch{continue}if(event.event==='recording-started'){setTimeout(()=>child.stdin.write('pause\n'),1700);setTimeout(()=>child.stdin.write('resume\n'),2400);setTimeout(()=>crash?child.kill():child.stdin.write('stop\n'),4200)}}}})
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0||crash?resolve():reject(new Error('Recorder failed '+code+' '+log)))})
  clearTimeout(timeout); marker.close();bg.close();fs.writeFileSync(path.join(out,'native.log'),log)
  const ff=path.resolve(__dirname,'../resources/video/ffmpeg.exe'), probe=path.resolve(__dirname,'../resources/video/ffprobe.exe')
  const info=JSON.parse(execFileSync(probe,['-v','error','-show_streams','-show_format','-of','json',config.screenPath],{encoding:'utf8',windowsHide:true}))
  const px=execFileSync(ff,['-v','error','-ss','1','-i',config.screenPath,'-vf',`crop=2:2:${Math.round(130*s)}:${Math.round(130*s)},format=rgb24`,'-frames:v','1','-f','rawvideo','pipe:1'],{windowsHide:true})
  const result={width:info.streams[0].width,height:info.streams[0].height,duration:Number(info.format.duration),pixel:[...px.subarray(0,3)],excluded:Math.abs(px[0]-24)<20&&Math.abs(px[1]-160)<20&&Math.abs(px[2]-100)<20,paused:log.includes('recording-paused'),resumed:log.includes('recording-resumed'),separateAudio:fs.statSync(config.systemPath).size>44,fragmented:log.includes('fragmented-mp4')}
  fs.writeFileSync(path.join(out,crash?'crash-result.json':'result.json'),JSON.stringify({...result,crash},null,2));console.log(JSON.stringify({...result,crash}));app.exit(result.excluded&&result.paused&&result.resumed&&result.separateAudio&&result.duration>1?0:1)
}).catch(error=>{console.error(error);app.exit(1)})
