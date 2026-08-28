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

export interface PersistedSettings extends AppSettings {
  encryptedApiKeys: Record<string, string>
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

export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SmartSelectionRect extends SelectionRect {
  id: string
  kind: 'window' | 'screen'
  label?: string
}

export interface OverlayPayload {
  captureId: number
  displayId: string
  imageDataUrl: string
  pixelsFrozen?: boolean
  initialCursor?: { x: number; y: number }
  action: CaptureAction
  scaleFactor: number
  smartSelections?: SmartSelectionRect[]
}

export interface CaptureResult {
  id: string
  imageDataUrl: string
  width: number
  height: number
  action: CaptureAction | 'edited' | 'beautified'
  createdAt: string
}

export interface OCRResult {
  text: string
  confidence: number
  language: string
}

export interface LongCaptureProgress {
  phase: 'capturing' | 'stitching' | 'complete' | 'error'
  frame: number
  maxFrames: number
  message: string
}

export const defaultSettings: AppSettings = {
  activeProviderId: 'fengsha-cpa',
  providers: [
    {
      id: 'fengsha-cpa',
      name: '风沙 CPA',
      kind: 'openai',
      baseUrl: 'https://cpa.fengsha.online/v1',
      model: 'gpt-5.5',
    },
    {
      id: 'openai',
      name: 'OpenAI',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
    },
    {
      id: 'deepseek-compatible',
      name: 'DeepSeek / 兼容服务',
      kind: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    },
    {
      id: 'anthropic',
      name: 'Anthropic Claude',
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
    },
    {
      id: 'gemini',
      name: 'Google Gemini',
      kind: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
    },
  ],
  hotkeys: {
    ocr: 'Ctrl+Shift+1',
    capture: 'Ctrl+Shift+2',
    copy: 'Ctrl+Shift+3',
    pin: 'Ctrl+Shift+4',
    long: 'Ctrl+Shift+5',
    translate: 'Ctrl+Shift+6',
  },
  sourceLanguage: 'auto',
  targetLanguage: '简体中文',
  autoLaunch: false,
  cloudUploadConfirmation: true,
  longCaptureMaxFrames: 12,
  longCaptureDelayMs: 650,
  launchMinimized: false,
  captureWindowPolicy: 'hide-ta',
  smartSelectionEnabled: true,
}
