export type CaptureAction = 'capture' | 'ocr' | 'copy' | 'pin' | 'long' | 'translate'
export type CaptureWindowPolicy = 'hide-ta' | 'keep-ta' | 'ask'
export type ProviderKind = 'openai' | 'anthropic' | 'gemini'

export interface ProviderProfile {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  model: string
  hasApiKey?: boolean
}

export interface AppSettings {
  activeProviderId: string
  providers: ProviderProfile[]
  hotkeys: Record<CaptureAction, string>
  sourceLanguage: string
  targetLanguage: string
  autoLaunch: boolean
  cloudUploadConfirmation: boolean
  longCaptureMaxFrames: number
  longCaptureDelayMs: number
  launchMinimized: boolean
  captureWindowPolicy: CaptureWindowPolicy
  smartSelectionEnabled: boolean
}

export interface HistoryItem {
  id: string
  createdAt: string
  width: number
  height: number
  action: CaptureAction | 'edited' | 'beautified'
  fileName: string
  thumbnailUrl?: string
}

export interface CaptureResult {
  id: string
  imageDataUrl: string
  width: number
  height: number
  action: CaptureAction | 'edited' | 'beautified'
  createdAt: string
}

export interface OverlayPayload {
  captureId: number
  displayId: string
  imageDataUrl: string
  pixelsFrozen?: boolean
  initialCursor?: { x: number; y: number }
  action: CaptureAction
  scaleFactor: number
  smartSelections?: Array<{
    id: string
    kind: 'window' | 'screen'
    label?: string
    x: number
    y: number
    width: number
    height: number
  }>
}

export interface OCRResult {
  text: string
  confidence: number
  language: string
}

declare global {
  interface Window {
    ta: {
      getAppInfo(): Promise<{ version: string; platform: string; packaged: boolean }>
      windowMinimize(): void
      windowToggleMaximize(): void
      windowClose(): void
      startCapture(action: CaptureAction): Promise<{ ok: boolean }>
      cancelCapture(): void
      getOverlayInit(): Promise<OverlayPayload | undefined>
      reportOverlayReady(): void
      submitSelection(rect: { x: number; y: number; width: number; height: number }): void
      getResult(): Promise<CaptureResult | undefined>
      copyImage(dataUrl?: string): Promise<{ ok: boolean }>
      copyText(value: string): Promise<{ ok: boolean }>
      saveImage(dataUrl?: string): Promise<{ canceled: boolean; filePath?: string }>
      pinImage(dataUrl?: string): Promise<number>
      commitImage(dataUrl: string, action: 'edited' | 'beautified'): Promise<CaptureResult>
      runOCR(dataUrl?: string): Promise<OCRResult>
      runAI(mode: 'vision' | 'translate' | 'custom', dataUrl?: string, prompt?: string): Promise<string>
      getSettings(): Promise<AppSettings>
      saveSettings(settings: AppSettings & { apiKeys?: Record<string, string>; clearApiKeys?: string[] }): Promise<{ settings: AppSettings; hotkeyStatus: Record<string, boolean> }>
      setHotkeyRecording(active: boolean): void
      getHistory(): Promise<HistoryItem[]>
      openHistory(id: string): Promise<CaptureResult>
      deleteHistory(id: string): Promise<boolean>
      showMain(): void
      openSettings(): void
      pinCommand(command: 'close' | 'opacity' | 'passthrough' | 'interactive' | 'move-start' | 'move' | 'move-end', value?: number | { x: number; y: number }): void
      getPinInit(): Promise<{ imageDataUrl: string } | undefined>
      onOverlayInit(listener: (payload: OverlayPayload) => void): () => void
      onPinInit(listener: (payload: { imageDataUrl: string }) => void): () => void
      onHotkeyStatus(listener: (statuses: Record<string, boolean>) => void): () => void
      onNavigate(listener: (payload: { route: 'home' | 'settings' | 'result'; result?: CaptureResult }) => void): () => void
      onHistoryChanged(listener: (history: HistoryItem[]) => void): () => void
    }
  }
}

export {}
