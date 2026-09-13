import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

// Chromium needs byte ranges and a known file length to index fragmented MP4.
export function mediaResponse(file:string, request:Request):Response {
  const size=fs.statSync(file).size
  const headers:Record<string,string>={'Accept-Ranges':'bytes','Content-Type':({'.mp4':'video/mp4','.wav':'audio/wav','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif'} as Record<string,string>)[path.extname(file)]??'application/octet-stream'}
  let start=0,end=size-1,status=200
  const range=request.headers.get('range')
  if(range){
    const m=/^bytes=(\d*)-(\d*)$/.exec(range)
    if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${size}`}})
    if(m[1]){start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]))}else start=Math.max(0,size-Number(m[2]))
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${size}`}})
    status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`
  }
  headers['Content-Length']=String(Math.max(0,end-start+1))
  if(request.method==='HEAD'||size===0)return new Response(null,{status,headers})
  return new Response(Readable.toWeb(fs.createReadStream(file,{start,end})) as ReadableStream<Uint8Array>,{status,headers})
}
