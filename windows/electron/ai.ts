import { ProviderProfile } from './contracts'

const AI_TIMEOUT_MS = 90_000
const MAX_AI_RESPONSE_BYTES = 2 * 1024 * 1024

export interface AIRequest {
  profile: ProviderProfile
  apiKey: string
  imageDataUrl?: string
  imageDataUrls?: string[]
  signal?: AbortSignal
  prompt: string
}

function normalizedBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function decodeDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!match) throw new Error('截图数据格式无效。')
  return { mediaType: match[1], data: match[2] }
}

async function readError(response: Response): Promise<string> {
  const body = await readResponseText(response)
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    if (typeof parsed.error === 'string') return parsed.error
    return parsed.error?.message ?? parsed.message ?? body.slice(0, 300)
  } catch {
    return body.slice(0, 300) || `HTTP ${response.status}`
  }
}

async function readResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_AI_RESPONSE_BYTES) throw new Error('AI 服务响应过大。')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_AI_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('AI 服务响应过大。')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await readResponseText(response)
  try { return JSON.parse(text) as T } catch { throw new Error('AI 服务返回了无效 JSON。') }
}

function request(url: string, init: RequestInit) {
  return fetch(url, {
    ...init,
    redirect: 'error',
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(AI_TIMEOUT_MS)]) : AbortSignal.timeout(AI_TIMEOUT_MS),
  })
}

async function requestOpenAI({ profile, apiKey, imageDataUrl, imageDataUrls = [], signal, prompt }: AIRequest): Promise<string> {
  const base = normalizedBaseUrl(profile.baseUrl)
  const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  for (const url of [...(imageDataUrl ? [imageDataUrl] : []), ...imageDataUrls]) content.push({ type: 'image_url', image_url: { url, detail: 'high' } })
  const response = await request(endpoint, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: profile.model, messages: [{ role: 'user', content }], temperature: 0.1 }),
  })
  if (!response.ok) throw new Error(`AI 服务请求失败：${await readError(response)}`)
  const body = await readJson<{ choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> }>(response)
  const contentValue = body.choices?.[0]?.message?.content
  if (typeof contentValue === 'string') return contentValue.trim()
  if (Array.isArray(contentValue)) return contentValue.map((part) => part.text ?? '').join('\n').trim()
  throw new Error('AI 服务没有返回可读内容。')
}

async function requestAnthropic({ profile, apiKey, imageDataUrl, imageDataUrls = [], signal, prompt }: AIRequest): Promise<string> {
  const content: Array<Record<string, unknown>> = []
  for (const url of [...(imageDataUrl ? [imageDataUrl] : []), ...imageDataUrls]) {
    const image = decodeDataUrl(url)
    content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })
  }
  content.push({ type: 'text', text: prompt })
  const response = await request(`${normalizedBaseUrl(profile.baseUrl)}/v1/messages`, {
    method: 'POST',
    signal,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: profile.model, max_tokens: 4096, messages: [{ role: 'user', content }] }),
  })
  if (!response.ok) throw new Error(`Claude 请求失败：${await readError(response)}`)
  const body = await readJson<{ content?: Array<{ type?: string; text?: string }> }>(response)
  const text = body.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n').trim()
  if (!text) throw new Error('Claude 没有返回可读内容。')
  return text
}

async function requestGemini({ profile, apiKey, imageDataUrl, imageDataUrls = [], signal, prompt }: AIRequest): Promise<string> {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }]
  for (const url of [...(imageDataUrl ? [imageDataUrl] : []), ...imageDataUrls]) {
    const image = decodeDataUrl(url)
    parts.push({ inlineData: { mimeType: image.mediaType, data: image.data } })
  }
  const url = `${normalizedBaseUrl(profile.baseUrl)}/models/${encodeURIComponent(profile.model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const response = await request(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1 } }),
  })
  if (!response.ok) throw new Error(`Gemini 请求失败：${await readError(response)}`)
  const body = await readJson<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>(response)
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n').trim()
  if (!text) throw new Error('Gemini 没有返回可读内容。')
  return text
}

export function runAI(request: AIRequest): Promise<string> {
  switch (request.profile.kind) {
    case 'anthropic': return requestAnthropic(request)
    case 'gemini': return requestGemini(request)
    default: return requestOpenAI(request)
  }
}

export function visionPrompt(mode: 'vision' | 'translate', sourceLanguage: string, targetLanguage: string) {
  if (mode === 'translate') {
    return `识别截图中的所有文字并翻译为${targetLanguage}。源语言为${sourceLanguage === 'auto' ? '自动判断' : sourceLanguage}。保持原来的段落、列表、表格和代码结构；只输出译文，不要解释。`
  }
  return '请准确理解这张截图。先用一句话说明它是什么，再提取关键文字、数据和操作状态；如果是报错界面，给出最可能原因与下一步。不要编造截图中不存在的信息。'
}
