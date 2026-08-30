export type CaptureAction = 'capture' | 'ocr' | 'copy' | 'pin' | 'long' | 'translate'
export type CaptureWindowPolicy = 'hide-ta' | 'keep-ta' | 'ask'
export type AppTheme = 'dark' | 'light'
export type ProviderKind = 'openai' | 'anthropic' | 'gemini'
export type ExternalScreenshotApp = 'feishu' | 'weixin' | 'qq'
export type ClipboardImportMode = 'strict'
export type AssetSource = 'ta-capture' | 'external-capture' | 'paste' | 'import' | 'edited' | 'beautified'

export interface ProviderProfile {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  model: string
  hasApiKey?: boolean
}

export interface AppSettings {
  theme: AppTheme
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
  storageRoot: string
  externalCapture: {
    enabled: boolean
    apps: Record<ExternalScreenshotApp, { enabled: boolean; mode: ClipboardImportMode }>
  }
}

export interface HistoryItem {
  id: string
  createdAt: string
  dateKey: string
  width: number
  height: number
  action: CaptureAction | 'edited' | 'beautified'
  source: AssetSource
  sourceApp?: ExternalScreenshotApp
  title: string
  fileName: string
  relativePath: string
  contentHash: string
  thumbnailUrl?: string
}

export interface LibraryListQuery {
  limit?: number
  cursor?: string
  search?: string
  date?: string
  source?: AssetSource
}

export interface LibraryListResult {
  items: HistoryItem[]
  nextCursor?: string
  totalCount: number
}

export interface LibraryStats {
  count: number
  totalBytes: number
  rootDirectory: string
  freeBytes: number
  legacyMigration?: {
    imported: number
    skipped: number
    failed: number
    errors: string[]
  }
}

export interface LibraryExportResult {
  canceled: boolean
  destinationDirectory?: string
  exportedCount: number
  missingIds: string[]
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

export interface LongCaptureProgress {
  phase: 'capturing' | 'stitching' | 'complete' | 'error'
  frame: number
  maxFrames: number
  message: string
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
      getLongCaptureProgress(): Promise<LongCaptureProgress | undefined>
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
      listAssets(query?: LibraryListQuery): Promise<LibraryListResult>
      getLibraryStats(): Promise<LibraryStats>
      retryLegacyMigration(): Promise<LibraryStats['legacyMigration']>
      chooseStorageRoot(): Promise<{ canceled: boolean; rootDirectory?: string }>
      openStorageRoot(): Promise<void>
      pasteClipboardImage(): Promise<{ created: boolean; item: HistoryItem }>
      importImages(): Promise<{ canceled: boolean; imported: HistoryItem[]; failed: Array<{ filePath: string; error: string }> }>
      renameAsset(id: string, title: string): Promise<HistoryItem>
      deleteAssets(ids: string[]): Promise<{ deletedIds: string[]; missingIds: string[] }>
      exportAssets(selection: { mode: 'ids'; ids: string[] } | { mode: 'filter'; filter: { search: string; date: string }; excludedIds: string[] }): Promise<LibraryExportResult>
      openHistory(id: string): Promise<CaptureResult>
      deleteHistory(id: string): Promise<boolean>
      showMain(): void
      openSettings(): void
      pinCommand(command: 'close' | 'opacity' | 'passthrough' | 'interactive' | 'move-start' | 'move' | 'move-end', value?: number | { x: number; y: number }): void
      getPinInit(): Promise<{ imageDataUrl: string } | undefined>
      onOverlayInit(listener: (payload: OverlayPayload) => void): () => void
      onLongCaptureProgress(listener: (payload: LongCaptureProgress) => void): () => void
      onPinInit(listener: (payload: { imageDataUrl: string }) => void): () => void
      onHotkeyStatus(listener: (statuses: Record<string, boolean>) => void): () => void
      onNavigate(listener: (payload: { route: 'home' | 'library' | 'settings' | 'result'; result?: CaptureResult }) => void): () => void
      onHistoryChanged(listener: (history: HistoryItem[]) => void): () => void
      onLibraryChanged(listener: () => void): () => void
    }
  }
}

export {}
