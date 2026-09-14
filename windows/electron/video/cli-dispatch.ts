import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {CLIRequest} from './cli-engine'
export function cliJobArgument(args:string[]){const i=args.indexOf('--video-cli-job');return i>=0?args[i+1]:undefined}
export async function dispatchCLIJob(file:string,execute:(r:CLIRequest)=>Promise<unknown>) {
  const full=path.resolve(file),dir=path.dirname(full),temp=fs.realpathSync(os.tmpdir())
  if(path.basename(full)!=='request.json'||!/^ta-video-cli-[a-f0-9-]{36}$/.test(path.basename(dir))||path.dirname(fs.realpathSync(dir)).toLowerCase()!==temp.toLowerCase()||fs.lstatSync(dir).isSymbolicLink())throw Error('Invalid CLI request location')
  const response=path.join(dir,'response.json');if(fs.existsSync(response))return
  let result:unknown
  try{if(fs.statSync(full).size>2*1024*1024)throw Error('REQUEST_TOO_LARGE');const request=JSON.parse(fs.readFileSync(full,'utf8').replace(/^\uFEFF/,'')) as CLIRequest;result={ok:true,result:await execute(request)}}catch(e){result={ok:false,error:e instanceof Error?e.message:String(e)}}
  const pending=path.join(dir,'response.tmp');fs.writeFileSync(pending,JSON.stringify(result),{flag:'wx'});fs.renameSync(pending,response)
}
