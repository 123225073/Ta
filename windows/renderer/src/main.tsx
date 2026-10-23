import { lazy, Suspense, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CaptureOverlay } from './CaptureOverlay'
import { PinWindow } from './PinWindow'
import { LongCaptureHud } from './LongCaptureHud'
import { installBrowserMock } from './mockBridge'
import './styles.css'
const VideoApp=lazy(()=>import('./video/VideoApp').then(m=>({default:m.VideoApp})))
const VideoHud=lazy(()=>import('./video/VideoApp').then(m=>({default:m.VideoHud})))
const VideoInk=lazy(()=>import('./video/VideoApp').then(m=>({default:m.VideoInk})))

installBrowserMock()
const route = window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'home'
if (route === 'overlay' || route === 'pin' || route === 'long-progress' || route === 'video-ink') {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  document.getElementById('root')!.style.background = 'transparent'
}
createRoot(document.getElementById('root')!).render(
  <StrictMode><Suspense fallback={<div className="loading-page" role="status">正在打开…</div>}>
    {route === 'video' ? <VideoApp /> : route === 'video-hud' ? <VideoHud /> : route === 'video-ink' ? <VideoInk /> : route === 'overlay' ? <CaptureOverlay /> : route === 'pin' ? <PinWindow /> : route === 'long-progress' ? <LongCaptureHud /> : <App initialRoute={route} />}
  </Suspense></StrictMode>,
)
