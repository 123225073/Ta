import { contextBridge, ipcRenderer } from 'electron'

type Listener = (...args: any[]) => void

function subscribe(channel: string, listener: Listener) {
  const wrapped = (_event: Electron.IpcRendererEvent, ...args: any[]) => listener(...args)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('ta', {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  startCapture: (action: string) => ipcRenderer.invoke('capture:start', action),
  cancelCapture: () => ipcRenderer.send('overlay:cancel'),
  getOverlayInit: () => ipcRenderer.invoke('overlay:get-init'),
  reportOverlayReady: () => ipcRenderer.send('overlay:ready'),
  submitSelection: (rect: unknown) => ipcRenderer.send('overlay:select', rect),
  getResult: () => ipcRenderer.invoke('result:get'),
  copyImage: (dataUrl?: string) => ipcRenderer.invoke('image:copy', dataUrl),
  copyText: (value: string) => ipcRenderer.invoke('text:copy', value),
  saveImage: (dataUrl?: string) => ipcRenderer.invoke('image:save', dataUrl),
  pinImage: (dataUrl?: string) => ipcRenderer.invoke('image:pin', dataUrl),
  commitImage: (dataUrl: string, action: string) => ipcRenderer.invoke('image:commit', dataUrl, action),
  runOCR: (dataUrl?: string) => ipcRenderer.invoke('ocr:run', dataUrl),
  runAI: (mode: string, dataUrl?: string, prompt?: string) => ipcRenderer.invoke('ai:run', mode, dataUrl, prompt),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:save', settings),
  setHotkeyRecording: (active: boolean) => ipcRenderer.send('hotkeys:recording', active),
  getHistory: () => ipcRenderer.invoke('history:list'),
  openHistory: (id: string) => ipcRenderer.invoke('history:open', id),
  deleteHistory: (id: string) => ipcRenderer.invoke('history:delete', id),
  showMain: () => ipcRenderer.send('navigation:home'),
  openSettings: () => ipcRenderer.send('navigation:settings'),
  pinCommand: (command: string, value?: number) => ipcRenderer.send('pin:command', command, value),
  getPinInit: () => ipcRenderer.invoke('pin:get-init'),
  onOverlayInit: (listener: Listener) => subscribe('overlay:init', listener),
  onPinInit: (listener: Listener) => subscribe('pin:init', listener),
  onHotkeyStatus: (listener: Listener) => subscribe('hotkeys:status', listener),
  onNavigate: (listener: Listener) => subscribe('navigation:route', listener),
  onHistoryChanged: (listener: Listener) => subscribe('history:changed', listener),
})
