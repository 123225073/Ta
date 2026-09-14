import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { validateEdits, type VideoProject, type VideoSettings } from './model'
export class VideoStore {
  private index:Record<string,string>={}
  settings:VideoSettings
  constructor(private metadata:string,defaultRoot:string){
    fs.mkdirSync(metadata,{recursive:true})
    this.settings={root:defaultRoot,startKey:'Ctrl+Shift+7',pauseKey:'Ctrl+Shift+8',stopKey:'Ctrl+Shift+9',annotateKey:'Ctrl+Shift+0',mic:false,system:false,micName:'',countdown:3}
    try{this.index=JSON.parse(fs.readFileSync(path.join(metadata,'index.json'),'utf8'))}catch{}
    try{this.settings={...this.settings,...JSON.parse(fs.readFileSync(path.join(metadata,'settings.json'),'utf8'))}}catch{}
  }
  private atomic(file:string,value:unknown){
    const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2),{flush:true})
    // Defender/indexers can briefly hold a Windows file without delete sharing.
    // Keep both the old project and the new .tmp while retrying its replacement.
    const sleeper=new Int32Array(new SharedArrayBuffer(4))
    for(let attempt=0;;attempt++){
      try{if(fs.existsSync(file)){let valid=false;try{JSON.parse(fs.readFileSync(file,'utf8'));valid=true}catch{}if(valid)fs.copyFileSync(file,file+'.backup')}fs.renameSync(temp,file);return}
      catch(e){if(attempt>=3||!['EPERM','EBUSY','EACCES'].includes((e as NodeJS.ErrnoException).code??''))throw e;Atomics.wait(sleeper,0,0,20*2**attempt)}
    }
  }
  saveSettings(s:VideoSettings){this.settings=s;this.atomic(path.join(this.metadata,'settings.json'),s)}
  directory(id:string){if(!/^\d{13}-[a-f0-9]{8}$/.test(id)||!Object.hasOwn(this.index,id))throw Error('录屏项目不存在。');return this.index[id]}
  file(id:string,name:string){if(!['screen.mp4','system.wav','mic.wav','project.json','thumbnail.jpg'].includes(name))throw Error('媒体类型无效。');return path.join(this.directory(id),name)}
  media(id:string,name:string){if(/^edit-[a-f0-9]{16}\.(mp4|wav)$/.test(name)&&this.get(id).assets?.some(a=>a.file===name))return path.join(this.directory(id),name);return this.file(id,name)}
  create(width:number,height:number,hasMic:boolean,hasSystem:boolean){
    const id=Date.now()+'-'+crypto.randomBytes(4).toString('hex'), date=new Date()
    const dir=path.join(this.settings.root,String(date.getFullYear()),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0'),id)
    fs.mkdirSync(dir,{recursive:true});this.index[id]=dir;this.atomic(path.join(this.metadata,'index.json'),this.index)
    const p:VideoProject={schemaVersion:1,id,title:`录屏 ${date.toLocaleString('zh-CN')}`,createdAt:date.toISOString(),revision:0,width,height,duration:1,status:'recording',hasMic,hasSystem,marks:[],cuts:[],mutes:[],zooms:[],crop:{x:0,y:0,width,height},micVolume:1,systemVolume:1,exports:[]}
    this.write(p);return p
  }
  get(id:string):VideoProject{const file=this.file(id,'project.json');try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{try{return JSON.parse(fs.readFileSync(file+'.backup','utf8'))}catch{throw Error('项目文件无法读取。原始录像仍保留在保存目录。')}}}
  write(p:VideoProject){this.atomic(this.file(p.id,'project.json'),p)}
  save(id:string,edit:unknown){const base=this.get(id);if(base.status==='recording')throw Error('录制完成后才能编辑。');const p=validateEdits(edit,base);this.write(p);return p}
  list(){return Object.keys(this.index).sort().reverse().flatMap(id=>{try{return[this.get(id)]}catch{return[]}})}
}
