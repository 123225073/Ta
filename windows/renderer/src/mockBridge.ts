import { AppSettings } from './types'

const mockSettings: AppSettings = {
  theme: 'dark',
  activeProviderId: 'openai',
  providers: [
    { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', hasApiKey: false },
    { id: 'deepseek-compatible', name: 'DeepSeek / 兼容服务', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasApiKey: false },
    { id: 'anthropic', name: 'Anthropic Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5', hasApiKey: false },
    { id: 'gemini', name: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', hasApiKey: false },
  ],
  hotkeys: {
    ocr: 'Ctrl+Shift+1', capture: 'Ctrl+Shift+2', copy: 'Ctrl+Shift+3', pin: 'Ctrl+Shift+4', long: 'Ctrl+Shift+5', translate: 'Ctrl+Shift+6',
  },
  sourceLanguage: 'auto', targetLanguage: '简体中文', autoLaunch: false, cloudUploadConfirmation: true, longCaptureMaxFrames: 12, longCaptureDelayMs: 650, launchMinimized: false, captureWindowPolicy: 'hide-ta', smartSelectionEnabled: true,
  storageRoot: 'C:\\Users\\示例\\Pictures\\拓 Ta',
  externalCapture: {
    enabled: false,
    apps: {
      feishu: { enabled: false, mode: 'strict' },
      weixin: { enabled: false, mode: 'strict' },
      qq: { enabled: false, mode: 'strict' },
    },
  },
}

export function installBrowserMock() {
  if (window.ta) return
  const noOp = () => undefined
  window.ta = {
    getAppInfo: async () => ({ version: '1.4.0', platform: 'browser-preview', packaged: false }),
    windowMinimize: noOp, windowToggleMaximize: noOp, windowClose: noOp,
    startCapture: async () => ({ ok: true }), cancelCapture: noOp, getOverlayInit: async () => undefined, getLongCaptureProgress: async () => undefined, reportOverlayReady: noOp, submitSelection: noOp,
    getResult: async () => undefined,
    copyImage: async () => ({ ok: true }), copyText: async () => ({ ok: true }), saveImage: async () => ({ canceled: true }), showImageContextMenu: async () => ({ action: 'test' }), pinImage: async () => 1,
    commitImage: async () => { throw new Error('预览模式不保存图片') },
    runOCR: async () => ({ text: '浏览器预览模式', confidence: 100, language: '简体中文 + English' }),
    runAI: async () => '浏览器预览模式不发送云端请求。',
    getSettings: async () => structuredClone(mockSettings), setHotkeyRecording: noOp,
    saveSettings: async (settings) => ({ settings, hotkeyStatus: {} }),
    getHistory: async () => [], openHistory: async () => { throw new Error('没有历史记录') }, deleteHistory: async () => false,
    listAssets: async () => ({ items: [], totalCount: 0 }),
    getLibraryStats: async () => ({ count: 0, totalBytes: 0, rootDirectory: mockSettings.storageRoot, freeBytes: 0 }),
    retryLegacyMigration: async () => ({ imported: 0, skipped: 0, failed: 0, errors: [] }),
    chooseStorageRoot: async () => ({ canceled: true }), openStorageRoot: async () => undefined,
    pasteClipboardImage: async () => { throw new Error('预览模式不读取系统剪贴板') },
    importImages: async () => ({ canceled: true, imported: [], failed: [] }),
    renameAsset: async () => { throw new Error('预览模式不保存图片') },
    deleteAssets: async () => ({ deletedIds: [], missingIds: [] }),
    exportAssets: async () => ({ canceled: true, exportedCount: 0, missingIds: [] }),
    showMain: noOp, openSettings: noOp, pinCommand: noOp, getPinInit: async () => undefined,
    onOverlayInit: () => noOp, onLongCaptureProgress: () => noOp, onPinInit: () => noOp, onHotkeyStatus: () => noOp, onNavigate: () => noOp, onHistoryChanged: () => noOp, onLibraryChanged: () => noOp,
  }
}
