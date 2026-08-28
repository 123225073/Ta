import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CaptureOverlay } from './CaptureOverlay'
import { PinWindow } from './PinWindow'
import { installBrowserMock } from './mockBridge'
import './styles.css'

installBrowserMock()
const route = window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'home'
if (route === 'overlay' || route === 'pin') {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  document.getElementById('root')!.style.background = 'transparent'
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {route === 'overlay' ? <CaptureOverlay /> : route === 'pin' ? <PinWindow /> : <App initialRoute={route} />}
  </StrictMode>,
)
