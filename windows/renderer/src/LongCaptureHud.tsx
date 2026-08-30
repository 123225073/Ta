import { CSSProperties, useEffect, useState } from 'react'
import type { LongCaptureProgress } from './types'

const initialProgress: LongCaptureProgress = {
  phase: 'capturing',
  frame: 0,
  maxFrames: 1,
  message: '正在锁定长截图区域',
}

export function longCapturePresentation(progress: LongCaptureProgress) {
  const frame = Math.max(0, progress.frame)
  const maxFrames = Math.max(1, progress.maxFrames)
  if (progress.phase === 'stitching') return { eyebrow: 'STITCHING', detail: '正在消除固定栏并匹配页面内容', percentage: 96 }
  if (progress.phase === 'complete') return { eyebrow: 'COMPLETE', detail: '长截图已经生成', percentage: 100 }
  if (progress.phase === 'error') return { eyebrow: 'INTERRUPTED', detail: '采集已停止，请查看错误提示', percentage: 100 }
  if (frame === 0) return { eyebrow: 'PREPARING', detail: '保持目标页面在前台，拓即将自动滚动', percentage: 3 }
  return {
    eyebrow: `FRAME ${String(frame).padStart(2, '0')} / ${String(maxFrames).padStart(2, '0')}`,
    detail: progress.message.includes('下滑') ? '页面正在自动下滑，请保持当前窗口' : '正在读取选中边框内的新内容',
    percentage: Math.max(6, Math.min(92, Math.round(frame / maxFrames * 92))),
  }
}

export function LongCaptureStatus({ progress }: { progress: LongCaptureProgress }) {
  const presentation = longCapturePresentation(progress)
  const style = { '--long-progress': `${presentation.percentage}%` } as CSSProperties
  return <div className={`long-capture-hud phase-${progress.phase}`} role="status" aria-live="polite" style={style}>
    <span className="long-capture-seal" aria-hidden="true">长</span>
    <div className="long-capture-copy">
      <span className="long-capture-eyebrow"><i />{presentation.eyebrow}</span>
      <strong>{progress.message}</strong>
      <small>{presentation.detail}</small>
      <span className="long-capture-track" aria-hidden="true"><i /></span>
    </div>
    <span className="long-capture-scan" aria-hidden="true" />
  </div>
}

export function LongCaptureHud() {
  const [progress, setProgress] = useState<LongCaptureProgress>(initialProgress)
  useEffect(() => {
    void window.ta.getLongCaptureProgress().then((value) => { if (value) setProgress(value) })
    return window.ta.onLongCaptureProgress(setProgress)
  }, [])
  return <div className="long-capture-root"><LongCaptureStatus progress={progress} /></div>
}
