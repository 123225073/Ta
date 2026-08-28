import { describe, expect, it } from 'vitest'
import {
  beginToolRun,
  completeToolRun,
  createResultToolCache,
  failToolRun,
  shouldRunTool,
} from './result-tool-cache'

describe('result tool cache', () => {
  it('keeps AI output when the user switches to translation and back', () => {
    let cache = createResultToolCache()
    cache = beginToolRun(cache, 'ai', 1)
    cache = completeToolRun(cache, 'ai', 1, '已经识别出的截图内容')

    expect(shouldRunTool(cache.ai)).toBe(false)
    expect(shouldRunTool(cache.translate)).toBe(true)

    cache = beginToolRun(cache, 'translate', 2)
    cache = completeToolRun(cache, 'translate', 2, 'Translated content')

    expect(cache.ai.text).toBe('已经识别出的截图内容')
    expect(cache.translate.text).toBe('Translated content')
    expect(shouldRunTool(cache.ai)).toBe(false)
  })

  it('only starts a cached tool again when rerun is explicit', () => {
    let cache = createResultToolCache()
    cache = beginToolRun(cache, 'ocr', 1)
    cache = completeToolRun(cache, 'ocr', 1, '本地文字', { text: '本地文字', language: 'chi_sim', confidence: 96 })

    expect(shouldRunTool(cache.ocr)).toBe(false)
    expect(shouldRunTool(cache.ocr, true)).toBe(true)
    expect(cache.ocr.ocrMeta?.confidence).toBe(96)
  })

  it('keeps cancellation friendly and ignores stale responses', () => {
    let cache = createResultToolCache()
    cache = beginToolRun(cache, 'ai', 1)
    cache = beginToolRun(cache, 'ai', 2)
    cache = completeToolRun(cache, 'ai', 1, '过期结果')
    expect(cache.ai.status).toBe('loading')

    cache = failToolRun(cache, 'ai', 2, new Error("Error invoking remote method 'ai:run': Error: 已取消发送截图。"))
    expect(cache.ai.status).toBe('canceled')
    expect(cache.ai.text).toBe('未发送截图。需要时可点击“重新识别”。')
    expect(shouldRunTool(cache.ai)).toBe(false)
  })
})
