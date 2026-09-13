import { test,expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mediaResponse } from './media-response'
test('serves full, bounded, open and suffix ranges without losing length',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ta-range-test-')),f=path.join(dir,'screen.mp4');fs.writeFileSync(f,'0123456789')
  try{for(const [range,status,body,contentRange] of [[null,200,'0123456789',null],['bytes=2-4',206,'234','bytes 2-4/10'],['bytes=7-',206,'789','bytes 7-9/10'],['bytes=-2',206,'89','bytes 8-9/10'],['bytes=4-999',206,'456789','bytes 4-9/10']] as const){const r=mediaResponse(f,new Request('https://test',{headers:range?{range}:{}}));expect(r.status).toBe(status);expect(r.headers.get('content-range')).toBe(contentRange);expect(Number(r.headers.get('content-length'))).toBe(body.length);expect(await r.text()).toBe(body)}
    for(const range of ['bytes=10-','bytes=6-2','bytes=-0','bytes=0-1,3-4','bytes=-'])expect(mediaResponse(f,new Request('https://test',{headers:{range}})).status).toBe(416)
    expect(await mediaResponse(f,new Request('https://test',{method:'HEAD'})).text()).toBe('')
  }finally{fs.unlinkSync(f);fs.rmdirSync(dir)}
})
