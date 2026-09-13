import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import type { SopDocument } from './model'
import { timestamp } from './model'

export interface FeishuSettings { executable:string; profile:string; parentToken:string }
export interface FeishuReceipt { url:string; complete:boolean; steps:number; images:number; message:string }
export type CliRunner=(settings:FeishuSettings,args:string[],cwd:string)=>Promise<any>
export const xml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\r?\n/g,'<br/>')
export function validateFeishu(value:FeishuSettings):FeishuSettings {
  if(!value||typeof value.executable!=='string'||typeof value.profile!=='string'||typeof value.parentToken!=='string')throw Error('飞书配置格式无效。')
  const s={executable:value.executable.trim(),profile:value.profile.trim(),parentToken:value.parentToken.trim()}
  if(s.executable&&(!path.isAbsolute(s.executable)||!s.executable.toLowerCase().endsWith('.exe')))throw Error('请选择 lark-cli.exe 的完整路径。')
  if(s.profile&&!/^[\w-]{1,100}$/.test(s.profile))throw Error('配置名称只能使用字母、数字、下划线或短横线。')
  if(/^https:\/\//i.test(s.parentToken)){const u=new URL(s.parentToken),m=/^\/(?:drive\/folder|wiki)\/([a-zA-Z0-9]+)\/?$/.exec(u.pathname);if(!/\.(feishu\.cn|larksuite\.com)$/.test(u.hostname)||!m)throw Error('请填写有效的飞书文件夹或知识库链接。');s.parentToken=m[1]}
  if(s.parentToken&&!/^[a-zA-Z0-9]{5,200}$/.test(s.parentToken))throw Error('目标位置请填写飞书文件夹、知识库链接或对应 token。')
  return s
}
export const runCli:CliRunner=(settings,args,cwd)=>new Promise((resolve,reject)=>{
  if(!settings.executable||!fs.existsSync(settings.executable)){reject(Error('未找到飞书 CLI，请在设置中选择 lark-cli.exe。'));return}
  execFile(settings.executable,[...args,...(settings.profile?['--profile',settings.profile]:[])],{cwd,windowsHide:true,timeout:180000,maxBuffer:8*1024*1024,encoding:'utf8',env:{...process.env,LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'}},(err,stdout,stderr)=>{
    let value:any
    try{value=JSON.parse((err?stderr:stdout).trim())}catch{reject(Error(err?'飞书 CLI 执行失败或超时，请检查网络与 CLI 登录状态。':'飞书 CLI 返回了无法识别的结果，请检查版本。'));return}
    if(err||value.ok===false){const e=value.error??{};reject(Error(e.subtype==='confirmation_required'?'飞书 CLI 要求额外确认，已停止操作。':String(e.message??'飞书操作失败').slice(0,600)+(e.missing_scopes?.length?'；请在 CLI 中补充文档与图片权限。':'')));return}
    resolve(value)
  })
})
export class FeishuService {
  private publishing=false
  constructor(private root:string,private run:CliRunner=runCli){}
  settings():FeishuSettings {
    const file=path.join(this.root,'feishu-cli.json')
    if(fs.existsSync(file))return validateFeishu(JSON.parse(fs.readFileSync(file,'utf8')))
    const candidate=path.join(process.env.APPDATA??'', 'npm/node_modules/@larksuite/cli/bin/lark-cli.exe')
    return {executable:fs.existsSync(candidate)?candidate:'',profile:'',parentToken:''}
  }
  save(value:FeishuSettings){const s=validateFeishu(value);fs.mkdirSync(this.root,{recursive:true});const f=path.join(this.root,'feishu-cli.json');fs.writeFileSync(f+'.tmp',JSON.stringify(s,null,2));fs.renameSync(f+'.tmp',f);return s}
  async status(value:FeishuSettings){const s=validateFeishu(value);const v=await this.run(s,['auth','status','--json','--verify'],this.root),a=v.data??v,u=a.identities?.user;if(a.verified!==true||a.identity!=='user'||!['ready','needs_refresh'].includes(u?.status))throw Error('飞书用户登录尚未就绪。请先在 CLI 登录并授予 docs、drive 权限，再测试连接。');return {message:`已连接：${u.userName??'飞书用户'}`,userName:String(u.userName??'飞书用户')}}
  private receiptFile(id:string){return path.join(this.root,'feishu-publish-'+createHash('sha256').update(id).digest('hex').slice(0,24)+'.json')}
  receipt(id:string):FeishuReceipt|undefined {const f=this.receiptFile(id);if(fs.existsSync(f))return JSON.parse(fs.readFileSync(f,'utf8'))}
  private record(id:string,r:FeishuReceipt){fs.mkdirSync(this.root,{recursive:true});const f=this.receiptFile(id);fs.writeFileSync(f+'.tmp',JSON.stringify(r,null,2));fs.renameSync(f+'.tmp',f);return r}
  async publish(d:SopDocument,asset:(file:string)=>string,progress:(s:string)=>void):Promise<FeishuReceipt>{
    if(this.publishing)throw Error('已有文档正在发布，请等待完成。')
    if(!d.steps.length)throw Error('请先生成或添加步骤。')
    this.publishing=true
    let temp='',url='',docId='',steps=0,images=0
    try {
      const s=this.settings();await this.status(s)
      temp=fs.mkdtempSync(path.join(os.tmpdir(),'ta-feishu-'))
      // Resolve every local asset before making any external change.
      for(const step of d.steps)for(const im of step.images){const from=asset(im.file);fs.copyFileSync(from,path.join(temp,im.file))}
      const call=async(args:string[])=>{const r=await this.run(s,[...args,'--as','user','--json'],temp);if(r.ok!==true)throw Error('飞书 CLI 未确认操作成功。');return r.data}
      const write=async(args:string[],body:string)=>{fs.writeFileSync(path.join(temp,'content.xml'),body,'utf8');return call([...args,'--doc-format','xml','--content','@content.xml'])}
      progress('正在创建飞书文档…')
      const created=await write(['docs','+create',...(s.parentToken?['--parent-token',s.parentToken]:[])],`<title>${xml(d.title)}</title><p>${xml(d.description)}</p><p>适用读者：${xml(d.audience)}</p>`)
      docId=String(created?.document?.document_id??'');url=String(created?.document?.url??'');if(!/^[a-zA-Z0-9]+$/.test(docId)||!/^https:\/\/[\w.-]+\.(feishu\.cn|larksuite\.com)\/(docx|wiki)\/[a-zA-Z0-9]+$/.test(url))throw Error('文档可能已创建，但 CLI 未返回有效文档链接，请在飞书中核对后再操作。')
      this.record(d.projectId,{url,complete:false,steps,images,message:'文档已创建，发布尚未完成。如软件中途关闭，请打开飞书核对。'})
      const append=(body:string)=>write(['docs','+update','--doc',docId,'--command','append'],body)
      for(const [n,step] of d.steps.entries()){
        progress(`正在发布步骤 ${n+1}/${d.steps.length}…`)
        await append(`<h1>${n+1}. ${xml(step.title)}</h1><p>${xml(step.body)}</p>`)
        for(const im of step.images){await call(['docs','+media-insert','--doc',docId,'--file',im.file,'--type','image','--width','800','--caption',`${im.caption}${im.time===null?' · 补充截图':' · 原视频 '+timestamp(im.time)}`]);images++}
        if(step.expected||step.note)await append(`${step.expected?`<p><b>完成后：</b>${xml(step.expected)}</p>`:''}${step.note?`<p><b>提示：</b>${xml(step.note)}</p>`:''}`)
        steps++
      }
      await call(['docs','+fetch','--doc',docId,'--scope','outline'])
      return this.record(d.projectId,{url,complete:true,steps,images,message:`已发布 ${steps} 个步骤、${images} 张配图。`})
    }catch(e){const message=e instanceof Error?e.message:String(e);if(url)return this.record(d.projectId,{url,complete:false,steps,images,message:`发布未完成：${message} 已完成 ${steps} 个步骤、${images} 张配图。请打开文档核对；再次发布会创建新文档。`});throw Error(message+' 如创建请求已发出但未收到结果，请先检查飞书，避免重复创建。')}
    finally{this.publishing=false;if(temp){for(const name of fs.readdirSync(temp))fs.unlinkSync(path.join(temp,name));fs.rmdirSync(temp)}}
  }
}
