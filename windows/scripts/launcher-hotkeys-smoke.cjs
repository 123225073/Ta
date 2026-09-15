const fs = require('node:fs'), path = require('node:path'), {execFile} = require('node:child_process')
const {app, BrowserWindow, globalShortcut} = require('electron')
const bundle=process.env.TA_VIDEO_RESOURCES_DIR
if(bundle){Object.defineProperty(app,'isPackaged',{value:true});process.resourcesPath=bundle}
const out = path.resolve(__dirname, '../output/launcher-hotkeys-' + Date.now())
fs.mkdirSync(out, {recursive: true})
process.env.TA_E2E_USER_DATA_DIR = path.join(out, 'profile')
process.argv.push('--minimized')
const keyScript = path.join(out, 'press.ps1')
fs.writeFileSync(keyScript, `param([int]$Key)
Add-Type @'
using System; using System.Runtime.InteropServices;
public class TaKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }
'@
[TaKeys]::keybd_event(17,0,0,[UIntPtr]::Zero)
[TaKeys]::keybd_event([byte]$Key,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[TaKeys]::keybd_event([byte]$Key,0,2,[UIntPtr]::Zero)
[TaKeys]::keybd_event(17,0,2,[UIntPtr]::Zero)
`)
const delay = ms => new Promise(r => setTimeout(r, ms))
async function until(check, label) {for (let i=0;i<150;i++){if(check())return;await delay(100)}throw Error(label)}
const press = key => new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',keyScript,String(key)],{windowsHide:true},e=>e?reject(e):resolve()))
const find = route => BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#/'+route))
require(bundle?path.join(bundle,'app.asar/dist-electron/main.js'):'../dist-electron/main.js')
async function run() {
  await app.whenReady()
  await until(()=>globalShortcut.isRegistered('Control+F1')&&globalShortcut.isRegistered('Control+F2'),'Global keys not registered')
  await press(112)
  await until(()=>find('home')?.isVisible()&&find('home')?.isFocused(),'Ctrl+F1 did not show home')
  const home=find('home');home.minimize();await until(()=>home.isMinimized(),'Home did not minimize')
  await press(112);await until(()=>home.isVisible()&&!home.isMinimized()&&home.isFocused(),'Home not restored')
  home.close();await until(()=>!home.isVisible(),'Home did not hide to tray')
  await press(112);await until(()=>home.isVisible()&&home.isFocused(),'Hidden home not restored')
  await press(113);await until(()=>find('video')?.isVisible()&&find('video')?.isFocused(),'Ctrl+F2 did not open recording')
  const video=find('video'),id=video.id;video.minimize();await until(()=>video.isMinimized(),'Video did not minimize')
  await press(113);await until(()=>video.isVisible()&&!video.isMinimized()&&video.isFocused(),'Video not restored')
  if(find('video').id!==id)throw Error('Recording window duplicated')
  await press(112);await until(()=>home.isFocused(),'Cannot switch back to home')
  const result={passed:true,nativeGlobalKeys:true,homeFromBackground:true,homeMinimized:true,homeHidden:true,videoFromBackground:true,videoMinimized:true,reusesVideoWindow:true,output:out}
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(0)
}
run().catch(e=>{fs.writeFileSync(path.join(out,'error.txt'),e.stack);console.error(e);app.exit(1)})
