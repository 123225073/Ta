import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAI, visionPrompt } from './ai'
afterEach(()=>{vi.unstubAllGlobals()})

describe('AI prompts', () => {
  it('keeps the selected translation languages in the request', () => {
    const prompt = visionPrompt('translate', 'English', '简体中文')
    expect(prompt).toContain('English')
    expect(prompt).toContain('简体中文')
    expect(prompt).toContain('只输出译文')
  })

  it('asks the vision model not to invent screen details', () => {
    expect(visionPrompt('vision', 'auto', '简体中文')).toContain('不要编造')
  })
})

describe('multimodal transport compatibility',()=>{
  for(const kind of ['openai','anthropic','gemini'] as const)it(`preserves single-image requests and adds multiple images for ${kind}`,async()=>{
    const requests:any[]=[]
    vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify(kind==='openai'?{choices:[{message:{content:'ok'}}]}:kind==='anthropic'?{content:[{type:'text',text:'ok'}]}:{candidates:[{content:{parts:[{text:'ok'}]}}]}),{status:200})}))
    const profile={id:'test',name:'test',kind,baseUrl:'http://localhost/v1',model:'test'},image='data:image/png;base64,AA=='
    expect(await runAI({profile,apiKey:'test',imageDataUrl:image,prompt:'single'})).toBe('ok')
    expect(await runAI({profile,apiKey:'test',imageDataUrls:[image,image],prompt:'multiple'})).toBe('ok')
    const count=(r:any)=>kind==='gemini'?r.contents[0].parts.filter((p:any)=>p.inlineData).length:r.messages[0].content.filter((p:any)=>p.type=== (kind==='openai'?'image_url':'image')).length
    expect(requests.map(count)).toEqual([1,2])
  })
})
