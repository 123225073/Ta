import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LongCaptureStatus, longCapturePresentation } from './LongCaptureHud'

describe('long capture progress HUD', () => {
  it('shows visible frame progress while the page is scrolling', () => {
    const progress = { phase: 'capturing' as const, frame: 3, maxFrames: 12, message: '已识别第 3 帧，页面正在下滑' }
    const markup = renderToStaticMarkup(<LongCaptureStatus progress={progress} />)
    expect(markup).toContain('FRAME 03 / 12')
    expect(markup).toContain('页面正在自动下滑')
    expect(markup).toContain('role="status"')
    expect(longCapturePresentation(progress).percentage).toBe(23)
  })

  it('switches to content-aware stitching feedback', () => {
    const presentation = longCapturePresentation({ phase: 'stitching', frame: 8, maxFrames: 12, message: '正在分析固定栏并拼接长截图' })
    expect(presentation.eyebrow).toBe('STITCHING')
    expect(presentation.detail).toContain('消除固定栏')
  })
})
