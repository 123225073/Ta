import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CaptureOverlay } from './CaptureOverlay'
import { PinWindow } from './PinWindow'
import { LongCaptureHud } from './LongCaptureHud'
import { installBrowserMock } from './mockBridge'
import './styles.css'
import { VideoApp, VideoHud, VideoInk } from './video/VideoApp'

installBrowserMock()
const route = window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'home'
if (route === 'overlay' || route === 'pin' || route === 'long-progress' || route === 'video-ink') {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  document.getElementById('root')!.style.background = 'transparent'
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {route === 'video' ? <VideoApp /> : route === 'video-hud' ? <VideoHud /> : route === 'video-ink' ? <VideoInk /> : route === 'overlay' ? <CaptureOverlay /> : route === 'pin' ? <PinWindow /> : route === 'long-progress' ? <LongCaptureHud /> : <App initialRoute={route} />}
  </StrictMode>,
)
