import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface Waveform {duration:number;peaks:number[]}
const cache=new Map<string,Promise<Waveform>>()
let queue=Promise.resolve()
export function audioWaveform(bin:string,file:string,duration:number):Promise<Waveform>{
  const stat=fs.statSync(file),key=file+':'+stat.size+':'+stat.mtimeMs
  const existing=cache.get(key);if(existing)return existing
  if(!Number.isFinite(duration)||duration<=0||duration>7200000)return Promise.reject(Error('音频时长无效。'))
  const result=queue.then(()=>new Promise<Waveform>((resolve,reject)=>{
    const peaks=new Array<number>(Math.min(4000,Math.max(100,Math.ceil(duration/50)))).fill(0),rate=2000,total=duration/1000*rate
    let offset=0,pending=Buffer.alloc(0),error=''
    const child=spawn(path.join(bin,'ffmpeg.exe'),['-v','error','-i',file,'-t',String(duration/1000),'-vn','-ac','1','-ar',String(rate),'-f','s16le','pipe:1'],{windowsHide:true})
    const timer=setTimeout(()=>{child.kill();reject(Error('波形生成超时。'))},120000)
    child.stdout.on('data',(chunk:Buffer)=>{const data=Buffer.concat([pending,chunk]);let i=0;for(;i+1<data.length;i+=2){const bin=Math.min(peaks.length-1,Math.floor(offset++/total*peaks.length));peaks[bin]=Math.max(peaks[bin],Math.abs(data.readInt16LE(i))/32768)}pending=data.subarray(i)})
    child.stderr.on('data',d=>{if(error.length<1000)error+=String(d)})
    child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Error('无法读取音频波形。'));else resolve({duration,peaks})})
  }))
  queue=result.then(()=>{},()=>{});cache.set(key,result);if(cache.size>12)cache.delete(cache.keys().next().value!)
  result.catch(()=>cache.delete(key));return result
}
