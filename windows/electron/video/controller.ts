import { importTimelineMedia } from './import-media'
import {VideoCLI,type CLIRequest} from './cli-engine'
import { mediaResponse } from './media-response'
import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, powerMonitor, protocol, screen, shell, type IpcMainInvokeEvent } from 'electron'
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { VideoStore } from './store'
import { VideoExporter } from './export'
import { SopService, type AIContext } from '../sop/service'
import { installSop } from '../sop/ipc'
import { assetPattern } from '../sop/model'
import { clamp,validateEdits,type Mark,type Rect,type RecordingOptions,type RecordingSource,type RecordingState,type VideoProject,type VideoSettings } from './model'
const exec=promisify(execFile)
export class VideoController {
  window?:BrowserWindow; private hud?:BrowserWindow; private ink?:BrowserWindow
  private store:VideoStore; private exporter:VideoExporter; private bin:string
  private child?:ChildProcessWithoutNullStreams; private project?:VideoProject
  private state:RecordingState={phase:'idle',elapsed:0}; private started=0; private accumulated=0
  private tick?:ReturnType<typeof setInterval>;private sources:RecordingSource[]=[];private currentSource?:RecordingSource
  private registered:string[]=[]; private stopWait?:Promise<void>; private errorLog=''
  private recovery:Promise<void>
  private quitting=false
  private closeDone?:()=>void
  private checkingSource=false
  private cliQueue:Promise<unknown>=Promise.resolve()
  private cliProject?:string
  private cliUndo?:VideoProject
  runCLI(request:CLIRequest){const job=this.cliQueue.catch(()=>{}).then(async()=>{await this.recovery;if(this.active()||this.exporter.busy)throw Error('BUSY: recording or export in progress');const writing=['apply','undo','redo','import','export'].includes(request.command)&&!request.dryRun,previous=this.window
    if(writing&&previous&&!previous.isDestroyed()){await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{previous.removeListener('closed',closed);reject(Error('BUSY: editor did not finish saving'))},15000);const closed=()=>{clearTimeout(timer);resolve()};previous.once('closed',closed);previous.webContents.send('video:closing')})}
    if(writing)this.cliUndo=undefined
    try{const before=writing&&request.projectId?this.store.get(request.projectId):undefined,result=await new VideoCLI(this.store,this.bin,this.exporter).execute(request);if(['apply','undo','redo'].includes(request.command)&&writing&&previous)this.cliUndo=before;return result}finally{if(writing&&previous){this.cliProject=request.projectId;await this.open()}}
  });this.cliQueue=job;return job}
  constructor(private load:(w:BrowserWindow,route:string)=>Promise<void>,private theme:()=>string, ai:AIContext=()=>{throw Error('请先在拓 Ta 主窗口的设置中配置视觉 AI 服务。')}){
    this.bin=app.isPackaged?path.join(process.resourcesPath,'video'):path.resolve(__dirname,'../../resources/video')
    this.store=new VideoStore(path.join(app.getPath('userData'),'video'),path.join(app.getPath('videos'),'拓 Ta'))
    this.exporter=new VideoExporter(this.bin,this.store,p=>this.window?.webContents.send('video:export-progress',p))
    this.recovery=this.recover()
    const sop=new SopService(this.store,this.bin,ai,p=>this.window?.webContents.send('sop:progress',p))
    installSop(sop,e=>this.editor(e),()=>this.window)
    this.install();this.registerHotkeys()
    powerMonitor.on('lock-screen',()=>{void this.pause(true,'屏幕已锁定，录制已暂停。')});powerMonitor.on('suspend',()=>{void this.pause(true,'电脑休眠，录制已暂停。')})
    screen.on('display-removed',()=>{void this.pause(true,'显示器已断开，请检查录制范围。')})
  }
  active(){return this.state.phase!=='idle'}
  async shutdown(){await this.stop();if(this.window&&!this.window.isDestroyed()){await new Promise<void>(resolve=>{this.closeDone=resolve;const w=this.window!;if(w.webContents.isLoadingMainFrame())w.webContents.once('did-finish-load',()=>w.webContents.send('video:closing'));else w.webContents.send('video:closing')})}this.quitting=true}
  private async recover(){for(const p of this.store.list().filter(p=>p.status==='recording')){try{const {stdout}=await exec(path.join(this.bin,'ffprobe.exe'),['-v','error','-show_streams','-show_format','-of','json',this.store.file(p.id,'screen.mp4')],{windowsHide:true,timeout:15000});const info=JSON.parse(stdout),v=info.streams.find((s:{codec_type:string})=>s.codec_type==='video');if(v){p.width=v.width;p.height=v.height;p.crop={x:0,y:0,width:v.width,height:v.height};p.duration=Math.max(1,Math.round(Number(info.format.duration)*1000))}}catch{}p.marks=p.marks.map(m=>({...m,end:Math.min(m.end,p.duration),points:m.points?.filter(pt=>pt.t===undefined||pt.t<=p.duration)})).filter(m=>m.end>m.start);p.status='recovered';this.store.write(p);if(!fs.existsSync(this.store.file(p.id,'thumbnail.jpg')))await exec(path.join(this.bin,'ffmpeg.exe'),['-v','error','-y','-i',this.store.file(p.id,'screen.mp4'),'-frames:v','1','-vf','scale=360:-2',this.store.file(p.id,'thumbnail.jpg')],{windowsHide:true,timeout:15000}).catch(()=>{})}}
  private trusted(event:IpcMainInvokeEvent){if(![this.window,this.hud,this.ink].some(w=>w&&!w.isDestroyed()&&w.webContents===event.sender)||event.senderFrame!==event.sender.mainFrame)throw Error('录屏窗口权限无效。')}
  private editor(event:IpcMainInvokeEvent){this.trusted(event);if(event.sender!==this.window?.webContents)throw Error('请在录屏编辑器执行此操作。')}
  private send(){const state={...this.state,elapsed:this.elapsed(),marks:this.project?.marks};for(const w of [this.window,this.hud,this.ink])if(w&&!w.isDestroyed())w.webContents.send('video:state',state)}
  private elapsed(){return this.accumulated+(this.state.phase==='recording'?Date.now()-this.started:0)}
  private createWindow(route:string,options:Electron.BrowserWindowConstructorOptions){const w=new BrowserWindow({...options,webPreferences:{preload:path.resolve(__dirname,'../preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});void this.load(w,route);return w}
  async open(){if(this.window&&!this.window.isDestroyed()){if(this.window.isMinimized())this.window.restore();this.window.show();this.window.focus();return}this.window=this.createWindow('video',{width:1240,height:860,minWidth:940,minHeight:660,title:'拓 Ta · 录屏与 SOP',backgroundColor:this.theme()==='light'?'#F6F3EC':'#090C0F'});this.window.on('close',e=>{e.preventDefault();this.window?.webContents.send('video:closing')});this.window.on('closed',()=>{this.window=undefined})}
  releaseHotkeys(){for(const k of this.registered)globalShortcut.unregister(k);this.registered=[]}
  registerHotkeys(){this.releaseHotkeys();const s=this.store.settings;const report=(e:unknown)=>{this.state.message=e instanceof Error?e.message:String(e);this.send()};const handlers=[()=>void this.open().catch(report),()=>void this.pause(this.state.phase!=='paused').catch(report),()=>void this.stop().catch(report),()=>this.toggleInk()];return [s.startKey,s.pauseKey,s.stopKey,s.annotateKey].map((k,i)=>{if(!k)return true;try{const ok=globalShortcut.register(k,handlers[i]);if(ok)this.registered.push(k);return ok}catch{return false}})}
  private async getSources(){
    const raw=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:360,height:220},fetchWindowIcons:false})
    this.sources=raw.filter(s=>!s.name.startsWith('拓 Ta')).map(s=>{const d=screen.getAllDisplays().find(d=>String(d.id)===s.display_id);return{id:s.id,name:s.name,kind:s.id.startsWith('screen:')?'screen':'window',displayId:s.display_id,thumbnail:s.thumbnail.toDataURL(),bounds:d?.bounds,scale:d?.scaleFactor??1}})
    for(const s of this.sources.filter(s=>s.kind==='screen'&&s.bounds)){const r=screen.dipToScreenRect(null,s.bounds!);try{s.physical=JSON.parse((await exec(path.join(this.bin,'ta-recorder.exe'),['--display-info',String(Math.round(r.x+r.width/2)),String(Math.round(r.y+r.height/2))],{windowsHide:true,timeout:5000})).stdout)}catch{}}
    return this.sources
  }
  private async microphones(){try{return JSON.parse((await exec(path.join(this.bin,'ta-recorder.exe'),['--list-mics'],{windowsHide:true,timeout:10000})).stdout) as string[]}catch{return[]}}
  private async windowInfo(id:string){const h=id.split(':')[1];if(!/^\d+$/.test(h))throw Error('窗口标识无效。');return JSON.parse((await exec(path.join(this.bin,'ta-recorder.exe'),['--window-info',h],{windowsHide:true,timeout:5000})).stdout) as Rect&{minimized:boolean}}
  private async checkSource(){if(this.checkingSource||this.currentSource?.kind!=='window'||this.state.phase!=='recording')return;this.checkingSource=true;try{const r=await this.windowInfo(this.currentSource.id);if(r.minimized){await this.pause(true,'窗口已最小化，录制已暂停。');return}if(this.project&&(Math.abs(r.width-this.project.width)>2||Math.abs(r.height-this.project.height)>2)){await this.pause(true,'窗口尺寸已改变，请恢复原大小后继续。');return}const bounds=screen.screenToDipRect(null,r);this.ink?.setBounds(bounds);this.state.bounds=bounds}catch{await this.pause(true,'录制窗口已关闭，请停止并保存已录片段。')}finally{this.checkingSource=false}}
  async start(options:RecordingOptions){
    if(this.active())throw Error('已有录制正在进行。')
    if(!fs.existsSync(path.join(this.bin,'ta-recorder.exe'))||!fs.existsSync(path.join(this.bin,'ffprobe.exe')))throw Error('录屏组件尚未准备好，请完成视频组件构建。')
    const source=this.sources.find(s=>s.id===options.sourceId);if(!source)throw Error('请重新选择录制范围。')
    if(typeof options.mic!=='boolean'||typeof options.system!=='boolean'||typeof options.micName!=='string'||options.micName.length>300)throw Error('录音设置无效。')
    let physical:Rect, dip:Rect,crop:Rect
    if(source.kind==='screen'){
      if(!source.bounds)throw Error('显示器已断开。');physical=source.physical??screen.dipToScreenRect(null,source.bounds)
      const r=options.region??{x:0,y:0,width:physical.width,height:physical.height}
      if(![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<16||r.height<16||r.x+r.width>physical.width||r.y+r.height>physical.height)throw Error('录制框超出屏幕范围。')
      crop={x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width/2)*2,height:Math.floor(r.height/2)*2};dip=screen.screenToDipRect(null,{x:physical.x+crop.x,y:physical.y+crop.y,width:crop.width,height:crop.height})
    }else{physical=await this.windowInfo(source.id);if((physical as Rect&{minimized:boolean}).minimized)throw Error('请先恢复要录制的窗口。');crop={x:0,y:0,width:Math.floor(physical.width/2)*2,height:Math.floor(physical.height/2)*2};dip=screen.screenToDipRect(null,physical)}
    const p=this.store.create(crop.width,crop.height,options.mic,options.system);this.project=p;this.currentSource=source
    this.store.saveSettings({...this.store.settings,mic:options.mic,system:options.system,micName:options.micName})
    this.state={phase:'starting',elapsed:0,id:p.id,bounds:dip,width:p.width,height:p.height,drawing:false};this.accumulated=0;this.send();this.errorLog=''
    const config={schemaVersion:2,sourceType:source.kind==='screen'?'display':'window',sourceId:source.id,displayId:Number(source.displayId)||0,hasDisplayBounds:source.kind==='screen',displayX:physical.x,displayY:physical.y,displayW:physical.width,displayH:physical.height,cropX:crop.x,cropY:crop.y,...(source.kind==='screen'&&options.region?{cropW:crop.width,cropH:crop.height}:{}),fps:30,captureCursor:true,captureMic:options.mic,captureSystemAudio:options.system,microphoneDeviceName:options.micName,screenPath:this.store.file(p.id,'screen.mp4'),systemPath:this.store.file(p.id,'system.wav'),micPath:this.store.file(p.id,'mic.wav')}
    this.ink=this.createWindow('video-ink',{...dip,frame:false,thickFrame:false,resizable:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,hasShadow:false,focusable:true});this.ink.setContentProtection(true);this.ink.setIgnoreMouseEvents(true,{forward:true})
    const d=screen.getDisplayMatching(dip);this.hud=this.createWindow('video-hud',{x:d.workArea.x+Math.max(0,Math.floor((d.workArea.width-660)/2)),y:d.workArea.y+16,width:660,height:112,frame:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,backgroundColor:'#11171C'});this.hud.setContentProtection(true);this.hud.setAlwaysOnTop(true,'screen-saver');this.hud.on('close',e=>{if(this.active()){e.preventDefault();void this.stop()}})
    this.window?.hide()
    const child=spawn(path.join(this.bin,'ta-recorder.exe'),[JSON.stringify(config)],{windowsHide:true,env:{...process.env,OPENSCREEN_WGC_LEGACY_FRAME_CALLBACK:'0'}});this.child=child;child.stdin.on('error',()=>{this.state.message='录制控制连接已断开，正在保留已录片段。'})
    this.stopWait=new Promise<void>(resolve=>child.once('close',code=>{if(code!==0)this.state.message='录制程序异常结束，已保留可恢复片段。';void this.finish().finally(resolve)}))
    child.stderr.on('data',d=>{this.errorLog=(this.errorLog+d).slice(-5000)})
    let buffer=''
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{child.stdin.write('stop\n');reject(Error('录制启动超时。'))},16000)
      child.once('error',e=>{clearTimeout(timer);reject(e);void this.finish()})
      child.once('close',code=>{clearTimeout(timer);if(this.state.phase==='starting')reject(Error('录制启动失败：'+this.errorLog.slice(-500)))})
      child.stdout.on('data',d=>{buffer+=d;const lines=buffer.split('\n');buffer=lines.pop()??'';for(const line of lines){if(!line.startsWith('{'))continue;let msg;try{msg=JSON.parse(line)}catch{continue}
        if(msg.event==='ta-size'){p.width=msg.width;p.height=msg.height;p.crop={x:0,y:0,width:p.width,height:p.height};this.state.width=p.width;this.state.height=p.height;this.store.write(p)}
        if(msg.event==='source-unavailable'){void this.pause(true,'录制源尺寸变化，请恢复窗口后继续。')}
        if(msg.event==='recording-started'){clearTimeout(timer);this.state.phase='recording';this.started=Date.now();this.send();this.tick=setInterval(()=>{void this.checkSource();this.send();p.duration=Math.max(1,this.elapsed());try{this.store.write(p)}catch{this.state.message='保存编辑记录失败，正在停止录制并保留原片。';void this.stop();return}try{const s=fs.statfsSync(this.store.directory(p.id));if(s.bavail*s.bsize<512*1024*1024)void this.stop()}catch{}},1000);resolve()}
      }})
    })
    return p.id
  }
  async pause(paused:boolean,message?:string){if(!['paused','recording'].includes(this.state.phase))return;if(paused&&this.state.phase==='recording'){this.accumulated=this.elapsed();this.state.phase='paused';this.child?.stdin.write('pause\n')}else if(!paused&&this.state.phase==='paused'){if(this.currentSource?.kind==='window'&&(await this.windowInfo(this.currentSource.id)).minimized)throw Error('请先恢复录制窗口。');this.started=Date.now();this.state.phase='recording';this.child?.stdin.write('resume\n')}this.state.message=message;this.send()}
  async stop(){if(!this.child)return;if(this.state.phase!=='stopping'){this.accumulated=this.elapsed();this.state.phase='stopping';this.child.stdin.write('stop\n');this.send()}await this.stopWait}
  private async finish(){
    if(this.tick)clearInterval(this.tick);const p=this.project;if(!p)return;this.project=undefined;this.child=undefined
    try{const {stdout}=await exec(path.join(this.bin,'ffprobe.exe'),['-v','error','-show_streams','-show_format','-of','json',this.store.file(p.id,'screen.mp4')],{windowsHide:true,timeout:15000});const info=JSON.parse(stdout),video=info.streams.find((s:{codec_type:string})=>s.codec_type==='video');if(!video)throw Error('没有有效视频帧');p.duration=Math.round(Number(info.format.duration)*1000);p.width=video.width;p.height=video.height;p.crop={x:0,y:0,width:p.width,height:p.height};p.marks=p.marks.map(m=>({...m,end:Math.min(m.end,p.duration),points:m.points?.filter(pt=>pt.t===undefined||pt.t<=p.duration)})).filter(m=>m.end>m.start);p.status=this.state.message?.includes('异常结束')?'recovered':'ready';this.store.write(p)
      await exec(path.join(this.bin,'ffmpeg.exe'),['-v','error','-y','-i',this.store.file(p.id,'screen.mp4'),'-frames:v','1','-vf','scale=360:-2',this.store.file(p.id,'thumbnail.jpg')],{windowsHide:true,timeout:15000})
    }catch(e){p.status='recovered';p.duration=Math.max(1,p.duration);try{this.store.write(p)}catch{/* Source media and last checkpoint remain available. */}this.state.message='录制未正常结束，已保留原始片段。'+(e instanceof Error?e.message:'')}
    this.state={phase:'idle',elapsed:0,message:this.state.message};this.ink?.destroy();this.ink=undefined;this.hud?.destroy();this.hud=undefined;await this.open();this.send();this.window?.webContents.send('video:finished',p.id)
  }
  toggleInk(){if(!this.ink||!this.active())return;this.state.drawing=!this.state.drawing;this.ink.setIgnoreMouseEvents(!this.state.drawing,{forward:true});if(this.state.drawing)this.ink.focus();this.send()}
  private install(){
    const handle=(name:string,fn:(e:IpcMainInvokeEvent,...args:any[])=>unknown)=>ipcMain.handle('video:'+name,(e,...args)=>{this.trusted(e);return fn(e,...args)})
    // The only host entry: existing Ta main renderer can open the video window.
    ipcMain.handle('video:open',e=>{const owner=BrowserWindow.fromWebContents(e.sender);if(!owner||e.senderFrame!==e.sender.mainFrame)throw Error('窗口无效。');return this.open()})
    handle('init',()=>{const projectId=this.cliProject,undoProject=this.cliUndo;this.cliProject=undefined;this.cliUndo=undefined;return {state:{...this.state,elapsed:this.elapsed(),marks:this.project?.marks},settings:this.store.settings,theme:this.theme(),projectId,undoProject}})
    handle('close-ready',e=>{this.editor(e);this.window?.destroy();this.closeDone?.();this.closeDone=undefined})
    handle('sources',(e)=>{this.editor(e);return this.getSources()});handle('microphones',()=>this.microphones())
    handle('list',async()=>{await this.recovery;return this.store.list()});handle('get',async(e,id)=>{this.editor(e);await this.recovery;return this.store.get(id)})
    handle('save',(e,id,edit)=>{this.editor(e);return this.store.save(id,edit)})
    handle('import-media',async(e,id,kind)=>{this.editor(e);this.store.get(id);if(!['audio','video'].includes(kind))throw Error('素材类型无效。');const r=await dialog.showOpenDialog(this.window!,{title:kind==='video'?'添加视频素材':'添加音频素材',properties:['openFile'],filters:[{name:'音视频素材',extensions:kind==='video'?['mp4','mkv','mov','webm','avi']:['wav','mp3','m4a','aac','ogg','flac','mp4']}]});if(!r.canceled)return importTimelineMedia(this.store,this.bin,id,r.filePaths[0],kind)})
    handle('start',(e,o)=>{this.editor(e);return this.start(o)})
    handle('pause',(_e,p)=>this.pause(p===true));handle('stop',()=>this.stop());handle('ink',()=>this.toggleInk())
    handle('mark',(_e,mark:Mark)=>{const p=this.project;if(!p||this.state.phase!=='recording')return;const duration=Math.max(86400000,this.elapsed()+1);const m={...mark,start:clamp(mark.start,0,this.elapsed()),end:duration};const checked=validateEdits({...p,marks:[...p.marks,m]}, {...p,duration});p.marks=checked.marks;this.store.write(p);this.send()})
    handle('clear',()=>{if(!this.project)return;const t=this.elapsed();this.project.marks=this.project.marks.map(m=>({...m,end:Math.min(m.end,t)})).filter(m=>m.end>m.start);this.store.write(this.project);this.send()})
    handle('undo-mark',()=>{this.project?.marks.pop();if(this.project)this.store.write(this.project);this.send()})
    handle('settings',async(e,changes:Partial<VideoSettings>)=>{this.editor(e);const s={...this.store.settings,...changes,root:this.store.settings.root};if(![s.startKey,s.pauseKey,s.stopKey,s.annotateKey].every(k=>typeof k==='string'&&k.length<80)||new Set([s.startKey,s.pauseKey,s.stopKey,s.annotateKey].filter(Boolean)).size!==[s.startKey,s.pauseKey,s.stopKey,s.annotateKey].filter(Boolean).length||![0,3,5].includes(s.countdown))throw Error('快捷键或倒计时设置无效。');const previous=this.store.settings;this.store.saveSettings(s);const keys=this.registerHotkeys();if(keys.some(k=>!k)){this.store.saveSettings(previous);this.registerHotkeys();throw Error('部分快捷键被占用，请换一个组合。')}return s})
    handle('choose-root',async(e)=>{this.editor(e);const r=await dialog.showOpenDialog(this.window!,{properties:['openDirectory','createDirectory']});if(!r.canceled)this.store.saveSettings({...this.store.settings,root:r.filePaths[0]});return this.store.settings})
    handle('folder',(e,id)=>{this.editor(e);return shell.openPath(id?this.store.directory(id):this.store.settings.root)})
    handle('export',async(e,id,height)=>{this.editor(e);if(![720,1080,2160,99999].includes(height))throw Error('输出尺寸无效。');const p=this.store.get(id);const r=await dialog.showSaveDialog(this.window!,{title:'导出视频',defaultPath:`${p.title.replace(/[<>:"/\\|?*]/g,'-')}-${Date.now()}.mp4`,filters:[{name:'MP4 视频',extensions:['mp4']}]});if(r.canceled||!r.filePath)return;if(fs.existsSync(r.filePath))throw Error('该文件已经存在，请使用新名称以保留旧成片。');return this.exporter.export(p,r.filePath,height)})
    handle('cancel-export',()=>this.exporter.cancel())
    protocol.handle('ta-video',async request=>{try{const u=new URL(request.url),[id,name]=u.pathname.split('/').filter(Boolean);if(u.hostname!=='media')return new Response(null,{status:404});const file=assetPattern.test(name)?path.join(this.store.directory(id),name):this.store.media(id,name);return mediaResponse(file,request)}catch{return new Response(null,{status:404})}})
  }
}
