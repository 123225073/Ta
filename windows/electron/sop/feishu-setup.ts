import fs from 'node:fs'
import path from 'node:path'
import { execFile,spawn,type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import type { FeishuSettings, CliRunner } from './feishu'
const exec=promisify(execFile)
const env={...process.env,LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'}
export interface CliDiscovery { installed:boolean;version:string;profiles:{name:string;user:string;active:boolean}[];settings:FeishuSettings }
export class FeishuSetup {
  private installing?:Promise<CliDiscovery>
  private device?:{code:string;settings:FeishuSettings}
  private init?:{child:ChildProcess;done:boolean;failed:boolean;url?:string}
  private authorizationUrl=''
  constructor(private root:string,private get:()=>FeishuSettings,private save:(s:FeishuSettings)=>FeishuSettings,private run:CliRunner,private fetcher:(url:string,init?:RequestInit)=>Promise<Response>=(url,init)=>fetch(url,init)){}
  async discover():Promise<CliDiscovery>{
    const s=this.get(),dirs=(process.env.PATH??'').split(path.delimiter)
    const candidates=[s.executable,path.join(this.root,'tools/feishu/lark-cli.exe'),path.join(process.env.APPDATA??'','npm/node_modules/@larksuite/cli/bin/lark-cli.exe'),...dirs.flatMap(d=>[path.join(d,'lark-cli.exe'),path.join(d,'node_modules/@larksuite/cli/bin/lark-cli.exe')])]
    for(const file of [...new Set(candidates.filter(Boolean))]){if(!fs.existsSync(file))continue;try{
      const r=await exec(file,['--version'],{windowsHide:true,timeout:10000,env});if(!/lark-cli|\d+\.\d+\.\d+/i.test(r.stdout))continue
      const settings={...s,executable:file},raw=await this.run(settings,['profile','list'],this.root).catch(()=>[]),list=Array.isArray(raw)?raw:raw.profiles??raw.data?.profiles??[]
      const profiles=list.filter((p:any)=>typeof p.name==='string').map((p:any)=>({name:p.name,user:String(p.user??''),active:p.active===true}))
      if(!settings.profile||!profiles.some((p:any)=>p.name===settings.profile))settings.profile=profiles.find((p:any)=>p.active)?.name??profiles[0]?.name??''
      return {installed:true,version:r.stdout.trim().slice(0,100),profiles,settings}
    }catch{}}
    return {installed:false,version:'',profiles:[],settings:{...s,executable:''}}
  }
  async configure(){const d=await this.discover();if(!d.installed)throw Error('尚未安装飞书 CLI。');this.save(d.settings);return d}
  install(){if(!this.installing)this.installing=this.download().finally(()=>{this.installing=undefined});return this.installing}
  private async download(){
    const existing=await this.discover();if(existing.installed){this.save(existing.settings);return existing}
    const fetchOK=async(url:string)=>{for(let attempt=0;attempt<3;attempt++){try{const r=await this.fetcher(url,{signal:AbortSignal.timeout(120000),headers:{'User-Agent':'Ta-Windows'}});if(!r.ok)throw Error('download');return new Response(await r.arrayBuffer())}catch{if(attempt===2)throw Error('飞书 CLI 下载失败，请检查网络后点击重试。');await new Promise(r=>setTimeout(r,500*(attempt+1)))}}throw Error('下载失败。')}
    let release:any
    try{release=await (await fetchOK('https://api.github.com/repos/larksuite/cli/releases/latest')).json()}
    catch{
      // Public GitHub API limits are shared by a network. The official npm package
      // supplies the release version; official release checksums still verify the binary.
      const pkg=await (await fetchOK('https://registry.npmjs.org/@larksuite/cli/latest')).json() as any
      if(!/^\d+\.\d+\.\d+$/.test(pkg.version))throw Error('官方 CLI 版本信息无效。')
      const name=`lark-cli-${pkg.version}-windows-amd64.zip`,base=`https://github.com/larksuite/cli/releases/download/v${pkg.version}/`
      const checksums=await (await fetchOK(base+'checksums.txt')).text(),entry=checksums.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).find(parts=>parts.at(-1)?.replace(/^\*/,'')===name)
      if(!entry||!/^[a-f0-9]{64}$/.test(entry[0]))throw Error('官方安装包校验信息不可用。')
      release={assets:[{name,digest:'sha256:'+entry[0],browser_download_url:base+name}]}
    }
    const asset=release.assets?.find((a:any)=>/^lark-cli-[\d.]+-windows-amd64\.zip$/.test(a.name))
    if(!asset||!/^sha256:[a-f0-9]{64}$/.test(asset.digest)||!asset.browser_download_url.startsWith('https://github.com/larksuite/cli/releases/download/'))throw Error('官方安装包或校验信息不可用，请稍后重试。')
    if(asset.size>150*1024*1024)throw Error('官方安装包大小异常。')
    const data=Buffer.from(await (await fetchOK(asset.browser_download_url)).arrayBuffer());if(createHash('sha256').update(data).digest('hex')!==asset.digest.slice(7))throw Error('安装包校验失败，请重试。')
    const dir=path.join(this.root,'tools/feishu');fs.mkdirSync(dir,{recursive:true});const archive=path.join(dir,'download.zip'),target=path.join(dir,'lark-cli.exe');fs.writeFileSync(archive,data)
    // Extract only the executable to an exact destination; never expand arbitrary ZIP paths.
    const script="Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:TA_CLI_ARCHIVE); try { $e=@($z.Entries | Where-Object {$_.Name -eq 'lark-cli.exe'}); if($e.Count -ne 1){throw 'Invalid CLI archive'}; [IO.Compression.ZipFileExtensions]::ExtractToFile($e[0],$env:TA_CLI_TARGET,$false) } finally {$z.Dispose()}"
    const tempTarget=target+'.new';if(fs.existsSync(tempTarget))fs.unlinkSync(tempTarget)
    try{await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:30000,env:{...env,TA_CLI_ARCHIVE:archive,TA_CLI_TARGET:tempTarget}});await exec(tempTarget,['--version'],{windowsHide:true,timeout:10000,env});fs.renameSync(tempTarget,target)}finally{fs.unlinkSync(archive);if(fs.existsSync(tempTarget))fs.unlinkSync(tempTarget)}
    const d=await this.discover();if(!d.installed)throw Error('安装完成但 CLI 检查失败，请重试。');this.save(d.settings);return d
  }
  async login(settings:FeishuSettings){
    settings=this.save(settings)
    const raw=await this.run(settings,['auth','login','--domain','docs','--domain','drive','--no-wait','--json'],this.root),r=raw.data??raw
    const url=r.verification_uri_complete??r.verification_url??r.verification_uri,code=r.device_code
    if(typeof url!=='string'||!url.startsWith('https://')||typeof code!=='string')throw Error('CLI 未返回授权链接，请检查本机账号配置。')
    this.device={code,settings};return this.qrcode(settings,url)
  }
  private async qrcode(settings:FeishuSettings,url:string){
    const parsed=new URL(url);if(parsed.protocol!=='https:'||!/(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/.test(parsed.hostname))throw Error('官方授权链接无效。')
    this.authorizationUrl=url;const name='feishu-auth-'+Date.now()+'.png'
    await exec(settings.executable,['auth','qrcode',url,'--output',name],{cwd:this.root,windowsHide:true,timeout:10000,env})
    const file=path.join(this.root,name),qr='data:image/png;base64,'+fs.readFileSync(file).toString('base64');fs.unlinkSync(file)
    return {url,qr}
  }
  authUrl(){if(!this.authorizationUrl)throw Error('请先发起飞书授权。');return this.authorizationUrl}
  async initialize(){
    const d=await this.configure();if(d.profiles.length)return this.login(d.settings)
    if(this.init&&!this.init.done&&!this.init.failed){if(this.init.url)return this.qrcode(d.settings,this.init.url);throw Error('正在准备飞书配置，请稍后重试。')}
    const child=spawn(d.settings.executable,['config','init','--new','--name','ta-'+Date.now()],{cwd:this.root,windowsHide:true,env,stdio:['ignore','pipe','pipe']})
    const state:NonNullable<FeishuSetup['init']>={child,done:false,failed:false};this.init=state
    return new Promise<{url:string;qr:string}>((resolve,reject)=>{
      let buffer='',settled=false;const timer=setTimeout(()=>{if(!settled){settled=true;child.kill();reject(Error('准备授权超时，请检查网络后重试。'))}},30000)
      const lifetime=setTimeout(()=>child.kill(),600000)
      const output=(chunk:Buffer)=>{buffer=(buffer+chunk.toString()).slice(-32000);const url=buffer.match(/https:\/\/[^\s"<>]+/)?.[0];if(url&&!settled){settled=true;clearTimeout(timer);state.url=url;void this.qrcode(d.settings,url).then(resolve,reject)}}
      child.stdout.on('data',output);child.stderr.on('data',output)
      child.once('error',()=>{state.failed=true;clearTimeout(timer);clearTimeout(lifetime);if(!settled){settled=true;reject(Error('无法启动飞书配置。'))}})
      child.once('close',code=>{state.done=code===0;state.failed=code!==0;clearTimeout(timer);clearTimeout(lifetime);if(!settled){settled=true;reject(Error('未获得飞书配置链接，请重试。'))}})
    })
  }
  async completeInitialize(){if(this.init?.failed)throw Error('配置未完成或已过期，请重新发起。');if(!this.init?.done)throw Error('请先在飞书网页完成应用配置，再点击此按钮。');return this.configure()}
  async completeLogin(){if(!this.device)throw Error('请先发起飞书授权。');const {settings,code}=this.device;await this.run(settings,['auth','login','--device-code',code,'--json'],this.root);this.device=undefined;return this.configure()}
}
