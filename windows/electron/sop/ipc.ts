import { BrowserWindow, clipboard, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } from 'docx'
import sharp from 'sharp'
import { SopService } from './service'
import { parseSubtitles, timestamp, type SopDocument } from './model'
import { containFit } from './export-utils'

export function installSop(service:SopService, editor:(e:IpcMainInvokeEvent)=>void, window:()=>BrowserWindow|undefined) {
  const handle=(name:string,fn:(...args:any[])=>unknown)=>ipcMain.handle('sop:'+name,(e,...args)=>{editor(e);return fn(...args)})
  handle('get',id=>service.get(id))
  handle('save',d=>service.save(d))
  handle('generate',id=>service.generate(id))
  handle('chat',(id,prompt,selected,time)=>service.chat(id,prompt,selected,time))
  handle('cancel',id=>service.cancel(id))
  handle('frame',(id,time)=>service.frame(id,time))
  handle('versions',id=>service.versions(id))
  handle('restore',(id,revision)=>service.restore(id,revision))
  handle('transform',(id,image,mode,rect)=>service.transform(id,image,mode,rect))
  handle('import-video',async()=>{const r=await dialog.showOpenDialog(window()!,{title:'导入视频生成 SOP',properties:['openFile'],filters:[{name:'视频',extensions:['mp4','mkv','mov','webm','avi']}]});if(!r.canceled)return service.importVideo(r.filePaths[0])})
  handle('image',async(id,paste)=>{if(paste===true){const items=await clipboard.read();for(const item of items){const type=item.types.find(t=>t.startsWith('image/'));if(type){const blob=await item.getType(type);if(blob instanceof Blob)return service.upload(id,Buffer.from(await blob.arrayBuffer()))}}throw Error('剪贴板中没有图片。')}
    const r=await dialog.showOpenDialog(window()!,{title:'添加补充截图',properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp']}]});if(!r.canceled){if(fs.statSync(r.filePaths[0]).size>30*1024*1024)throw Error('图片不能超过 30 MB。');return service.upload(id,fs.readFileSync(r.filePaths[0]))}})
  handle('subtitles',async id=>{const r=await dialog.showOpenDialog(window()!,{title:'导入讲解字幕',properties:['openFile'],filters:[{name:'字幕',extensions:['srt','vtt']}]});if(r.canceled)return
    const d=service.get(id);if(fs.statSync(r.filePaths[0]).size>4*1024*1024)throw Error('字幕文件过大。');d.transcript=parseSubtitles(fs.readFileSync(r.filePaths[0],'utf8'),service.duration(id));return service.save(d,'导入字幕')})
  handle('transcribe',(id,model)=>service.transcribe(id,model))
  handle('export',async(id,format)=>{
    if(!['html','md','pdf','docx'].includes(format))throw Error('导出格式无效。')
    const d=service.get(id);if(!d.steps.length)throw Error('请先生成或添加步骤。')
    const r=await dialog.showSaveDialog(window()!,{title:'导出 SOP',defaultPath:d.title.replace(/[<>:"/\\|?*]/g,'-')+'.'+format,filters:[{name:format.toUpperCase(),extensions:[format]}]})
    if(r.canceled||!r.filePath)return
    if(fs.existsSync(r.filePath))throw Error('该文件已存在，请使用新名称。')
    if(format==='html')fs.writeFileSync(r.filePath,service.html(d),{flag:'wx'})
    else if(format==='md'){
      const images=new Map<string,string>(),assetDir=path.basename(r.filePath,'.md')+'-images-'+Date.now(),dir=path.join(path.dirname(r.filePath),assetDir)
      fs.mkdirSync(dir,{recursive:false})
      for(const s of d.steps)for(const i of s.images)if(!images.has(i.file)){fs.copyFileSync(service.asset(id,i.file),path.join(dir,i.file),fs.constants.COPYFILE_EXCL);images.set(i.file,`${encodeURIComponent(assetDir)}/${i.file}`)}
      const plain=(v:string)=>v.replace(/[\\`*_{}\[\]<>#]/g,'\\$&')
      fs.writeFileSync(r.filePath,`# ${plain(d.title)}\n\n${plain(d.description)}\n\n${d.steps.map((s,i)=>`## ${i+1}. ${plain(s.title)}\n\n${plain(s.body)}\n\n${s.images.map(im=>`![${plain(im.caption)}](${images.get(im.file)})\n\n${im.time===null?'补充截图':'原视频 '+timestamp(im.time)}`).join('\n\n')}\n\n${s.expected?'**完成后：** '+plain(s.expected):''}\n\n${s.note?'> '+plain(s.note).replace(/\n/g,'\n> '):''}`).join('\n\n')}`,{flag:'wx'})
    }else if(format==='docx')fs.writeFileSync(r.filePath,await word(service,d),{flag:'wx'})
    else {
      const print=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}})
      const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'ta-sop-print-')),tempFile=path.join(tempDir,'document.html')
      try{fs.writeFileSync(tempFile,service.html(d),{flag:'wx'});await print.loadFile(tempFile);const pdf=await print.webContents.printToPDF({printBackground:true,pageSize:'A4',preferCSSPageSize:true});fs.writeFileSync(r.filePath,pdf,{flag:'wx'})}finally{print.destroy();if(fs.existsSync(tempFile))fs.unlinkSync(tempFile);fs.rmdirSync(tempDir)}
    }return r.filePath
  })
}
export async function word(service:SopService,d:SopDocument) {
  const p=(text:string,heading?:typeof HeadingLevel[keyof typeof HeadingLevel])=>new Paragraph({heading,children:text.split('\n').flatMap((s,i)=>[new TextRun({text:s,break:i?1:0})]),spacing:{after:160}})
  const children:Paragraph[]=[p(d.title,HeadingLevel.TITLE),p(d.description),p('适用读者：'+d.audience)]
  for(const [n,s] of d.steps.entries()){children.push(p(`${n+1}. ${s.title}`,HeadingLevel.HEADING_1),p(s.body))
    for(const image of s.images){const data=await sharp(service.asset(d.projectId,image.file)).png().toBuffer(),size=await sharp(data).metadata(),fit=containFit(size.width!,size.height!,600,650)
      children.push(new Paragraph({children:[new ImageRun({data,type:'png',transformation:{width:fit.width,height:fit.height}})]}),p(image.caption+(image.time===null?' · 补充截图':' · 原视频 '+timestamp(image.time))))}
    if(s.expected)children.push(p('完成后：'+s.expected));if(s.note)children.push(p('提示：'+s.note))
  }
  return Packer.toBuffer(new Document({styles:{default:{document:{run:{font:'Microsoft YaHei',size:22}}}},sections:[{children}]}))
}
