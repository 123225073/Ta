import type { OCRResult } from './types'

export type ResultTool = 'ocr' | 'ai' | 'translate'
export type ResultToolStatus = 'idle' | 'loading' | 'success' | 'error' | 'canceled'

export interface ResultToolEntry {
  status: ResultToolStatus
  text: string
  requestId: number
  ocrMeta?: OCRResult
}

export type ResultToolCache = Record<ResultTool, ResultToolEntry>

function emptyEntry(): ResultToolEntry {
  return { status: 'idle', text: '', requestId: 0 }
}

export function createResultToolCache(): ResultToolCache {
  return { ocr: emptyEntry(), ai: emptyEntry(), translate: emptyEntry() }
}

export function shouldRunTool(entry: ResultToolEntry, force = false) {
  return force || entry.status === 'idle'
}

export function beginToolRun(cache: ResultToolCache, tool: ResultTool, requestId: number): ResultToolCache {
  return {
    ...cache,
    [tool]: { status: 'loading', text: '', requestId },
  }
}

export function completeToolRun(cache: ResultToolCache, tool: ResultTool, requestId: number, text: string, ocrMeta?: OCRResult): ResultToolCache {
  if (cache[tool].requestId !== requestId) return cache
  return {
    ...cache,
    [tool]: { status: 'success', text, requestId, ocrMeta },
  }
}

function readableError(error: unknown) {
  const original = error instanceof Error ? error.message : String(error)
  return original
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function failToolRun(cache: ResultToolCache, tool: ResultTool, requestId: number, error: unknown): ResultToolCache {
  if (cache[tool].requestId !== requestId) return cache
  const message = readableError(error)
  const canceled = message.includes('已取消发送截图')
  return {
    ...cache,
    [tool]: {
      status: canceled ? 'canceled' : 'error',
      text: canceled ? '未发送截图。需要时可点击“重新识别”。' : (message || '处理失败，请稍后重新识别。'),
      requestId,
    },
  }
}
