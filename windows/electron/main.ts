import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  desktopCapturer,
  dialog,
  Display,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  NativeImage,
  net,
  Notification,
  protocol,
  safeStorage,
  screen,
  session as electronSession,
  shell,
  Tray,
} from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { runAI, visionPrompt } from './ai'
import {
  AppSettings,
  CaptureAction,
  CaptureResult,
  LongCaptureProgress,
  OverlayPayload,
  SelectionRect,
  SmartSelectionRect,
} from './contracts'
import { OfflineOCR } from './ocr'
import { analyzeImageContent, analyzePixelContent, type ImageContentStats } from './image-content'
import { frameMeanDifference, stitchVerticalFrames } from './stitch'
import { mapWindowCandidatesToDisplay, type PhysicalWindowRect } from './smart-selection'
import { TaStore } from './store'
import {
  MAX_IMAGE_PIXELS,
  parseAiMode,
  parseCaptureAction,
  parseExternalUrl,
  parseHistoryId,
  parsePinCommand,
  parsePinPoint,
  parsePngDataUrl,
  parseResultAction,
  parseSelectionRect,
  parseSettingsUpdate,
  parseText,
} from './validation'

const execFileAsync = promisify(execFile)
const isDevelopment = Boolean(process.env.TA_DEV_SERVER_URL)

protocol.registerSchemesAsPrivileged([
  { scheme: 'ta-media', privileges: { secure: true, supportFetchAPI: true, standard: true } },
])

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let store: TaStore
let ocr: OfflineOCR
let isQuitting = false
let captureStarting = false
let captureGeneration = 0
let hotkeysSuspended = false
let lastResult: CaptureResult | undefined
let lastCaptureTiming: Record<string, number | boolean | string> | undefined
let lastCaptureHydration: Promise<void> | undefined
const e2eAiRunCounts = { vision: 0, translate: 0 }
let e2eCopiedText = ''
let e2eCopiedImageSha256 = ''
const pinWindows = new Set<BrowserWindow>()

interface OverlaySession {
  window: BrowserWindow
  display: Display
  source?: NativeImage
  action: CaptureAction
  payload: OverlayPayload
  pendingSelection?: SelectionRect
}

const overlaySessions = new Map<number, OverlaySession>()
const overlayReadyIds = new Set<number>()
const overlayShells = new Map<number, BrowserWindow>()
const overlayShellPromises = new Map<number, Promise<BrowserWindow>>()
const pinPayloads = new Map<number, string>()
const pinMoveOrigins = new Map<number, { point: { x: number; y: number }; bounds: Electron.Rectangle }>()
const windowsBuildNumber = Number(os.release().split('.')[2] ?? 0)
// Windows 10 advertises WDA_EXCLUDEFROMCAPTURE support from build 19041, but
// real drivers can intermittently render a protected full-screen window as a
// black capture. Keep the low-latency protected-overlay path on Windows 11 and
// always validate it before a captured source is allowed downstream.
const supportsProtectedEarlyOverlay = process.platform === 'win32'
  && windowsBuildNumber >= 22000
  && process.env.TA_DISABLE_PROTECTED_EARLY_OVERLAY !== '1'
let overlayWindowCreatedCount = 0
let windowsCaptureHost: ChildProcessWithoutNullStreams | undefined
let windowsCaptureHostReady = false
let windowsCaptureHostOutput = ''
let windowsCaptureTempDirectory = ''
const windowsCaptureRequests = new Map<string, {
  resolve: (value: WindowsCaptureResponse) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
  onCaptured?: (response: WindowsCaptureResponse) => void
}>()

interface WindowsCaptureScreen {
  path: string
  previewPath?: string
  primary: boolean
  deviceName: string
  x: number
  y: number
  width: number
  height: number
}

interface WindowsCaptureResponse {
  id: string
  ok: boolean
  error?: string
  milliseconds?: number
  copyMilliseconds?: number
  screens?: WindowsCaptureScreen[]
  windows?: PhysicalWindowRect[]
}

interface WindowsCaptureBundle {
  sources: Map<number, NativeImage>
  previewDataUrls: Map<number, string>
  sourceStats: ImageContentStats[]
  smartSelections: Map<number, SmartSelectionRect[]>
}

if (process.env.TA_E2E_USER_DATA_DIR) app.setPath('userData', process.env.TA_E2E_USER_DATA_DIR)

function iconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'dist', 'icon.png')
    : path.resolve(__dirname, '..', 'build', 'icon.png')
}

function createWindowOptions(extra: Electron.BrowserWindowConstructorOptions = {}): Electron.BrowserWindowConstructorOptions {
  return {
    icon: iconPath(),
    backgroundColor: '#171512',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...extra,
  }
}

function createTaWindow(extra: Electron.BrowserWindowConstructorOptions = {}) {
  const window = new BrowserWindow(createWindowOptions(extra))
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(parseExternalUrl(url)).catch(() => undefined)
    } catch {
      // Renderer-supplied non-web schemes are intentionally blocked.
    }
    return { action: 'deny' }
  })
  return window
}

function captureHostScriptPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'capture', 'ta-capture-host.ps1')
    : path.resolve(__dirname, '..', 'resources', 'capture', 'ta-capture-host.ps1')
}

function handleWindowsCaptureHostLine(line: string) {
  let message: WindowsCaptureResponse & { type?: string }
  try { message = JSON.parse(line) as WindowsCaptureResponse & { type?: string } } catch { return }
  if (message.type === 'ready') {
    windowsCaptureHostReady = true
    return
  }
  const pending = windowsCaptureRequests.get(String(message.id ?? ''))
  if (!pending) return
  if (message.type === 'captured') {
    try { pending.onCaptured?.(message) } catch (error) { console.warn('[windows-capture-preview]', error) }
    return
  }
  windowsCaptureRequests.delete(message.id)
  clearTimeout(pending.timeout)
  if (message.ok) pending.resolve(message)
  else pending.reject(new Error(message.error || 'Windows 截图辅助进程返回失败。'))
}

function startWindowsCaptureHost() {
  if (process.platform !== 'win32' || process.env.TA_DISABLE_WINDOWS_CAPTURE_HOST === '1' || windowsCaptureHost) return
  const scriptPath = captureHostScriptPath()
  if (!fs.existsSync(scriptPath)) return
  const systemPowerShell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const powerShellExecutable = fs.existsSync(systemPowerShell) ? systemPowerShell : 'powershell.exe'
  windowsCaptureTempDirectory = path.join(app.getPath('temp'), `ta-windows-capture-${process.pid}`)
  fs.mkdirSync(windowsCaptureTempDirectory, { recursive: true })
  const child = spawn(powerShellExecutable, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  windowsCaptureHost = child
  child.stdout.on('data', (chunk: Buffer) => {
    windowsCaptureHostOutput += chunk.toString('utf8')
    let newline = windowsCaptureHostOutput.indexOf('\n')
    while (newline >= 0) {
      const line = windowsCaptureHostOutput.slice(0, newline).trim()
      windowsCaptureHostOutput = windowsCaptureHostOutput.slice(newline + 1)
      if (line) handleWindowsCaptureHostLine(line)
      newline = windowsCaptureHostOutput.indexOf('\n')
    }
  })
  child.stderr.resume()
  child.on('error', (error) => console.warn('[windows-capture-host]', error.message))
  child.on('exit', () => {
    windowsCaptureHost = undefined
    windowsCaptureHostReady = false
    for (const [id, pending] of windowsCaptureRequests) {
      windowsCaptureRequests.delete(id)
      clearTimeout(pending.timeout)
      pending.reject(new Error('Windows 截图辅助进程已退出。'))
    }
  })
}

function stopWindowsCaptureHost() {
  const child = windowsCaptureHost
  windowsCaptureHost = undefined
  windowsCaptureHostReady = false
  if (child && !child.killed) {
    try { child.stdin.end(`${JSON.stringify({ command: 'exit' })}\n`) } catch { child.kill() }
    setTimeout(() => { if (!child.killed) child.kill() }, 500).unref()
  }
  if (!windowsCaptureTempDirectory) return
  const tempRoot = path.resolve(app.getPath('temp'))
  const target = path.resolve(windowsCaptureTempDirectory)
  if (path.dirname(target) === tempRoot && path.basename(target).startsWith('ta-windows-capture-')) {
    try { fs.rmSync(target, { recursive: true, force: true }) } catch { /* helper may still be releasing a PNG */ }
  }
}

function requestWindowsCapture(excludedWindowHandles: string[] = [], onCaptured?: (response: WindowsCaptureResponse) => void): Promise<WindowsCaptureResponse> {
  const child = windowsCaptureHost
  if (!child || !windowsCaptureHostReady || !windowsCaptureTempDirectory) {
    return Promise.reject(new Error('Windows 截图辅助进程尚未就绪。'))
  }
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      windowsCaptureRequests.delete(id)
      reject(new Error('Windows 截图辅助进程响应超时。'))
    }, 3_000)
    windowsCaptureRequests.set(id, { resolve, reject, timeout, onCaptured })
    child.stdin.write(`${JSON.stringify({ id, command: 'capture', outputDirectory: windowsCaptureTempDirectory, excludedWindowHandles })}\n`, (error) => {
      if (!error) return
      const pending = windowsCaptureRequests.get(id)
      if (!pending) return
      windowsCaptureRequests.delete(id)
      clearTimeout(pending.timeout)
      pending.reject(error)
    })
  })
}

function nativeWindowHandleId(window: BrowserWindow) {
  if (process.platform !== 'win32' || window.isDestroyed()) return undefined
  try {
    const handle = window.getNativeWindowHandle()
    if (handle.length >= 8) return handle.readBigUInt64LE(0).toString()
    if (handle.length >= 4) return String(handle.readUInt32LE(0))
  } catch { /* window was destroyed between enumeration and handle lookup */ }
  return undefined
}

function matchWindowsCaptureScreens(displays: Display[], capturedScreens: WindowsCaptureScreen[]) {
  if (capturedScreens.length < displays.length) throw new Error('Windows 截图辅助进程返回的显示器数量不足。')
  const primaryDisplayId = screen.getPrimaryDisplay().id
  const unmatched = [...capturedScreens]
  const matches = new Map<number, WindowsCaptureScreen>()
  const orderedDisplays = [...displays].sort((left, right) => Number(right.id === primaryDisplayId) - Number(left.id === primaryDisplayId))
  for (const display of orderedDisplays) {
    const expectedWidth = Math.round(display.bounds.width * display.scaleFactor)
    const expectedHeight = Math.round(display.bounds.height * display.scaleFactor)
    const expectsPrimary = display.id === primaryDisplayId
    const captured = unmatched.reduce((best, candidate) => {
      const candidateScore = Math.abs(candidate.width - expectedWidth)
        + Math.abs(candidate.height - expectedHeight)
        + (candidate.primary === expectsPrimary ? 0 : 1_000_000)
      if (!best || candidateScore < best.score) return { screen: candidate, score: candidateScore }
      return best
    }, undefined as { screen: WindowsCaptureScreen; score: number } | undefined)?.screen
    if (!captured) throw new Error(`Windows 截图辅助进程无法映射显示器 ${display.id}。`)
    unmatched.splice(unmatched.indexOf(captured), 1)
    matches.set(display.id, captured)
  }
  return matches
}

function previewDataUrlsFromWindowsCapture(displays: Display[], response: WindowsCaptureResponse) {
  const expectedRoot = path.resolve(windowsCaptureTempDirectory)
  const matches = matchWindowsCaptureScreens(displays, response.screens ?? [])
  const previews = new Map<number, string>()
  for (const display of displays) {
    const captured = matches.get(display.id)
    const previewPath = captured?.previewPath ? path.resolve(captured.previewPath) : undefined
    if (!previewPath || path.dirname(previewPath) !== expectedRoot) throw new Error('Windows 截图辅助进程返回了无效预览路径。')
    const preview = fs.readFileSync(previewPath)
    if (!preview.length) throw new Error(`Windows 截图辅助进程返回了空预览：${captured?.deviceName ?? display.id}。`)
    previews.set(display.id, `data:image/png;base64,${preview.toString('base64')}`)
  }
  return previews
}

function smartSelectionsFromWindowsCapture(displays: Display[], response: WindowsCaptureResponse) {
  const matches = matchWindowsCaptureScreens(displays, response.screens ?? [])
  const windows = response.windows ?? []
  const selections = new Map<number, SmartSelectionRect[]>()
  for (const display of displays) {
    const captured = matches.get(display.id)
    if (!captured) continue
    selections.set(display.id, mapWindowCandidatesToDisplay(display, captured, windows))
  }
  return selections
}

async function screenSourcesFromWindowsHost(
  displays: Display[],
  onCaptured?: (stage: { copyMilliseconds: number; previewMilliseconds: number; previewDataUrls: Map<number, string>; smartSelections: Map<number, SmartSelectionRect[]> }) => void,
  excludedWindowHandles: string[] = [],
): Promise<WindowsCaptureBundle> {
  let frozenPreviewDataUrls = new Map<number, string>()
  let frozenSmartSelections = new Map<number, SmartSelectionRect[]>()
  const response = await requestWindowsCapture(excludedWindowHandles, (capturedResponse) => {
    frozenPreviewDataUrls = previewDataUrlsFromWindowsCapture(displays, capturedResponse)
    frozenSmartSelections = smartSelectionsFromWindowsCapture(displays, capturedResponse)
    onCaptured?.({
      copyMilliseconds: Number(capturedResponse.copyMilliseconds ?? 0),
      previewMilliseconds: Number(capturedResponse.milliseconds ?? 0),
      previewDataUrls: frozenPreviewDataUrls,
      smartSelections: frozenSmartSelections,
    })
  })
  const capturedScreens = response.screens ?? []
  const expectedRoot = path.resolve(windowsCaptureTempDirectory)
  const matches = matchWindowsCaptureScreens(displays, capturedScreens)
  const sources = new Map<number, NativeImage>()
  const previewDataUrls = frozenPreviewDataUrls.size === displays.length
    ? frozenPreviewDataUrls
    : previewDataUrlsFromWindowsCapture(displays, response)
  const sourceStats: ImageContentStats[] = []
  const smartSelections = frozenSmartSelections.size === displays.length
    ? frozenSmartSelections
    : smartSelectionsFromWindowsCapture(displays, response)
  try {
    for (const display of displays) {
      const captured = matches.get(display.id)
      if (!captured) throw new Error(`Windows 截图辅助进程无法映射显示器 ${display.id}。`)
      const imagePath = path.resolve(captured.path)
      if (path.dirname(imagePath) !== expectedRoot) throw new Error('Windows 截图辅助进程返回了无效路径。')
      const rawPixels = fs.readFileSync(imagePath)
      const expectedBytes = captured.width * captured.height * 4
      if (rawPixels.length !== expectedBytes) throw new Error(`Windows 截图辅助进程返回了无效像素长度：${captured.deviceName}。`)
      const image = nativeImage.createFromBitmap(rawPixels, { width: captured.width, height: captured.height, scaleFactor: 1 })
      if (image.isEmpty()) throw new Error(`Windows 截图辅助进程返回了空图片：${captured.deviceName}。`)
      sources.set(display.id, image)
      sourceStats.push(analyzeNativeImageContent(image))
    }
    return { sources, previewDataUrls, sourceStats, smartSelections }
  } finally {
    for (const screen of response.screens ?? []) {
      for (const candidate of [screen.path, screen.previewPath]) {
        if (!candidate) continue
        const temporaryPath = path.resolve(candidate)
        if (path.dirname(temporaryPath) !== expectedRoot) continue
        try { fs.unlinkSync(temporaryPath) } catch { /* temporary capture is best-effort cleanup */ }
      }
    }
  }
}

function analyzeNativeImageContent(image: NativeImage) {
  const size = image.getSize()
  const sampleWidth = Math.min(320, size.width)
  const sampleHeight = Math.max(1, Math.min(180, Math.round(size.height * sampleWidth / Math.max(1, size.width))))
  const sample = image.resize({ width: sampleWidth, height: sampleHeight, quality: 'good' })
  const sampleSize = sample.getSize()
  return analyzePixelContent(sample.toBitmap(), sampleSize.width, sampleSize.height, 4, { red: 2, green: 1, blue: 0, alpha: 3 })
}

async function loadRoute(window: BrowserWindow, route: string) {
  if (isDevelopment) {
    await window.loadURL(`${process.env.TA_DEV_SERVER_URL}/#/${route}`)
  } else {
    await window.loadFile(path.resolve(__dirname, '..', 'dist', 'index.html'), { hash: `/${route}` })
  }
}

function sendWhenReady(window: BrowserWindow, channel: string, payload: unknown) {
  const send = () => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
  else send()
}

async function createMainWindow(route = 'home') {
  let created = false
  if (!mainWindow || mainWindow.isDestroyed()) {
    created = true
    mainWindow = createTaWindow({
      width: 1180,
      height: 760,
      minWidth: 900,
      minHeight: 620,
      frame: false,
      title: '拓 Ta',
    })
    mainWindow.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault()
        mainWindow?.hide()
      }
    })
  }
  if (created) await loadRoute(mainWindow, route)
  if (process.platform === 'win32') mainWindow.setOpacity(1)
  mainWindow.show()
  mainWindow.focus()
  return mainWindow
}

async function showRoute(route: string) {
  const window = await createMainWindow(route)
  sendWhenReady(window, 'navigation:route', { route, result: route === 'result' ? lastResult : undefined })
  if (route === 'result' && lastResult) sendWhenReady(window, 'result:init', lastResult)
}

function closeOverlays() {
  captureGeneration += 1
  captureStarting = false
  const activeSessions = [...overlaySessions.values()]
  overlaySessions.clear()
  overlayReadyIds.clear()
  for (const session of activeSessions) {
    const overlay = session.window
    if (overlay.isDestroyed()) continue
    if (process.platform === 'win32') overlay.setOpacity(0)
    overlay.hide()
    overlay.setIgnoreMouseEvents(false)
    overlay.setSkipTaskbar(true)
    const existing = overlayShells.get(session.display.id)
    if (existing && existing !== overlay && !existing.isDestroyed()) overlay.destroy()
    else overlayShells.set(session.display.id, overlay)
  }
  if (!isQuitting && app.isReady()) void prewarmOverlayShells().catch(() => undefined)
}

async function createOverlayShell(display: Display) {
  overlayWindowCreatedCount += 1
  const overlay = createTaWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    hasShadow: false,
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setContentProtection(false)
  const webContentsId = overlay.webContents.id
  overlay.on('closed', () => {
    overlaySessions.delete(webContentsId)
    overlayReadyIds.delete(webContentsId)
    if (overlayShells.get(display.id) === overlay) overlayShells.delete(display.id)
  })
  await loadRoute(overlay, 'overlay')
  await overlay.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
  return overlay
}

async function prepareOverlayShell(display: Display) {
  const existing = overlayShells.get(display.id)
  if (existing && !existing.isDestroyed()) return existing
  const pending = overlayShellPromises.get(display.id)
  if (pending) return pending
  const promise = createOverlayShell(display).then((overlay) => {
    if (isQuitting) overlay.destroy()
    else overlayShells.set(display.id, overlay)
    return overlay
  }).finally(() => overlayShellPromises.delete(display.id))
  overlayShellPromises.set(display.id, promise)
  return promise
}

async function prewarmOverlayShells() {
  const displays = screen.getAllDisplays()
  const activeDisplayIds = new Set(displays.map((display) => display.id))
  for (const [displayId, overlay] of overlayShells) {
    if (!activeDisplayIds.has(displayId)) {
      overlayShells.delete(displayId)
      if (!overlay.isDestroyed()) overlay.destroy()
    }
  }
  await Promise.all(displays.map((display) => prepareOverlayShell(display)))
}

async function takeOverlayShell(display: Display) {
  const overlay = await prepareOverlayShell(display)
  overlayShells.delete(display.id)
  overlay.setBounds(display.bounds)
  return overlay
}

async function screenSourcesForDisplays(displays: Display[]): Promise<Map<number, NativeImage>> {
  const thumbnailSize = {
    width: Math.max(...displays.map((display) => Math.max(1, Math.round(display.bounds.width * display.scaleFactor)))),
    height: Math.max(...displays.map((display) => Math.max(1, Math.round(display.bounds.height * display.scaleFactor)))),
  }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize, fetchWindowIcons: false })
  const result = new Map<number, NativeImage>()
  displays.forEach((display, index) => {
    const exact = sources.find((source) => source.display_id === String(display.id))
    const fallback = sources.length === 1 ? sources[0] : sources[index]
    const source = exact ?? fallback
    if (!source) throw new Error(`未找到显示器 ${display.id} 的截图源。`)
    result.set(display.id, source.thumbnail)
  })
  return result
}

async function screenSourceForDisplay(display: Display): Promise<NativeImage> {
  const source = (await screenSourcesForDisplays([display])).get(display.id)
  if (!source) throw new Error(`未找到显示器 ${display.id} 的截图源。`)
  return source
}

async function resolveCaptureWindowPolicy(): Promise<'hide-ta' | 'keep-ta' | undefined> {
  const policy = store.getSettings().captureWindowPolicy
  if (policy !== 'ask') return policy
  const options = {
    type: 'question' as const,
    title: '开始截图',
    message: '这次截图是否隐藏拓 Ta？',
    detail: '此选择只影响拓 Ta，其他软件不会被最小化或隐藏。',
    buttons: ['隐藏 Ta 后截图', '保留 Ta 窗口', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }
  const response = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  if (response.response === 2) return undefined
  return response.response === 0 ? 'hide-ta' : 'keep-ta'
}

async function startCapture(actionValue: unknown) {
  const captureStartedAt = performance.now()
  const action = parseCaptureAction(actionValue)
  if (captureStarting) return { ok: false, busy: true }
  captureStarting = true
  let captureWindowPolicy: 'hide-ta' | 'keep-ta' | undefined
  try {
    captureWindowPolicy = await resolveCaptureWindowPolicy()
  } catch (error) {
    captureStarting = false
    throw error
  }
  if (!captureWindowPolicy) {
    captureStarting = false
    return { ok: false, busy: false, canceled: true }
  }
  closeOverlays()
  captureStarting = true
  const generation = captureGeneration
  try {
    const smartSelectionEnabled = store.getSettings().smartSelectionEnabled
    const displays = screen.getAllDisplays()
    const shellStartedAt = performance.now()
    const overlays = await Promise.all(displays.map((display) => takeOverlayShell(display)))
    const shellMs = performance.now() - shellStartedAt
    const useWindowsCaptureHost = process.platform === 'win32' && windowsCaptureHostReady
    const useProtectedEarlyOverlay = supportsProtectedEarlyOverlay && !useWindowsCaptureHost
    const useImmediateInputShield = useWindowsCaptureHost
    const excludedWindowHandles = useWindowsCaptureHost
      ? overlays.map(nativeWindowHandleId).filter((value): value is string => Boolean(value))
      : []
    const mainWasVisible = Boolean(mainWindow?.isVisible())
    const mainHiddenForCapture = captureWindowPolicy === 'hide-ta' && mainWasVisible
    if (mainHiddenForCapture && mainWindow) {
      // Windows can keep the last composed frame briefly after BrowserWindow.hide().
      // Remove Ta from the compositor first; the native capture host performs a
      // DwmFlush before CopyFromScreen so no fading/ghost frame reaches the PNG.
      if (process.platform === 'win32') mainWindow.setOpacity(0)
      mainWindow.hide()
    }
    const mainHiddenAt = performance.now()
    const cursorPoint = screen.getCursorScreenPoint()
    displays.forEach((display, index) => {
      const overlay = overlays[index]
      const payload: OverlayPayload = {
        captureId: generation,
        displayId: String(display.id),
        imageDataUrl: '',
        initialCursor: {
          x: Math.max(0, Math.min(display.bounds.width - 1, cursorPoint.x - display.bounds.x)),
          y: Math.max(0, Math.min(display.bounds.height - 1, cursorPoint.y - display.bounds.y)),
        },
        action,
        scaleFactor: display.scaleFactor,
      }
      overlay.setContentProtection(useProtectedEarlyOverlay)
      // A native opacity of exactly zero lets Windows/Chromium treat the
      // overlay as occluded and pause requestAnimationFrame. Keep the native
      // surface alive at 1%; the preparing document itself is fully
      // transparent, so desktop pixels remain visually unchanged.
      if (useImmediateInputShield) overlay.setOpacity(0.01)
      else if (process.platform === 'win32') overlay.setOpacity(1)
      overlaySessions.set(overlay.webContents.id, { window: overlay, display, action, payload })
      if (useProtectedEarlyOverlay || useImmediateInputShield) {
        sendWhenReady(overlay, 'overlay:init', payload)
      }
    })
    if (useProtectedEarlyOverlay || useImmediateInputShield) {
      const resetDeadline = performance.now() + 80
      while (overlays.some((overlay) => !overlayReadyIds.has(overlay.webContents.id)) && performance.now() < resetDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 4))
      }
      for (const overlay of overlays) overlay.showInactive()
    }
    const cursorDisplay = screen.getDisplayNearestPoint(cursorPoint)
    const active = [...overlaySessions.values()].find((session) => session.display.id === cursorDisplay.id)
    if (useProtectedEarlyOverlay || useImmediateInputShield) active?.window.focus()
    lastCaptureTiming = {
      mainWasVisible,
      mainHiddenForCapture,
      captureWindowPolicy,
      shellMs: Math.round(shellMs),
      earlyOverlay: useProtectedEarlyOverlay,
      inputShield: useImmediateInputShield,
      captureBackend: useWindowsCaptureHost ? 'windows-gdi' : 'electron',
      showReturnMs: Math.round(performance.now() - captureStartedAt),
    }
    lastCaptureHydration = (async () => {
      const hideWaitStartedAt = performance.now()
      const hideSettleTargetMs = mainHiddenForCapture ? (useProtectedEarlyOverlay ? 120 : 32) : 0
      const hideSettleRemainingMs = Math.max(0, hideSettleTargetMs - (performance.now() - mainHiddenAt))
      if (hideSettleRemainingMs > 0) await new Promise((resolve) => setTimeout(resolve, hideSettleRemainingMs))
      const hideWaitMs = performance.now() - hideWaitStartedAt
      const sourceStartedAt = performance.now()
      let sources: Map<number, NativeImage>
      let previewDataUrls: Map<number, string> | undefined
      let sourceStats: ImageContentStats[]
      let smartSelections = new Map<number, SmartSelectionRect[]>()
      let captureBackendFallback = false
      if (useWindowsCaptureHost) {
        try {
          const captured = await screenSourcesFromWindowsHost(displays, (stage) => {
            if (generation !== captureGeneration) return
            for (const session of overlaySessions.values()) {
              if (session.window.isDestroyed()) continue
              const imageDataUrl = stage.previewDataUrls.get(session.display.id)
              if (!imageDataUrl) continue
              session.payload = {
                ...session.payload,
                imageDataUrl,
                pixelsFrozen: true,
                smartSelections: smartSelectionEnabled ? stage.smartSelections.get(session.display.id) : undefined,
              }
              session.window.webContents.send('overlay:init', session.payload)
            }
            Object.assign(lastCaptureTiming ?? {}, {
              gdiCopyMs: Math.round(stage.copyMilliseconds),
              gdiPreviewMs: Math.round(stage.previewMilliseconds),
              frozenPreviewShown: stage.previewDataUrls.size === displays.length,
              pixelsFrozenMs: Math.round(performance.now() - captureStartedAt),
            })
          }, excludedWindowHandles)
          sources = captured.sources
          previewDataUrls = captured.previewDataUrls
          sourceStats = captured.sourceStats
          smartSelections = captured.smartSelections
        }
        catch (error) {
          // A dark or powered-off secondary monitor is still a valid capture.
          // Do not replace a Windows GDI capture with Electron's DXGI backend:
          // on affected GPU/remote-desktop sessions DXGI can stall indefinitely
          // or return black frames. Surface the helper failure so the overlay is
          // closed cleanly and the next invocation can retry the native host.
          throw new Error(`Windows 原生截图失败：${error instanceof Error ? error.message : String(error)}`)
        }
      } else {
        sources = await screenSourcesForDisplays(displays)
        sourceStats = await Promise.all([...sources.values()].map(analyzeNativeImageContent))
      }
      let blackCaptureRecovered = false
      if (useProtectedEarlyOverlay && sourceStats.some((stats) => stats.probablyBlack || stats.probablyTransparent)) {
        for (const session of overlaySessions.values()) {
          if (session.window.isDestroyed()) continue
          session.window.hide()
          session.window.setContentProtection(false)
        }
        await new Promise((resolve) => setTimeout(resolve, 60))
        if (sourceStats.some((stats) => stats.probablyBlack || stats.probablyTransparent)) {
          sources = await screenSourcesForDisplays(displays)
          previewDataUrls = undefined
          sourceStats = await Promise.all([...sources.values()].map(analyzeNativeImageContent))
        }
        blackCaptureRecovered = true
        captureBackendFallback = true
      }
      const sourceMs = performance.now() - sourceStartedAt
      if (generation !== captureGeneration) return
      for (const session of overlaySessions.values()) session.source = sources.get(session.display.id)

      const pending = [...overlaySessions.values()].find((session) => session.pendingSelection && session.source)
      if (pending?.pendingSelection) {
        completeOverlaySelection(pending, pending.pendingSelection)
        return
      }

      const encodeStartedAt = performance.now()
      const revealPromises: Promise<unknown>[] = []
      for (const session of overlaySessions.values()) {
        if (!session.source || session.window.isDestroyed()) continue
        session.window.setContentProtection(useProtectedEarlyOverlay)
        const cachedPreview = previewDataUrls?.get(session.display.id)
        const imageDataUrl = cachedPreview ?? `data:image/png;base64,${session.source.resize({
          width: session.display.bounds.width,
          height: session.display.bounds.height,
          quality: 'good',
        }).toPNG().toString('base64')}`
        session.payload = {
          captureId: session.payload.captureId,
          displayId: String(session.display.id),
          imageDataUrl,
          initialCursor: session.payload.initialCursor,
          action: session.action,
          scaleFactor: session.source.getSize().width / session.display.bounds.width,
          pixelsFrozen: true,
          smartSelections: smartSelectionEnabled ? smartSelections.get(session.display.id) : undefined,
        }
        session.window.webContents.send('overlay:init', session.payload)
        if (useImmediateInputShield) {
          revealPromises.push(session.window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))').then(() => {
            if (generation === captureGeneration && !session.window.isDestroyed()) session.window.setOpacity(1)
          }))
        } else if (!useProtectedEarlyOverlay || blackCaptureRecovered) {
          session.window.showInactive()
        }
      }
      await Promise.all(revealPromises)
      if (!useProtectedEarlyOverlay || blackCaptureRecovered) active?.window.focus()
      Object.assign(lastCaptureTiming ?? {}, {
        hideWaitMs: Math.round(hideWaitMs),
        sourceMs: Math.round(sourceMs),
        blackCaptureRecovered,
        captureBackendFallback,
        sourceProbablyBlack: sourceStats.some((stats) => stats.probablyBlack),
        sourceProbablyTransparent: sourceStats.some((stats) => stats.probablyTransparent),
        encodeMs: Math.round(performance.now() - encodeStartedAt),
        hydratedMs: Math.round(performance.now() - captureStartedAt),
      })
    })().catch(async (error) => {
      if (generation !== captureGeneration) return
      closeOverlays()
      if (!isQuitting) await showRoute('home')
      reportOperationError('截图准备失败', error)
    }).finally(() => {
      if (generation === captureGeneration) captureStarting = false
    })
    return { ok: true, busy: false }
  } catch (error) {
    captureStarting = false
    closeOverlays()
    if (!isQuitting) await showRoute('home')
    throw error
  }
}

function cropSelection(session: Pick<OverlaySession, 'source' | 'display'>, rect: SelectionRect): NativeImage {
  if (!session.source) throw new Error('截图画面仍在准备中。')
  const sourceSize = session.source.getSize()
  const scaleX = sourceSize.width / session.display.bounds.width
  const scaleY = sourceSize.height / session.display.bounds.height
  const crop = {
    x: Math.max(0, Math.min(sourceSize.width - 1, Math.round(rect.x * scaleX))),
    y: Math.max(0, Math.min(sourceSize.height - 1, Math.round(rect.y * scaleY))),
    width: Math.max(1, Math.min(sourceSize.width, Math.round(rect.width * scaleX))),
    height: Math.max(1, Math.min(sourceSize.height, Math.round(rect.height * scaleY))),
  }
  crop.width = Math.min(crop.width, sourceSize.width - crop.x)
  crop.height = Math.min(crop.height, sourceSize.height - crop.y)
  return session.source.crop(crop)
}

function completeOverlaySelection(session: OverlaySession, rect: SelectionRect) {
  if (!session.source) {
    session.pendingSelection = rect
    return
  }
  const image = cropSelection(session, rect)
  const { action, display } = session
  closeOverlays()
  if (action === 'long') void runLongCapture(display, rect)
  else void handleCapturedImage(image, action).catch((error) => reportOperationError('处理截图失败', error))
}

function checkedImage(buffer: Buffer): NativeImage {
  const image = nativeImage.createFromBuffer(buffer)
  const { width, height } = image.getSize()
  if (image.isEmpty() || width < 1 || height < 1 || width * height > MAX_IMAGE_PIXELS) throw new Error('图片尺寸无效或过大。')
  return image
}

function imageFromOptionalDataUrl(dataUrl?: unknown): NativeImage {
  if (dataUrl !== undefined) return checkedImage(parsePngDataUrl(dataUrl))
  if (!lastResult) throw new Error('当前没有可处理的截图。')
  return checkedImage(parsePngDataUrl(lastResult.imageDataUrl))
}

async function writeImageToClipboard(image: NativeImage) {
  if (process.env.TA_E2E_SMOKE_FILE) {
    e2eCopiedImageSha256 = crypto.createHash('sha256').update(image.toPNG()).digest('hex')
    return
  }
  const png = new Uint8Array(image.toPNG())
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
}

async function commitResult(image: NativeImage, action: CaptureResult['action'], show = true) {
  const size = image.getSize()
  const item = store.addHistory(image.toPNG(), size.width, size.height, action)
  lastResult = {
    id: item.id,
    imageDataUrl: image.toDataURL(),
    width: size.width,
    height: size.height,
    action,
    createdAt: item.createdAt,
  }
  if (mainWindow && !mainWindow.isDestroyed()) sendWhenReady(mainWindow, 'history:changed', store.listHistory())
  if (show) await showRoute('result')
  return lastResult
}

async function handleCapturedImage(image: NativeImage, action: CaptureAction) {
  let clipboardError: unknown
  try { await writeImageToClipboard(image) } catch (error) { clipboardError = error }
  if (action === 'copy') {
    await commitResult(image, action, false)
    if (clipboardError) void reportOperationError('自动复制失败', clipboardError)
    else new Notification({ title: '拓 Ta', body: '截图已复制并保存，可直接粘贴' }).show()
    return
  }
  if (action === 'pin') {
    await commitResult(image, action, false)
    await createPinWindow(image.toDataURL())
    if (clipboardError) void reportOperationError('自动复制失败', clipboardError)
    return
  }
  await commitResult(image, action)
  if (clipboardError) void reportOperationError('自动复制失败', clipboardError)
}

async function captureRegion(display: Display, rect: SelectionRect): Promise<NativeImage> {
  const source = await screenSourceForDisplay(display)
  return cropSelection({ display, source }, rect)
}

async function sendMouseWheel(x: number, y: number, amount = -720) {
  const script = [
    'Add-Type -TypeDefinition @\"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class TaMouse {',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);',
    '}',
    '\"@',
    `[TaMouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null`,
    `[TaMouse]::mouse_event(0x0800, 0, 0, ${amount}, [UIntPtr]::Zero)`,
  ].join('\n')
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true })
}

async function inspectNativeWindow(window: BrowserWindow) {
  if (process.platform !== 'win32') return { exStyle: 0, owner: 0, left: 0, top: 0, right: 0, bottom: 0 }
  const buffer = window.getNativeWindowHandle()
  const handle = buffer.length >= 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE())
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class TaWindowStyle {',
    '  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }',
    '  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);',
    '  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);',
    '}',
    '"@',
    `$handle = [IntPtr]::new([Int64]${handle.toString()})`,
    '$style = [TaWindowStyle]::GetWindowLongPtr($handle, -20).ToInt64()',
    '$owner = [TaWindowStyle]::GetWindow($handle, 4).ToInt64()',
    '$rect = [TaWindowStyle+Rect]::new()',
    '[void][TaWindowStyle]::GetWindowRect($handle, [ref]$rect)',
    '[pscustomobject]@{ exStyle = $style; owner = $owner; left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom } | ConvertTo-Json -Compress',
  ].join('\n')
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true })
  return JSON.parse(stdout.trim()) as { exStyle: number; owner: number; left: number; top: number; right: number; bottom: number }
}

function publishLongProgress(progress: LongCaptureProgress) {
  tray?.setToolTip(`拓 Ta · ${progress.message}`)
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('long-capture:progress', progress)
}

async function runLongCapture(display: Display, rect: SelectionRect) {
  const settings = store.getSettings()
  const frames: Buffer[] = []
  const centerX = display.bounds.x + rect.x + rect.width / 2
  const centerY = display.bounds.y + rect.y + rect.height / 2
  try {
    for (let frame = 0; frame < settings.longCaptureMaxFrames; frame += 1) {
      publishLongProgress({ phase: 'capturing', frame: frame + 1, maxFrames: settings.longCaptureMaxFrames, message: `长截图采集中 ${frame + 1}/${settings.longCaptureMaxFrames}` })
      const image = await captureRegion(display, rect)
      const png = image.toPNG()
      if (frames.length && await frameMeanDifference(frames.at(-1)!, png) < 1.1) break
      frames.push(png)
      if (frame < settings.longCaptureMaxFrames - 1) {
        await sendMouseWheel(centerX, centerY)
        await new Promise((resolve) => setTimeout(resolve, settings.longCaptureDelayMs))
      }
    }
    publishLongProgress({ phase: 'stitching', frame: frames.length, maxFrames: settings.longCaptureMaxFrames, message: '正在匹配并拼接长截图' })
    const { png } = await stitchVerticalFrames(frames)
    publishLongProgress({ phase: 'complete', frame: frames.length, maxFrames: settings.longCaptureMaxFrames, message: `长截图完成，共 ${frames.length} 帧` })
    const image = nativeImage.createFromBuffer(png)
    await commitResult(image, 'long')
    try { await writeImageToClipboard(image) } catch (error) { void reportOperationError('自动复制失败', error) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publishLongProgress({ phase: 'error', frame: frames.length, maxFrames: settings.longCaptureMaxFrames, message })
    await dialog.showMessageBox({ type: 'error', title: '长截图失败', message })
    await showRoute('home')
  } finally {
    tray?.setToolTip('拓 Ta · AI 原生截图工具')
  }
}

async function createPinWindow(imageDataUrl: string) {
  const image = nativeImage.createFromDataURL(imageDataUrl)
  const size = image.getSize()
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workAreaSize
  const scale = Math.min(1, (workArea.width * 0.55) / size.width, (workArea.height * 0.55) / size.height)
  const pin = createTaWindow({
    width: Math.max(220, Math.round(size.width * scale)),
    height: Math.max(140, Math.round(size.height * scale)),
    minWidth: 160,
    minHeight: 100,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    hasShadow: true,
  })
  pin.setAlwaysOnTop(true, 'floating')
  pin.setSkipTaskbar(true)
  pinWindows.add(pin)
  const pinWebContentsId = pin.webContents.id
  pinPayloads.set(pinWebContentsId, imageDataUrl)
  pin.on('closed', () => { pinWindows.delete(pin); pinPayloads.delete(pinWebContentsId); pinMoveOrigins.delete(pinWebContentsId) })
  await loadRoute(pin, 'pin')
  sendWhenReady(pin, 'pin:init', { imageDataUrl })
  pin.show()
  pin.setSkipTaskbar(true)
  return pin.id
}

function registerHotkeys(settings: AppSettings) {
  globalShortcut.unregisterAll()
  const statuses: Record<string, boolean> = {}
  if (hotkeysSuspended) return Object.fromEntries(Object.keys(settings.hotkeys).map((action) => [action, true]))
  for (const [action, accelerator] of Object.entries(settings.hotkeys)) {
    if (!accelerator) {
      statuses[action] = true
      continue
    }
    try {
      statuses[action] = globalShortcut.register(accelerator, () => void startCapture(action as CaptureAction))
    } catch {
      statuses[action] = false
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hotkeys:status', statuses)
  return statuses
}

async function registerHotkeysAfterRelease(settings: AppSettings) {
  let statuses = registerHotkeys(settings)
  if (Object.values(statuses).every(Boolean)) return statuses
  // Windows can briefly retain a just-unregistered accelerator while a
  // packaged app is moving focus out of the recorder. Retry once after that
  // message/focus turn; a genuine external conflict still remains false.
  await new Promise((resolve) => setTimeout(resolve, 120))
  statuses = registerHotkeys(settings)
  return statuses
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 18, height: 18 }))
  tray.setToolTip('拓 Ta · AI 原生截图工具')
  const rebuild = () => {
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: '打开拓 Ta', click: () => void showRoute('home') },
      { type: 'separator' },
      { label: '通用截图', accelerator: store.getSettings().hotkeys.capture, click: () => void startCapture('capture') },
      { label: '极速取字', accelerator: store.getSettings().hotkeys.ocr, click: () => void startCapture('ocr') },
      { label: '快速截图', accelerator: store.getSettings().hotkeys.copy, click: () => void startCapture('copy') },
      { label: '截图钉图', accelerator: store.getSettings().hotkeys.pin, click: () => void startCapture('pin') },
      { label: '滚动长截图', accelerator: store.getSettings().hotkeys.long, click: () => void startCapture('long') },
      { label: '截图翻译', accelerator: store.getSettings().hotkeys.translate, click: () => void startCapture('translate') },
      { type: 'separator' },
      {
        label: '恢复所有钉图交互',
        click: () => {
          for (const pin of pinWindows) pin.setIgnoreMouseEvents(false)
        },
      },
      { label: '设置', click: () => void showRoute('settings') },
      { type: 'separator' },
      { label: '退出', click: () => { isQuitting = true; app.quit() } },
    ]))
  }
  rebuild()
  tray.on('double-click', () => void showRoute('home'))
  return rebuild
}

function isMainSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents)
}

function requireMainSender(event: Electron.IpcMainInvokeEvent) {
  if (!isMainSender(event)) throw new Error('拒绝来自非主窗口的 IPC 请求。')
}

async function reportOperationError(title: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[${title}]`, error)
  const options: Electron.MessageBoxOptions = { type: 'error', title, message }
  if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, options)
  else await dialog.showMessageBox(options)
}

async function confirmCloudUpload() {
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: '确认发送截图',
    message: '这张截图将发送到你配置的第三方模型服务。',
    detail: '截图可能包含个人信息、账号、业务数据或其他敏感内容。',
    buttons: ['取消', '继续发送'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

function installIpcHandlers(rebuildTray: () => void) {
  ipcMain.handle('app:info', (event) => {
    requireMainSender(event)
    return { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }
  })
  ipcMain.on('window:minimize', (event) => {
    if (isMainSender(event)) BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on('window:toggle-maximize', (event) => {
    if (!isMainSender(event)) return
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window.isMaximized()) window.unmaximize(); else window.maximize()
  })
  ipcMain.on('window:close', (event) => {
    if (isMainSender(event)) BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('capture:start', (event, action: unknown) => {
    requireMainSender(event)
    return startCapture(action)
  })
  ipcMain.handle('overlay:get-init', (event): OverlayPayload | undefined => {
    const session = overlaySessions.get(event.sender.id)
    return session?.payload
  })
  ipcMain.on('overlay:ready', (event) => {
    if (overlaySessions.has(event.sender.id)) overlayReadyIds.add(event.sender.id)
  })
  ipcMain.on('overlay:cancel', (event) => {
    if (!overlaySessions.has(event.sender.id)) return
    closeOverlays()
    void showRoute('home').catch((error) => reportOperationError('恢复主窗口失败', error))
  })
  ipcMain.on('overlay:select', (event, rectValue: unknown) => {
    const session = overlaySessions.get(event.sender.id)
    if (!session) return
    try {
      const rect = parseSelectionRect(rectValue, session.display.bounds)
      completeOverlaySelection(session, rect)
    } catch (error) {
      closeOverlays()
      void showRoute('home')
      void reportOperationError('截图区域无效', error)
    }
  })
  ipcMain.handle('result:get', (event) => {
    requireMainSender(event)
    return lastResult
  })
  ipcMain.handle('image:copy', async (event, dataUrl?: unknown) => {
    requireMainSender(event)
    await writeImageToClipboard(imageFromOptionalDataUrl(dataUrl))
    return { ok: true }
  })
  ipcMain.handle('text:copy', async (event, value: unknown) => {
    requireMainSender(event)
    const text = parseText(value, '剪贴板文字')
    if (process.env.TA_E2E_SMOKE_FILE) e2eCopiedText = text
    else await clipboard.writeText(text)
    return { ok: true }
  })
  ipcMain.handle('image:save', async (event, dataUrl?: unknown) => {
    requireMainSender(event)
    const image = imageFromOptionalDataUrl(dataUrl)
    const result = await dialog.showSaveDialog({
      title: '保存截图',
      defaultPath: `Ta-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    fs.writeFileSync(result.filePath, image.toPNG())
    return { canceled: false, filePath: result.filePath }
  })
  ipcMain.handle('image:pin', async (event, dataUrl?: unknown) => {
    requireMainSender(event)
    return createPinWindow(imageFromOptionalDataUrl(dataUrl).toDataURL())
  })
  ipcMain.handle('image:commit', async (event, dataUrl: unknown, action: unknown) => {
    requireMainSender(event)
    return commitResult(checkedImage(parsePngDataUrl(dataUrl)), parseResultAction(action), false)
  })
  ipcMain.handle('ocr:run', async (event, dataUrl?: unknown) => {
    requireMainSender(event)
    return ocr.recognize(imageFromOptionalDataUrl(dataUrl).toPNG())
  })
  ipcMain.handle('ai:run', async (event, modeValue: unknown, dataUrl?: unknown, promptValue?: unknown) => {
    requireMainSender(event)
    const mode = parseAiMode(modeValue)
    if (process.env.TA_E2E_SMOKE_FILE && (mode === 'vision' || mode === 'translate')) {
      e2eAiRunCounts[mode] += 1
      await new Promise((resolve) => setTimeout(resolve, 25))
      const firstLine = `E2E ${mode} response ${e2eAiRunCounts[mode]}`
      return mode === 'vision'
        ? `${firstLine}\n${Array.from({ length: 90 }, (_, index) => `第 ${index + 1} 行长内容，用于验证结果区独立滚动与固定复制按钮。`).join('\n')}`
        : firstLine
    }
    const settings = store.getSettings()
    if (settings.cloudUploadConfirmation && !await confirmCloudUpload()) throw new Error('已取消发送截图。')
    const { profile, apiKey } = store.getActiveProvider()
    const finalPrompt = mode === 'custom'
      ? (parseText(promptValue ?? '', '自定义提示词', 20_000).trim() || visionPrompt('vision', settings.sourceLanguage, settings.targetLanguage))
      : visionPrompt(mode, settings.sourceLanguage, settings.targetLanguage)
    return runAI({ profile, apiKey, imageDataUrl: imageFromOptionalDataUrl(dataUrl).toDataURL(), prompt: finalPrompt })
  })
  ipcMain.handle('settings:get', (event) => {
    requireMainSender(event)
    return store.getSettings()
  })
  ipcMain.handle('settings:save', async (event, settingsValue: unknown) => {
    requireMainSender(event)
    const updated = store.updateSettings(parseSettingsUpdate(settingsValue))
    app.setLoginItemSettings({ openAtLogin: updated.autoLaunch, args: updated.launchMinimized ? ['--minimized'] : [] })
    const hotkeyStatus = await registerHotkeysAfterRelease(updated)
    rebuildTray()
    return { settings: updated, hotkeyStatus }
  })
  ipcMain.on('hotkeys:recording', (event, active: unknown) => {
    if (!isMainSender(event) || typeof active !== 'boolean') return
    hotkeysSuspended = active
    if (active) globalShortcut.unregisterAll()
    else registerHotkeys(store.getSettings())
  })
  ipcMain.handle('history:list', (event) => {
    requireMainSender(event)
    return store.listHistory()
  })
  ipcMain.handle('history:open', async (event, idValue: unknown) => {
    requireMainSender(event)
    const id = parseHistoryId(idValue)
    const image = store.getHistoryImage(id)
    if (!image) throw new Error('截图历史文件不存在。')
    const item = store.listHistory().find((candidate) => candidate.id === id)
    const size = image.getSize()
    lastResult = { id, imageDataUrl: image.toDataURL(), width: size.width, height: size.height, action: item?.action ?? 'capture', createdAt: item?.createdAt ?? new Date().toISOString() }
    return lastResult
  })
  ipcMain.handle('history:delete', (event, idValue: unknown) => {
    requireMainSender(event)
    const id = parseHistoryId(idValue)
    const deleted = store.deleteHistory(id)
    if (deleted && lastResult?.id === id) lastResult = undefined
    if (deleted && mainWindow && !mainWindow.isDestroyed()) sendWhenReady(mainWindow, 'history:changed', store.listHistory())
    return deleted
  })
  ipcMain.on('navigation:home', (event) => { if (isMainSender(event)) void showRoute('home') })
  ipcMain.on('navigation:settings', (event) => { if (isMainSender(event)) void showRoute('settings') })
  ipcMain.on('pin:command', (event, commandValue: unknown, value?: unknown) => {
    if (!pinPayloads.has(event.sender.id)) return
    const pin = BrowserWindow.fromWebContents(event.sender)
    if (!pin) return
    let command: ReturnType<typeof parsePinCommand>
    try { command = parsePinCommand(commandValue) } catch { return }
    if (command === 'close') pin.close()
    if (command === 'opacity') {
      const opacity = Number(value)
      if (Number.isFinite(opacity)) pin.setOpacity(Math.max(0.2, Math.min(1, opacity)))
    }
    if (command === 'passthrough') {
      pin.setIgnoreMouseEvents(true, { forward: true })
      new Notification({ title: '拓 Ta', body: '钉图已启用鼠标穿透；把鼠标移到右上角工具栏即可恢复。' }).show()
    }
    if (command === 'interactive') pin.setIgnoreMouseEvents(false)
    if (command === 'move-start') {
      try { pinMoveOrigins.set(event.sender.id, { point: parsePinPoint(value), bounds: pin.getBounds() }) } catch { pinMoveOrigins.delete(event.sender.id) }
    }
    if (command === 'move') {
      const origin = pinMoveOrigins.get(event.sender.id)
      if (!origin) return
      try {
        const point = parsePinPoint(value)
        pin.setPosition(Math.round(origin.bounds.x + point.x - origin.point.x), Math.round(origin.bounds.y + point.y - origin.point.y), false)
      } catch { pinMoveOrigins.delete(event.sender.id) }
    }
    if (command === 'move-end') pinMoveOrigins.delete(event.sender.id)
  })
  ipcMain.handle('pin:get-init', (event) => {
    const imageDataUrl = pinPayloads.get(event.sender.id)
    return imageDataUrl ? { imageDataUrl } : undefined
  })
}

function importCpaFromTaskManager(pipedApiKey?: string) {
  const sourcePath = path.join(app.getPath('appData'), 'sap-ops-task-float', 'settings.json')
  const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as {
    aiProviders?: Record<string, { baseUrl?: unknown; model?: unknown; encryptedApiKey?: unknown }>
    cpaBaseUrl?: unknown
    cpaModel?: unknown
    encryptedApiKey?: unknown
  }
  const cpa = raw.aiProviders?.cpa ?? {}
  const baseUrl = String(cpa.baseUrl ?? raw.cpaBaseUrl ?? 'https://cpa.fengsha.online/v1').trim().replace(/\/+$/, '')
  const model = String(cpa.model ?? raw.cpaModel ?? 'gpt-5.5').trim()
  const encryptedApiKey = String(cpa.encryptedApiKey ?? raw.encryptedApiKey ?? '')
  if (new URL(baseUrl).hostname !== 'cpa.fengsha.online') throw new Error('来源配置不是预期的风沙 CPA 地址。')
  if (!encryptedApiKey) throw new Error('任务管理工具中没有已保存的 CPA API Key。')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用。')
  const apiKey = pipedApiKey ?? safeStorage.decryptString(Buffer.from(encryptedApiKey, 'base64'))
  if (!apiKey.trim()) throw new Error('任务管理工具中的 CPA API Key 无法解密。')

  const current = store.getSettings()
  const cpaProfile = { id: 'fengsha-cpa', name: '风沙 CPA', kind: 'openai' as const, baseUrl, model }
  const providers = current.providers.some((provider) => provider.id === cpaProfile.id)
    ? current.providers.map((provider) => provider.id === cpaProfile.id ? { ...provider, ...cpaProfile } : provider)
    : [cpaProfile, ...current.providers]
  const updated = store.updateSettings({
    ...current,
    activeProviderId: cpaProfile.id,
    providers,
    apiKeys: { [cpaProfile.id]: apiKey },
  })
  return {
    ok: true,
    sourcePath,
    activeProviderId: updated.activeProviderId,
    baseUrl: cpaProfile.baseUrl,
    model: cpaProfile.model,
    hasApiKey: updated.providers.find((provider) => provider.id === cpaProfile.id)?.hasApiKey === true,
  }
}

async function runCpaMaintenanceMode() {
  const importMarker = process.env.TA_CPA_IMPORT_MARKER
  const verifyMarker = process.env.TA_CPA_VERIFY_MARKER
  if (!importMarker && !verifyMarker) return false
  const marker = importMarker || verifyMarker!
  try {
    if (importMarker) {
      const pipedApiKey = process.env.TA_CPA_IMPORT_FROM_STDIN === '1' ? fs.readFileSync(0, 'utf8') : undefined
      fs.writeFileSync(marker, JSON.stringify(importCpaFromTaskManager(pipedApiKey)))
    } else {
      const { profile, apiKey } = store.getActiveProvider()
      if (profile.id !== 'fengsha-cpa') throw new Error('当前生效服务不是风沙 CPA。')
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180"><rect width="100%" height="100%" fill="white"/><text x="38" y="118" font-family="Arial" font-weight="700" font-size="70" fill="black">TA-CPA-7319</text></svg>')
      const png = await sharp(svg).png().toBuffer()
      const response = await runAI({
        profile,
        apiKey,
        imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
        prompt: '请识别图片中的代码，只回复代码本身，不要添加解释。',
      })
      fs.writeFileSync(marker, JSON.stringify({
        ok: /TA[- ]?CPA[- ]?7319/i.test(response),
        activeProviderId: profile.id,
        baseUrl: profile.baseUrl,
        model: profile.model,
        responseLength: response.length,
        visionRoundTrip: /TA[- ]?CPA[- ]?7319/i.test(response),
      }))
    }
  } catch (error) {
    fs.writeFileSync(marker, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  } finally {
    isQuitting = true
    app.exit(0)
  }
  return true
}

async function bootstrap() {
  store = new TaStore()
  ocr = new OfflineOCR()
  if (await runCpaMaintenanceMode()) return
  startWindowsCaptureHost()
  electronSession.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  protocol.handle('ta-media', (request) => {
    const id = new URL(request.url).pathname.split('/').filter(Boolean).at(-1) ?? ''
    const filePath = store.getHistoryFile(id)
    return filePath ? net.fetch(pathToFileURL(filePath).toString()) : new Response('Not found', { status: 404 })
  })
  const rebuildTray = createTray()
  installIpcHandlers(rebuildTray)
  const hotkeyStatus = registerHotkeys(store.getSettings())
  const minimized = process.argv.includes('--minimized') || store.getSettings().launchMinimized
  if (!minimized) await showRoute('home')
  void prewarmOverlayShells().catch((error) => console.warn('[overlay-prewarm]', error))
  const refreshOverlayShells = () => { void prewarmOverlayShells().catch(() => undefined) }
  screen.on('display-added', refreshOverlayShells)
  screen.on('display-removed', refreshOverlayShells)
  screen.on('display-metrics-changed', refreshOverlayShells)

  if (process.env.TA_SMOKE_FILE) {
    fs.writeFileSync(process.env.TA_SMOKE_FILE, JSON.stringify({ ready: true, version: app.getVersion(), platform: process.platform, pid: process.pid, packaged: Boolean(app.isPackaged), hotkeyStatus }))
    setTimeout(() => { isQuitting = true; app.quit() }, 1500)
  }
  if (process.env.TA_E2E_SMOKE_FILE) {
    let e2eWitness: BrowserWindow | undefined
    try {
      const reportE2eStage = (stage: string) => console.log(`[ta-e2e] ${stage}`)
      reportE2eStage('bootstrap')
      if (process.platform === 'win32' && process.env.TA_DISABLE_WINDOWS_CAPTURE_HOST !== '1') {
        const captureHostReadyDeadline = Date.now() + 5_000
        while (!windowsCaptureHostReady && Date.now() < captureHostReadyDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        if (!windowsCaptureHostReady) throw new Error('Windows 截图辅助进程未在 5 秒内就绪。')
      }
      await prewarmOverlayShells()
      const display = screen.getPrimaryDisplay()
      if (mainWindow && !mainWindow.isDestroyed()) {
        const width = Math.max(720, Math.min(1180, display.bounds.width - 80))
        const height = Math.max(560, Math.min(780, display.bounds.height - 80))
        mainWindow.setBounds({
          x: display.bounds.x + Math.round((display.bounds.width - width) / 2),
          y: display.bounds.y + Math.round((display.bounds.height - height) / 2),
          width,
          height,
        })
      }
      let desktop: NativeImage
      if (windowsCaptureHostReady) {
        const initialCapture = await screenSourcesFromWindowsHost([display])
        const nativeDesktop = initialCapture.sources.get(display.id)
        if (!nativeDesktop) throw new Error('Windows 截图辅助进程没有返回主显示器画面。')
        desktop = nativeDesktop
      } else {
        desktop = await screenSourceForDisplay(display)
      }
      const desktopSize = desktop.getSize()
      const desktopStats = await analyzeNativeImageContent(desktop)
      let capturePixelWitnessSupported = true
      const countGreenWitnessPixels = async (source: NativeImage) => {
        const searchable = await sharp(source.toPNG()).resize({ width: 512, fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
        let count = 0
        for (let offset = 0; offset < searchable.data.length; offset += searchable.info.channels) {
          const red = searchable.data[offset]
          const green = searchable.data[offset + 1]
          const blue = searchable.data[offset + 2]
          if (green > 150 && green > red * 2 && green > blue * 1.4) count += 1
        }
        return count
      }
      const mainHideWitness = { left: 92, top: 138, width: 236, height: 148 }
      const countMainHideWitnessPixels = async (source: NativeImage, mainBounds: Electron.Rectangle) => {
        const scale = source.getSize().width / display.bounds.width
        const crop = {
          x: Math.max(0, Math.round((mainBounds.x + mainHideWitness.left - display.bounds.x) * scale)),
          y: Math.max(0, Math.round((mainBounds.y + mainHideWitness.top - display.bounds.y) * scale)),
          width: Math.max(1, Math.round(mainHideWitness.width * scale)),
          height: Math.max(1, Math.round(mainHideWitness.height * scale)),
        }
        crop.width = Math.min(crop.width, source.getSize().width - crop.x)
        crop.height = Math.min(crop.height, source.getSize().height - crop.y)
        if (crop.width <= 0 || crop.height <= 0) return 0
        const pixels = await sharp(source.crop(crop).toPNG()).removeAlpha().raw().toBuffer({ resolveWithObject: true })
        let count = 0
        for (let offset = 0; offset < pixels.data.length; offset += pixels.info.channels) {
          const red = pixels.data[offset]
          const green = pixels.data[offset + 1]
          const blue = pixels.data[offset + 2]
          if (red > 125 && blue > 75 && red > green * 1.65 && blue > green * 1.2) count += 1
        }
        return count
      }
      const sample = desktop.crop({
        x: Math.max(0, Math.floor((desktopSize.width - Math.min(320, desktopSize.width)) / 2)),
        y: Math.max(0, Math.floor((desktopSize.height - Math.min(180, desktopSize.height)) / 2)),
        width: Math.min(320, desktopSize.width),
        height: Math.min(180, desktopSize.height),
      })
      const syntheticSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220"><rect width="100%" height="100%" fill="white"/><text x="42" y="145" font-family="Arial" font-weight="700" font-size="82" fill="black">TA WINDOWS 2026</text></svg>')
      const syntheticPng = await sharp(syntheticSvg).png().toBuffer()
      const ocrResult = await ocr.recognize(syntheticPng)
      const secureStorageAvailable = safeStorage.isEncryptionAvailable()
      const encryptionRoundTrip = secureStorageAvailable
        ? safeStorage.decryptString(safeStorage.encryptString('ta-windows-self-test')) === 'ta-windows-self-test'
        : false
      const overlayWindowBaseline = overlayWindowCreatedCount
      const witnessBounds = {
        x: display.bounds.x + 24,
        y: display.bounds.y + Math.max(24, display.bounds.height - 164),
        width: 180,
        height: 120,
      }
      e2eWitness = createTaWindow({ ...witnessBounds, title: 'TA E2E SMART WITNESS 7319', frame: false, skipTaskbar: true, resizable: false, alwaysOnTop: true, backgroundColor: '#14c86e' })
      e2eWitness.setAlwaysOnTop(true, 'screen-saver', 99)
      e2eWitness.setIgnoreMouseEvents(true)
      await e2eWitness.loadURL('data:text/html,<title>TA E2E SMART WITNESS 7319</title><style>html,body{margin:0;width:100%;height:100%;background:rgb(20,200,110)}</style>')
      // A packaged Chromium navigation can replace BrowserWindow's constructor
      // title with the document title. Reapply it so the native EnumWindows
      // candidate has a stable identity in both source and installed builds.
      e2eWitness.setTitle('TA E2E SMART WITNESS 7319')
      e2eWitness.showInactive()
      e2eWitness.moveTop()
      await e2eWitness.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
      await new Promise((resolve) => setTimeout(resolve, 180))
      const mainBoundsBeforeHide = mainWindow?.getBounds()
      if (!mainWindow || !mainBoundsBeforeHide) throw new Error('主窗口未准备好，无法验证自动隐藏。')
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 100)
      mainWindow.setOpacity(1)
      mainWindow.show()
      mainWindow.focus()
      mainWindow.moveTop()
      await mainWindow.webContents.executeJavaScript(`(() => {
        document.querySelector('#ta-e2e-hide-witness')?.remove()
        const witness = document.createElement('div')
        witness.id = 'ta-e2e-hide-witness'
        Object.assign(witness.style, {
          position: 'fixed', left: '${mainHideWitness.left}px', top: '${mainHideWitness.top}px',
          width: '${mainHideWitness.width}px', height: '${mainHideWitness.height}px',
          background: 'rgb(246, 10, 174)', zIndex: '2147483647', pointerEvents: 'none'
        })
        document.body.append(witness)
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })()`)
      await new Promise((resolve) => setTimeout(resolve, 80))
      let mainHideWitnessPixelsBefore = 0
      if (windowsCaptureHostReady) {
        // Codex/CI can launch GUI processes on an isolated Windows desktop where
        // CopyFromScreen returns a session background and cannot see even this
        // known visible window. Probe that exact capability instead of inferring
        // it from image variance, then label the pixel assertion honestly.
        const witnessProbeDeadline = Date.now() + 1_000
        while (mainHideWitnessPixelsBefore < 2_000 && Date.now() < witnessProbeDeadline) {
          const witnessProbe = await screenSourcesFromWindowsHost([display])
          const witnessProbeSource = witnessProbe.sources.get(display.id)
          capturePixelWitnessSupported = Boolean(witnessProbeSource && await countGreenWitnessPixels(witnessProbeSource) >= 250)
          if (witnessProbeSource) mainHideWitnessPixelsBefore = await countMainHideWitnessPixels(witnessProbeSource, mainBoundsBeforeHide)
          if (mainHideWitnessPixelsBefore < 2_000) await new Promise((resolve) => setTimeout(resolve, 40))
        }
      }
      const captureStartedAt = performance.now()
      await startCapture('capture')
      const unrelatedWindowStayedVisible = e2eWitness.isVisible()
      const mainWindowHiddenByPolicy = !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()
      const overlayCount = overlaySessions.size
      const primaryOverlay = [...overlaySessions.values()].find((candidate) => candidate.display.id === display.id)
      if (!primaryOverlay) throw new Error('未找到主显示器截图覆盖层。')
      const expectedCaptureId = captureGeneration
      const interactionReadyDeadline = Date.now() + 2_000
      let interactionReady = false
      while (!interactionReady && Date.now() < interactionReadyDeadline) {
        const overlayDomReady = await primaryOverlay.window.webContents.executeJavaScript(`(() => {
          const overlay = document.querySelector('[data-testid="capture-overlay"]')
          return overlay instanceof HTMLElement
            && overlay.dataset.captureId === '${expectedCaptureId}'
            && ${Boolean(lastCaptureTiming?.inputShield) ? "overlay.classList.contains('preparing')" : 'true'}
        })()`)
        interactionReady = primaryOverlay.window.isVisible() && overlayDomReady
        if (!interactionReady) await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const captureReadyMs = Math.round(performance.now() - captureStartedAt)
      const inputShieldReady = await primaryOverlay.window.webContents.executeJavaScript(`(() => {
        const overlay = document.querySelector('[data-testid="capture-overlay"]')
        return overlay instanceof HTMLElement
          && overlay.classList.contains('preparing')
          && overlay.style.backgroundImage === 'none'
      })()`)
      await primaryOverlay.window.webContents.executeJavaScript(`(() => {
        const overlay = document.querySelector('[data-testid="capture-overlay"]')
        if (overlay instanceof HTMLElement) overlay.dataset.e2eInputIsolation = 'true'
      })()`)
      await primaryOverlay.window.webContents.executeJavaScript(`(() => {
        const overlay = document.querySelector('[data-testid="capture-overlay"]')
        const state = { frames: 0, moves: 0, maxFrameGap: 0, totalFrameGap: 0, done: false }
        let lastFrame = performance.now()
        const onMove = () => { state.moves += 1 }
        overlay.addEventListener('pointermove', onMove)
        const frame = (now) => {
          const gap = now - lastFrame
          lastFrame = now
          state.frames += 1
          state.totalFrameGap += gap
          state.maxFrameGap = Math.max(state.maxFrameGap, gap)
          if (state.frames < 30) requestAnimationFrame(frame)
          else { state.done = true; overlay.removeEventListener('pointermove', onMove) }
        }
        window.__taStartupPointerPerf = state
        requestAnimationFrame(frame)
        return true
      })()`)
      for (let step = 0; step < 30; step += 1) {
        await primaryOverlay.window.webContents.executeJavaScript(`(() => {
          const overlay = document.querySelector('[data-testid="capture-overlay"]')
          if (!(overlay instanceof HTMLElement)) return false
          const event = new PointerEvent('pointermove', {
            bubbles: true, cancelable: true, pointerId: 70, pointerType: 'mouse', isPrimary: true,
            button: 0, buttons: 0, clientX: ${80} + ${step} * 3, clientY: ${90} + ${step} * 2,
          })
          Object.defineProperty(event, '__taE2E', { value: true })
          overlay.dispatchEvent(event)
          return true
        })()`)
        await new Promise((resolve) => setTimeout(resolve, 6))
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
      const startupPointerSmoothness = await primaryOverlay.window.webContents.executeJavaScript(`(() => {
        const state = window.__taStartupPointerPerf
        return {
          frames: state?.frames ?? 0,
          moves: state?.moves ?? 0,
          maxFrameGap: Math.round(state?.maxFrameGap ?? 9999),
          averageFrameGap: state?.frames ? Math.round(state.totalFrameGap / state.frames) : 9999,
          done: Boolean(state?.done),
        }
      })()`)
      const overlayReadyDeadline = Date.now() + 5_000
      while (overlayReadyIds.size < overlayCount && Date.now() < overlayReadyDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const overlayReadyCount = overlayReadyIds.size
      const waitForUi = () => new Promise((resolve) => setTimeout(resolve, 60))
      const readSelection = () => primaryOverlay.window.webContents.executeJavaScript(`(() => {
        const box = document.querySelector('[data-testid="selection-box"]')
        if (!(box instanceof HTMLElement)) return null
        const rect = box.getBoundingClientRect()
        return {
          x: Math.round(rect.x), y: Math.round(rect.y),
          width: Math.round(rect.width), height: Math.round(rect.height),
          state: box.dataset.interaction,
          handleCount: box.querySelectorAll('[data-resize-handle]').length,
        }
      })()`)
      const dragPointer = async (start: { x: number; y: number }, end: { x: number; y: number }) => {
        await primaryOverlay.window.webContents.executeJavaScript(`(() => {
          const overlay = document.querySelector('[data-testid="capture-overlay"]')
          const start = ${JSON.stringify(start)}
          const end = ${JSON.stringify(end)}
          const middle = { x: Math.round((start.x + end.x) / 2), y: Math.round((start.y + end.y) / 2) }
          const target = document.elementFromPoint(start.x, start.y) || overlay
          const makeEvent = (type, point, buttons) => {
            const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 73, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: point.x, clientY: point.y })
            Object.defineProperty(event, '__taE2E', { value: true })
            return event
          }
          target.dispatchEvent(makeEvent('pointerdown', start, 1))
          overlay.dispatchEvent(makeEvent('pointermove', middle, 1))
          overlay.dispatchEvent(makeEvent('pointermove', end, 1))
          overlay.dispatchEvent(makeEvent('pointerup', end, 0))
          return true
        })()`)
        await waitForUi()
      }
      const dragPointerSmoothly = async (start: { x: number; y: number }, end: { x: number; y: number }) => {
        await primaryOverlay.window.webContents.executeJavaScript(`(async () => {
          const overlay = document.querySelector('[data-testid="capture-overlay"]')
          if (!(overlay instanceof HTMLElement)) return false
          const start = ${JSON.stringify(start)}
          const end = ${JSON.stringify(end)}
          for (let step = 1; step <= 30; step += 1) {
            const progress = step / 30
            const event = new PointerEvent('pointermove', {
              bubbles: true, cancelable: true, pointerId: 72, pointerType: 'mouse', isPrimary: true,
              button: 0, buttons: 0,
              clientX: Math.round(start.x + (end.x - start.x) * progress),
              clientY: Math.round(start.y + (end.y - start.y) * progress),
            })
            Object.defineProperty(event, '__taE2E', { value: true })
            overlay.dispatchEvent(event)
            await new Promise((resolve) => setTimeout(resolve, 6))
          }
          return true
        })()`)
        await waitForUi()
      }
      const overlayWidth = primaryOverlay.display.bounds.width
      const overlayHeight = primaryOverlay.display.bounds.height
      const createStart = { x: Math.round(overlayWidth * 0.12), y: Math.round(overlayHeight * 0.15) }
      const createEnd = { x: Math.round(overlayWidth * 0.42), y: Math.round(overlayHeight * 0.4) }
      await lastCaptureHydration
      reportE2eStage('initial-capture-hydrated')
      const mainHideWitnessPixelsAfter = primaryOverlay.source
        ? await countMainHideWitnessPixels(primaryOverlay.source, mainBoundsBeforeHide)
        : mainHideWitnessPixelsBefore
      const mainWindowPixelExcluded = !capturePixelWitnessSupported
        || (mainHideWitnessPixelsBefore >= 2_000 && mainHideWitnessPixelsAfter <= Math.max(40, Math.round(mainHideWitnessPixelsBefore * 0.015)))
      mainWindow?.setAlwaysOnTop(false)
      await mainWindow?.webContents.executeJavaScript("document.querySelector('#ta-e2e-hide-witness')?.remove()")
      await waitForUi()
      const captureTiming = { ...lastCaptureTiming }
      const capturePreviewReadyMs = Number(captureTiming.hydratedMs ?? Math.round(performance.now() - captureStartedAt))
      await dragPointer(createStart, createEnd)
      const created = await readSelection() as { x: number; y: number; width: number; height: number; state?: string; handleCount: number } | null
      if (!created) throw new Error('鼠标松开后选区未保留。')
      const moveDelta = { x: Math.max(24, Math.round(overlayWidth * 0.04)), y: Math.max(20, Math.round(overlayHeight * 0.04)) }
      const moveStart = { x: created.x + Math.round(created.width / 2), y: created.y + Math.round(created.height / 2) }
      await primaryOverlay.window.webContents.executeJavaScript(`(() => {
        const overlay = document.querySelector('[data-testid="capture-overlay"]')
        const state = { frames: 0, moves: 0, maxFrameGap: 0, totalFrameGap: 0, done: false }
        let lastFrame = performance.now()
        const onMove = () => { state.moves += 1 }
        overlay.addEventListener('pointermove', onMove)
        const frame = (now) => {
          const gap = now - lastFrame
          lastFrame = now
          state.frames += 1
          state.totalFrameGap += gap
          state.maxFrameGap = Math.max(state.maxFrameGap, gap)
          if (state.frames < 30) requestAnimationFrame(frame)
          else { state.done = true; overlay.removeEventListener('pointermove', onMove) }
        }
        window.__taPointerPerf = state
        requestAnimationFrame(frame)
        return true
      })()`)
      await dragPointerSmoothly(moveStart, { x: moveStart.x + moveDelta.x, y: moveStart.y + moveDelta.y })
      await dragPointer(moveStart, { x: moveStart.x + moveDelta.x, y: moveStart.y + moveDelta.y })
      const moved = await readSelection() as typeof created
      if (!moved) throw new Error('移动选区后选区消失。')
      const resizeStart = await primaryOverlay.window.webContents.executeJavaScript(`(() => {
        const handle = document.querySelector('[data-resize-handle="se"]')
        if (!(handle instanceof HTMLElement)) return null
        const rect = handle.getBoundingClientRect()
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
      })()`) as { x: number; y: number } | null
      if (!resizeStart) throw new Error('选区缩放控制点未渲染。')
      await dragPointer(resizeStart, { x: resizeStart.x + moveDelta.x, y: resizeStart.y + moveDelta.y })
      const resized = await readSelection() as typeof created
      if (!resized) throw new Error('缩放选区后选区消失。')
      const pointerSmoothness = await primaryOverlay.window.webContents.executeJavaScript(`(() => {
        const state = window.__taPointerPerf
        return {
          frames: state?.frames ?? 0,
          moves: state?.moves ?? 0,
          maxFrameGap: Math.round(state?.maxFrameGap ?? 9999),
          averageFrameGap: state?.frames ? Math.round(state.totalFrameGap / state.frames) : 9999,
          done: Boolean(state?.done),
        }
      })()`)
      const frozenSource = primaryOverlay.source
      if (!frozenSource) throw new Error('冻结截图源未生成。')
      const captureSourceStats = await analyzeNativeImageContent(frozenSource)
      const witnessSelection = {
        x: witnessBounds.x - display.bounds.x,
        y: witnessBounds.y - display.bounds.y,
        width: witnessBounds.width,
        height: witnessBounds.height,
      }
      const capturedWitness = cropSelection(primaryOverlay, witnessSelection)
      const captureCropStats = await analyzeNativeImageContent(capturedWitness)
      const capturedResult = await commitResult(capturedWitness, 'capture', false)
      const capturedHistoryPath = store.getHistoryFile(capturedResult.id)
      if (!capturedHistoryPath) throw new Error('真实截图结果没有写入隔离历史目录。')
      const persistedCaptureStats = await analyzeImageContent(fs.readFileSync(capturedHistoryPath))
      const capturedResultPersisted = !persistedCaptureStats.probablyBlack
        && capturedResult.width === capturedWitness.getSize().width
        && capturedResult.height === capturedWitness.getSize().height
      const greenWitnessPixels = await countGreenWitnessPixels(frozenSource)
      const captureWitnessPixelsVerified = greenWitnessPixels >= 250
      const captureExclusionVerified = !capturePixelWitnessSupported || captureWitnessPixelsVerified
      const capturePreviewReady = await primaryOverlay.window.webContents.executeJavaScript(`(() => {
        const overlay = document.querySelector('[data-testid="capture-overlay"]')
        return overlay instanceof HTMLElement && !overlay.classList.contains('preparing') && overlay.style.backgroundImage !== 'none'
      })()`)
      const selectionInteraction = {
        selectionCreated: created.state === 'selected' && created.width > 20 && created.height > 20,
        selectionMoved: moved.state === 'selected' && moved.x >= created.x + moveDelta.x - 2 && moved.y >= created.y + moveDelta.y - 2
          && Math.abs(moved.width - created.width) <= 2 && Math.abs(moved.height - created.height) <= 2,
        selectionResized: resized.state === 'selected'
          && resized.width >= moved.width - 2
          && resized.height >= moved.height - 2
          && (resized.width >= moved.width + moveDelta.x - 2 || resized.height >= moved.height + moveDelta.y - 2),
        resizeHandleCount: resized.handleCount,
      }
      const resultIdBeforeDoubleClick = lastResult?.id
      e2eCopiedImageSha256 = ''
      const doubleClickPoint = { x: resized.x + Math.round(resized.width / 2), y: resized.y + Math.round(resized.height / 2) }
      await dragPointer(doubleClickPoint, doubleClickPoint)
      await dragPointer(doubleClickPoint, doubleClickPoint)
      const doubleClickDeadline = Date.now() + 2_000
      while ((overlaySessions.size > 0 || lastResult?.id === resultIdBeforeDoubleClick) && Date.now() < doubleClickDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const doubleClickConfirmed = overlaySessions.size === 0 && Boolean(lastResult?.id) && lastResult?.id !== resultIdBeforeDoubleClick
      const autoCopiedResultPath = lastResult ? store.getHistoryFile(lastResult.id) : undefined
      const autoCopiedCapture = Boolean(autoCopiedResultPath && e2eCopiedImageSha256
        && crypto.createHash('sha256').update(fs.readFileSync(autoCopiedResultPath)).digest('hex') === e2eCopiedImageSha256)

      await showRoute('home')
      let quickCaptureUi: { title: string; description: string } | null = null
      const quickCaptureUiDeadline = Date.now() + 2_000
      while (!quickCaptureUi && Date.now() < quickCaptureUiDeadline) {
        quickCaptureUi = await mainWindow?.webContents.executeJavaScript(`(() => {
          const button = document.querySelector('[data-capture-action="copy"]')
          return button instanceof HTMLButtonElement ? {
            title: button.querySelector('b')?.textContent || '',
            description: button.querySelector('small')?.textContent || '',
          } : null
        })()`) ?? null
        if (!quickCaptureUi) await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const quickHistoryCountBefore = store.listHistory().length
      const quickResultIdBefore = lastResult?.id
      e2eCopiedImageSha256 = ''
      await startCapture('copy')
      await lastCaptureHydration
      const quickOverlay = [...overlaySessions.values()].find((candidate) => candidate.display.id === display.id)
      if (!quickOverlay?.source) throw new Error('快速截图没有生成冻结源。')
      completeOverlaySelection(quickOverlay, witnessSelection)
      const quickCaptureDeadline = Date.now() + 2_000
      while ((overlaySessions.size > 0 || lastResult?.id === quickResultIdBefore || store.listHistory().length === quickHistoryCountBefore) && Date.now() < quickCaptureDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const quickCapturePath = lastResult ? store.getHistoryFile(lastResult.id) : undefined
      const quickCaptureCopied = Boolean(quickCapturePath && e2eCopiedImageSha256
        && crypto.createHash('sha256').update(fs.readFileSync(quickCapturePath)).digest('hex') === e2eCopiedImageSha256)
      const quickCaptureSaved = Boolean(lastResult?.action === 'copy'
        && store.listHistory().length === quickHistoryCountBefore + 1
        && store.listHistory()[0]?.id === lastResult.id)
      const quickCaptureHomeRoute = Boolean(await mainWindow?.webContents.executeJavaScript("document.querySelector('.home-page') instanceof HTMLElement"))
      const quickCaptureDidNotOpenEditor = quickCaptureHomeRoute
        && Boolean(!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible())
      const quickCaptureBehaviorVerified = Boolean(quickCaptureUi?.title === '快速截图'
        && quickCaptureUi?.description.includes('自动复制并保存')
        && quickCaptureSaved
        && quickCaptureCopied
        && quickCaptureDidNotOpenEditor)
      await prewarmOverlayShells()
      e2eWitness.setAlwaysOnTop(true, 'screen-saver', 99)
      e2eWitness.show()
      e2eWitness.focus()
      // The E2E process owns this temporary window, so activating it here is
      // intentional: once the overlay takes focus it must remain the first
      // non-overlay native candidate in Windows z-order.
      e2eWitness.moveTop()
      await new Promise((resolve) => setTimeout(resolve, 80))
      const repeatStartedAt = performance.now()
      await startCapture('ocr')
      const repeatOverlay = [...overlaySessions.values()].find((candidate) => candidate.display.id === display.id)
      if (!repeatOverlay) throw new Error('复用覆盖层失败。')
      const expectedRepeatCaptureId = captureGeneration
      const repeatReadyDeadline = Date.now() + 5_000
      let repeatReady = false
      while (!repeatReady && Date.now() < repeatReadyDeadline) {
        repeatReady = repeatOverlay.window.isVisible()
          && await repeatOverlay.window.webContents.executeJavaScript(`(() => {
            const overlay = document.querySelector('[data-testid="capture-overlay"]')
            return overlay instanceof HTMLElement
              && overlay.dataset.captureId === '${expectedRepeatCaptureId}'
              && !document.querySelector('[data-testid="selection-box"]')
          })()`)
        if (!repeatReady) await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const repeatCaptureReadyMs = Math.round(performance.now() - repeatStartedAt)
      await lastCaptureHydration
      const repeatPreviewReadyMs = Math.round(performance.now() - repeatStartedAt)
      const repeatCaptureTiming = { ...lastCaptureTiming }
      const repeatSourceStats = repeatOverlay.source
        ? await analyzeNativeImageContent(repeatOverlay.source)
        : undefined
      const repeatGreenWitnessPixels = repeatOverlay.source ? await countGreenWitnessPixels(repeatOverlay.source) : 0
      const nativeSmartTarget = repeatOverlay.payload.smartSelections?.find((candidate) => candidate.kind === 'window')
        ?? repeatOverlay.payload.smartSelections?.find((candidate) => candidate.kind === 'screen')
      if (!nativeSmartTarget) throw new Error('Windows 原生候选列表为空，无法验证自动边框。')
      const smartPoint = {
        x: nativeSmartTarget.x + Math.round(nativeSmartTarget.width / 2),
        y: nativeSmartTarget.y + Math.round(nativeSmartTarget.height / 2),
      }
      await repeatOverlay.window.webContents.executeJavaScript(`(() => {
        const overlay = document.querySelector('[data-testid="capture-overlay"]')
        const point = ${JSON.stringify(smartPoint)}
        if (!(overlay instanceof HTMLElement)) return false
        const event = new PointerEvent('pointermove', {
          bubbles: true, cancelable: true, pointerId: 90, pointerType: 'mouse', isPrimary: true,
          button: 0, buttons: 0, clientX: point.x, clientY: point.y,
        })
        Object.defineProperty(event, '__taE2E', { value: true })
        overlay.dispatchEvent(event)
        return true
      })()`)
      const smartPreviewDeadline = Date.now() + 1_000
      let smartSelectionPreview: {
        x: number; y: number; width: number; height: number; kind: string; label: string
        maskCount: number; masksAreNeutral: boolean; candidateTransparent: boolean; noGlobalDimLayer: boolean
      } | null = null
      while (!smartSelectionPreview && Date.now() < smartPreviewDeadline) {
        smartSelectionPreview = await repeatOverlay.window.webContents.executeJavaScript(`(() => {
          const overlay = document.querySelector('[data-testid="capture-overlay"]')
          const candidate = document.querySelector('[data-testid="smart-selection"]')
          const point = ${JSON.stringify(smartPoint)}
          if (!(overlay instanceof HTMLElement) || !(candidate instanceof HTMLElement)) return null
          const rect = candidate.getBoundingClientRect()
          if (point.x < rect.x || point.y < rect.y || point.x > rect.right || point.y > rect.bottom) return null
          const candidateStyle = getComputedStyle(candidate)
          const maskStyles = [...document.querySelectorAll('[data-mask-side]')].map((mask) => getComputedStyle(mask))
          return {
            x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
            kind: candidate.dataset.smartKind,
            label: candidate.textContent || '',
            maskCount: maskStyles.length,
            masksAreNeutral: maskStyles.every((style) => style.backgroundColor === 'rgba(20, 20, 20, 0.52)' && style.backdropFilter === 'none' && style.pointerEvents === 'none'),
            candidateTransparent: candidateStyle.backgroundColor === 'rgba(0, 0, 0, 0)',
            noGlobalDimLayer: getComputedStyle(overlay, '::after').content === 'none',
          }
        })()`)
        if (!smartSelectionPreview) await new Promise((resolve) => setTimeout(resolve, 20))
      }
      await repeatOverlay.window.webContents.executeJavaScript(`(() => {
        const overlay = document.querySelector('[data-testid="capture-overlay"]')
        const point = ${JSON.stringify(smartPoint)}
        const target = document.elementFromPoint(point.x, point.y) || overlay
        if (!(overlay instanceof HTMLElement) || !(target instanceof HTMLElement)) return false
        const makeEvent = (type, buttons) => {
          const event = new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 91, pointerType: 'mouse', isPrimary: true,
            button: 0, buttons, clientX: point.x, clientY: point.y,
          })
          Object.defineProperty(event, '__taE2E', { value: true })
          return event
        }
        target.dispatchEvent(makeEvent('pointerdown', 1))
        overlay.dispatchEvent(makeEvent('pointerup', 0))
        return true
      })()`)
      const smartLockDeadline = Date.now() + 1_000
      let smartSelectionLocked: { x: number; y: number; width: number; height: number; background: string; masks: number } | null = null
      while (!smartSelectionLocked && Date.now() < smartLockDeadline) {
        smartSelectionLocked = await repeatOverlay.window.webContents.executeJavaScript(`(() => {
          const box = document.querySelector('[data-testid="selection-box"]')
          if (!(box instanceof HTMLElement)) return null
          const rect = box.getBoundingClientRect()
          return {
            x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
            background: getComputedStyle(box).backgroundColor,
            masks: document.querySelectorAll('[data-mask-side]').length,
          }
        })()`)
        if (!smartSelectionLocked) await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const nativePreviewMatch = smartSelectionPreview && repeatOverlay.payload.smartSelections?.find((candidate) => (
        candidate.kind === smartSelectionPreview.kind
        && Math.abs(smartSelectionPreview.x - candidate.x) <= 2
        && Math.abs(smartSelectionPreview.y - candidate.y) <= 2
        && Math.abs(smartSelectionPreview.width - candidate.width) <= 2
        && Math.abs(smartSelectionPreview.height - candidate.height) <= 2
        && smartPoint.x >= candidate.x
        && smartPoint.y >= candidate.y
        && smartPoint.x <= candidate.x + candidate.width
        && smartPoint.y <= candidate.y + candidate.height
      ))
      const smartSelectionVerified = Boolean(smartSelectionPreview
        && nativePreviewMatch
        && smartSelectionPreview.maskCount >= 1
        && smartSelectionPreview.maskCount <= 4
        && smartSelectionPreview.masksAreNeutral
        && smartSelectionPreview.candidateTransparent
        && smartSelectionPreview.noGlobalDimLayer
        && smartSelectionLocked
        && Math.abs(smartSelectionLocked.x - smartSelectionPreview.x) <= 2
        && Math.abs(smartSelectionLocked.y - smartSelectionPreview.y) <= 2
        && Math.abs(smartSelectionLocked.width - smartSelectionPreview.width) <= 2
        && Math.abs(smartSelectionLocked.height - smartSelectionPreview.height) <= 2
        && smartSelectionLocked.background === 'rgba(0, 0, 0, 0)'
        && smartSelectionLocked.masks === smartSelectionPreview.maskCount)
      closeOverlays()
      await prewarmOverlayShells()

      const overlayWindowCountBeforeReuse = overlayWindowCreatedCount
      const reuseCaptureStats = []
      const reuseGreenWitnessPixels = []
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await startCapture('capture')
        await lastCaptureHydration
        const cycleOverlay = [...overlaySessions.values()].find((candidate) => candidate.display.id === display.id)
        if (!cycleOverlay?.source) throw new Error(`第 ${cycle + 1} 次复用截图没有生成冻结源。`)
        reuseCaptureStats.push(await analyzeNativeImageContent(cycleOverlay.source))
        reuseGreenWitnessPixels.push(await countGreenWitnessPixels(cycleOverlay.source))
        closeOverlays()
        await prewarmOverlayShells()
      }
      const settingsBeforeWindowPolicyTest = store.getSettings()
      await showRoute('settings')
      const captureWindowPolicyUiDeadline = Date.now() + 2_000
      let captureWindowPolicyUi: { value: string; options: string[] } | null = null
      let smartSelectionSettingUi: { initial: boolean; saved: boolean } | null = null
      while (!captureWindowPolicyUi && Date.now() < captureWindowPolicyUiDeadline) {
        captureWindowPolicyUi = await mainWindow?.webContents.executeJavaScript(`(() => {
          const select = document.querySelector('[data-testid="capture-window-policy"]')
          return select instanceof HTMLSelectElement ? {
            value: select.value,
            options: [...select.options].map((option) => option.value),
          } : null
        })()`) ?? null
        if (!captureWindowPolicyUi) await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const smartSelectionInitial = Boolean(await mainWindow?.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('[data-testid="smart-selection-enabled"]')
        return input instanceof HTMLInputElement && input.checked
      })()`))
      await mainWindow?.webContents.executeJavaScript(`(() => {
        const select = document.querySelector('[data-testid="capture-window-policy"]')
        const hotkey = document.querySelector('[data-hotkey-action="capture"] input')
        const smartSelection = document.querySelector('[data-testid="smart-selection-enabled"]')
        if (!(select instanceof HTMLSelectElement) || !(hotkey instanceof HTMLInputElement) || !(smartSelection instanceof HTMLInputElement)) return false
        select.value = 'keep-ta'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        if (smartSelection.checked) smartSelection.click()
        hotkey.focus()
        hotkey.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'F1', key: 'F1', altKey: true }))
        return true
      })()`)
      await new Promise((resolve) => setTimeout(resolve, 80))
      const hotkeyRecorderUi = await mainWindow?.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('[data-hotkey-action="capture"] input')
        const help = document.querySelector('.hotkey-help')
        return input instanceof HTMLInputElement ? {
          value: input.value,
          readOnly: input.readOnly,
          help: help?.textContent || '',
        } : null
      })()`)
      await mainWindow?.webContents.executeJavaScript("document.querySelector('.settings-save button')?.click()")
      const captureWindowPolicySavedDeadline = Date.now() + 2_000
      while ((store.getSettings().captureWindowPolicy !== 'keep-ta' || store.getSettings().hotkeys.capture !== 'Alt+F1' || store.getSettings().smartSelectionEnabled) && Date.now() < captureWindowPolicySavedDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      smartSelectionSettingUi = { initial: smartSelectionInitial, saved: store.getSettings().smartSelectionEnabled }
      const recordedHotkeyDeadline = Date.now() + 2_000
      while ((hotkeysSuspended || !globalShortcut.isRegistered('Alt+F1')) && Date.now() < recordedHotkeyDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const recordedHotkeyRegistered = store.getSettings().hotkeys.capture === 'Alt+F1'
        && globalShortcut.isRegistered('Alt+F1')
        && !hotkeysSuspended
      reportE2eStage('settings-verified')
      captureWindowPolicyUi = await mainWindow?.webContents.executeJavaScript(`(() => {
        const select = document.querySelector('[data-testid="capture-window-policy"]')
        return select instanceof HTMLSelectElement ? {
          value: select.value,
          options: [...select.options].map((option) => option.value),
        } : null
      })()`) ?? null
      await showRoute('home')
      const homeHotkeyDeadline = Date.now() + 2_000
      let homeCaptureHotkey = ''
      while (!homeCaptureHotkey && Date.now() < homeHotkeyDeadline) {
        homeCaptureHotkey = String(await mainWindow?.webContents.executeJavaScript("document.querySelector('.capture-button kbd')?.textContent || ''") ?? '')
        if (!homeCaptureHotkey) await new Promise((resolve) => setTimeout(resolve, 20))
      }
      await startCapture('capture')
      const keepTaOverlay = [...overlaySessions.values()].find((candidate) => candidate.display.id === display.id)
      const keepTaWindowStayedVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())
      const unrelatedWindowStayedVisibleWithTa = e2eWitness.isVisible()
      await lastCaptureHydration
      const smartSelectionDisabledApplied = Boolean(keepTaOverlay && keepTaOverlay.payload.smartSelections === undefined)
      const keepTaCaptureTiming = { ...lastCaptureTiming }
      closeOverlays()
      store.updateSettings(settingsBeforeWindowPolicyTest)
      registerHotkeys(settingsBeforeWindowPolicyTest)
      mainWindow?.hide()
      await prewarmOverlayShells()
      const overlayWindowGrowth = overlayWindowCreatedCount - overlayWindowCountBeforeReuse
      e2eWitness.destroy()
      e2eWitness = undefined

      store.addHistory(syntheticPng, 900, 220, 'capture')
      for (const item of store.listHistory()) store.deleteHistory(item.id)
      const historyWasEmpty = store.listHistory().length === 0
      const recoveredResult = await commitResult(nativeImage.createFromBuffer(syntheticPng), 'capture')
      const resultReadyDeadline = Date.now() + 2_000
      let resultRendered = false
      while (!resultRendered && Date.now() < resultReadyDeadline) {
        resultRendered = Boolean(mainWindow && !mainWindow.isDestroyed() && await mainWindow.webContents.executeJavaScript(`(() => {
          const image = document.querySelector('.result-canvas img')
          return image instanceof HTMLImageElement && image.src.startsWith('data:image/')
        })()`))
        if (!resultRendered) await new Promise((resolve) => setTimeout(resolve, 25))
      }
      const historyRecoveredAfterEmpty = historyWasEmpty
        && store.listHistory().length === 1
        && store.listHistory()[0]?.id === recoveredResult.id
        && resultRendered
      reportE2eStage('history-recovered')

      const largeEditorPng = await sharp({
        create: { width: 2612, height: 1526, channels: 4, background: { r: 246, g: 244, b: 239, alpha: 1 } },
      }).png().toBuffer()
      await commitResult(nativeImage.createFromBuffer(largeEditorPng), 'capture')
      const largeResultReadyDeadline = Date.now() + 2_000
      while (Date.now() < largeResultReadyDeadline) {
        const ready = await mainWindow?.webContents.executeJavaScript("document.querySelector('.result-canvas img')?.naturalWidth === 2612")
        if (ready) break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      await mainWindow?.webContents.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('.result-toolbar button')].find((candidate) => candidate.textContent.includes('标注'))
        button?.click()
      })()`)
      const editorReadyDeadline = Date.now() + 2_000
      let editorInitialFit: Record<string, unknown> | null = null
      while (!editorInitialFit && Date.now() < editorReadyDeadline) {
        editorInitialFit = await mainWindow?.webContents.executeJavaScript(`(() => {
          const stage = document.querySelector('.editor-stage')
          const canvas = stage?.querySelector('canvas')
          if (!(stage instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement) || canvas.width !== 2612 || getComputedStyle(canvas).visibility !== 'visible') return null
          const stageRect = stage.getBoundingClientRect()
          const canvasRect = canvas.getBoundingClientRect()
          const style = getComputedStyle(stage)
          const availableWidth = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          const availableHeight = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
          return {
            sourceWidth: canvas.width,
            sourceHeight: canvas.height,
            renderedWidth: Math.round(canvasRect.width),
            renderedHeight: Math.round(canvasRect.height),
            availableWidth: Math.round(availableWidth),
            availableHeight: Math.round(availableHeight),
            horizontalOverflow: stage.scrollWidth > stage.clientWidth + 1,
            verticalOverflow: stage.scrollHeight > stage.clientHeight + 1,
            fullyVisible: canvasRect.width <= availableWidth + 1 && canvasRect.height <= availableHeight + 1,
          }
        })()`)
        if (!editorInitialFit) await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const editorInitialFitVerified = Boolean(editorInitialFit?.fullyVisible
        && !editorInitialFit?.horizontalOverflow
        && !editorInitialFit?.verticalOverflow)
      const editorDrawPoint = await mainWindow?.webContents.executeJavaScript(`(() => {
        const canvas = document.querySelector('.editor-stage canvas')
        if (!(canvas instanceof HTMLCanvasElement)) return null
        const rect = canvas.getBoundingClientRect()
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
      })()`) as { x: number; y: number } | null
      if (editorDrawPoint) {
        mainWindow?.webContents.sendInputEvent({ type: 'mouseMove', x: editorDrawPoint.x - 24, y: editorDrawPoint.y - 18 })
        mainWindow?.webContents.sendInputEvent({ type: 'mouseDown', x: editorDrawPoint.x - 24, y: editorDrawPoint.y - 18, button: 'left', clickCount: 1 })
        mainWindow?.webContents.sendInputEvent({ type: 'mouseMove', x: editorDrawPoint.x + 28, y: editorDrawPoint.y + 20, button: 'left' })
        mainWindow?.webContents.sendInputEvent({ type: 'mouseUp', x: editorDrawPoint.x + 28, y: editorDrawPoint.y + 20, button: 'left', clickCount: 1 })
      }
      await new Promise((resolve) => setTimeout(resolve, 80))
      const editorAnnotationVerified = Boolean(await mainWindow?.webContents.executeJavaScript("document.querySelector('.editor-title small')?.textContent.includes('1 个对象')"))
      await mainWindow?.webContents.executeJavaScript("document.querySelector('.editor-actions button')?.click()")
      reportE2eStage('editor-verified')

      const clickResultTool = (label: string) => mainWindow?.webContents.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('.result-toolbar button')].find((candidate) => candidate.textContent.includes(${JSON.stringify(label)}))
        if (!(button instanceof HTMLButtonElement)) return false
        button.click()
        return true
      })()`)
      const waitForPanelText = async (expected: string) => {
        const deadline = Date.now() + 2_000
        while (Date.now() < deadline) {
          const text = await mainWindow?.webContents.executeJavaScript("document.querySelector('.result-panel pre')?.textContent || ''")
          if (String(text).startsWith(expected)) return true
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        return false
      }
      await clickResultTool('AI 识图')
      const firstVisionShown = await waitForPanelText('E2E vision response 1')
      e2eCopiedText = ''
      const resultPanelUsability = await mainWindow?.webContents.executeJavaScript(`(() => {
        const panel = document.querySelector('.result-panel')
        const content = document.querySelector('.result-panel .panel-content')
        const footer = document.querySelector('.result-panel footer')
        const copy = document.querySelector('.result-panel .copy-result-button')
        if (!(panel instanceof HTMLElement) || !(content instanceof HTMLElement) || !(footer instanceof HTMLElement) || !(copy instanceof HTMLButtonElement)) return null
        const panelRect = panel.getBoundingClientRect()
        const footerRect = footer.getBoundingClientRect()
        const maxScroll = content.scrollHeight - content.clientHeight
        content.scrollTop = content.scrollHeight
        copy.click()
        return {
          scrollable: maxScroll > 40,
          scrolledToBottom: content.scrollTop >= maxScroll - 2,
          copyVisible: copy.offsetParent !== null,
          footerInsidePanel: footerRect.top >= panelRect.top && footerRect.bottom <= panelRect.bottom + 1,
          panelOverflow: getComputedStyle(panel).overflow,
          contentOverflowY: getComputedStyle(content).overflowY,
        }
      })()`)
      const copyResultDeadline = Date.now() + 1_000
      while (!e2eCopiedText.startsWith('E2E vision response 1') && Date.now() < copyResultDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const resultPanelUsabilityVerified = Boolean(resultPanelUsability?.scrollable
        && resultPanelUsability?.scrolledToBottom
        && resultPanelUsability?.copyVisible
        && resultPanelUsability?.footerInsidePanel
        && e2eCopiedText.startsWith('E2E vision response 1'))
      await clickResultTool('翻译')
      const translationShown = await waitForPanelText('E2E translate response 1')
      await clickResultTool('AI 识图')
      const cachedVisionShown = await waitForPanelText('E2E vision response 1')
      const visionCountAfterReturn = e2eAiRunCounts.vision
      const cachedIndicators = await mainWindow?.webContents.executeJavaScript(`(() => ({
        savedNote: document.querySelector('.cache-note.saved')?.textContent || '',
        toolbarBadges: document.querySelectorAll('.result-toolbar button.has-cache').length,
      }))()`)
      await mainWindow?.webContents.executeJavaScript("document.querySelector('.result-panel .rerun-button')?.click()")
      const rerunVisionShown = await waitForPanelText('E2E vision response 2')
      const resultToolCacheVerified = firstVisionShown
        && translationShown
        && cachedVisionShown
        && visionCountAfterReturn === 1
        && rerunVisionShown
        && e2eAiRunCounts.vision === 2
        && e2eAiRunCounts.translate === 1
        && cachedIndicators?.savedNote.includes('已保留')
        && cachedIndicators?.toolbarBadges === 2
      reportE2eStage('result-tools-verified')
      const titlebarDragRegions = await mainWindow?.webContents.executeJavaScript(`(() => {
        const brand = document.querySelector('.titlebar .brand')
        const navButton = document.querySelector('.titlebar nav button')
        const windowControls = document.querySelector('.window-controls')
        return {
          brandTag: brand?.tagName || '',
          brandRegion: brand ? getComputedStyle(brand).getPropertyValue('-webkit-app-region') : '',
          navButtonRegion: navButton ? getComputedStyle(navButton).getPropertyValue('-webkit-app-region') : '',
          controlsRegion: windowControls ? getComputedStyle(windowControls).getPropertyValue('-webkit-app-region') : '',
        }
      })()`)
      const titlebarDragRegionVerified = titlebarDragRegions?.brandTag === 'DIV'
        && titlebarDragRegions?.brandRegion === 'drag'
        && titlebarDragRegions?.navButtonRegion === 'no-drag'
        && titlebarDragRegions?.controlsRegion === 'no-drag'

      mainWindow?.hide()
      const pinId = await createPinWindow(nativeImage.createFromBuffer(syntheticPng).toDataURL())
      const pin = BrowserWindow.fromId(pinId)
      if (!pin) throw new Error('钉图窗口未创建。')
      await new Promise((resolve) => setTimeout(resolve, 120))
      const pinShownWithMainHidden = pin.isVisible()
      const pinPolicy = await inspectNativeWindow(pin)
      const pinExcludedFromTaskbar = process.platform !== 'win32'
        || Boolean((pinPolicy.exStyle & 0x80) || pinPolicy.owner)
      const pinRegions = await pin.webContents.executeJavaScript(`(() => {
        const windowRegion = getComputedStyle(document.querySelector('.pin-window')).getPropertyValue('-webkit-app-region')
        const tools = document.querySelector('.pin-tools')
        const toolsRegion = getComputedStyle(tools).getPropertyValue('-webkit-app-region')
        const image = document.querySelector('.pin-window img')
        const imageCursor = getComputedStyle(image).cursor
        const imageDraggable = image.draggable
        const rotate = [...tools.querySelectorAll('button')].find((button) => button.title === '旋转')
        rotate?.click()
        return { windowRegion, toolsRegion, imageCursor, imageDraggable }
      })()`)
      await new Promise((resolve) => setTimeout(resolve, 60))
      const pinRotationApplied = await pin.webContents.executeJavaScript("document.querySelector('.pin-window img')?.style.transform.includes('rotate(90deg)')")
      const pinToolbarInteractive = pinRegions.toolsRegion === 'no-drag'
        && pinRegions.imageCursor === 'move'
        && pinRegions.imageDraggable === false
        && pinRotationApplied
      const pinBoundsBeforeDrag = await inspectNativeWindow(pin)
      await pin.webContents.executeJavaScript(`(() => {
        const image = document.querySelector('.pin-window img')
        const pointerId = 41
        image.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId, screenX: 500, screenY: 500 }))
        image.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId, screenX: 564, screenY: 548 }))
        image.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId, screenX: 564, screenY: 548 }))
      })()`)
      await new Promise((resolve) => setTimeout(resolve, 100))
      const pinBoundsAfterDrag = await inspectNativeWindow(pin)
      const pinMoved = pinBoundsAfterDrag.left !== pinBoundsBeforeDrag.left || pinBoundsAfterDrag.top !== pinBoundsBeforeDrag.top
      await pin.webContents.executeJavaScript(`(() => {
        const passthrough = [...document.querySelectorAll('.pin-tools button')].find((button) => button.title.startsWith('鼠标穿透'))
        passthrough?.click()
      })()`)
      await new Promise((resolve) => setTimeout(resolve, 80))
      const passthroughPolicy = await inspectNativeWindow(pin)
      const toolbarPoint = await pin.webContents.executeJavaScript(`(() => {
        const tools = document.querySelector('.pin-tools').getBoundingClientRect()
        return { x: Math.round(tools.x + tools.width / 2), y: Math.round(tools.y + tools.height / 2) }
      })()`) as { x: number; y: number }
      pin.webContents.sendInputEvent({ type: 'mouseMove', x: toolbarPoint.x, y: toolbarPoint.y })
      await new Promise((resolve) => setTimeout(resolve, 120))
      const restoredPolicy = await inspectNativeWindow(pin)
      const pinInteractionRestored = process.platform !== 'win32'
        || Boolean((passthroughPolicy.exStyle & 0x20) && !(restoredPolicy.exStyle & 0x20))
      if (!pinInteractionRestored) pin.setIgnoreMouseEvents(false)
      await pin.webContents.executeJavaScript(`(() => {
        const close = [...document.querySelectorAll('.pin-tools button')].find((button) => button.title === '关闭')
        close?.click()
      })()`)
      await new Promise((resolve) => setTimeout(resolve, 100))
      const pinClosed = pin.isDestroyed()
      reportE2eStage('pin-verified')

      fs.writeFileSync(process.env.TA_E2E_SMOKE_FILE, JSON.stringify({
        ready: true,
        desktop: desktopSize,
        sample: sample.getSize(),
        sampleSha256: crypto.createHash('sha256').update(sample.toPNG()).digest('hex'),
        desktopStats,
        capturePixelWitnessSupported,
        ocrText: ocrResult.text,
        ocrConfidence: ocrResult.confidence,
        secureStorageAvailable,
        encryptionRoundTrip,
        overlayCount,
        overlayReadyCount,
        captureReadyMs,
        capturePreviewReadyMs,
        inputShieldReady,
        startupPointerSmoothness,
        pointerSmoothness,
        captureTiming,
        capturePreviewReady,
        captureExclusionVerified,
        captureWitnessPixelsVerified,
        captureSourceStats,
        captureCropStats,
        capturedImageContentVerified: !captureSourceStats.probablyBlack && !captureSourceStats.probablyTransparent
          && !captureCropStats.probablyBlack && !captureCropStats.probablyTransparent,
        persistedCaptureStats,
        capturedResultPersisted,
        greenWitnessPixels,
        unrelatedWindowStayedVisible,
        mainWindowHiddenByPolicy,
        mainWindowPixelExcluded,
        mainHideWitnessPixelsBefore,
        mainHideWitnessPixelsAfter,
        doubleClickConfirmed,
        autoCopiedCapture,
        quickCaptureBehaviorVerified,
        quickCaptureUi,
        quickCaptureSaved,
        quickCaptureCopied,
        quickCaptureDidNotOpenEditor,
        repeatCaptureReadyMs,
        repeatPreviewReadyMs,
        repeatCaptureTiming,
        repeatSourceStats,
        repeatGreenWitnessPixels,
        reuseCaptureStats,
        reuseGreenWitnessPixels,
        repeatedCaptureContentVerified: repeatSourceStats
          ? !repeatSourceStats.probablyBlack
            && !repeatSourceStats.probablyTransparent
            && reuseCaptureStats.every((stats) => !stats.probablyBlack && !stats.probablyTransparent)
            && (!capturePixelWitnessSupported || (repeatGreenWitnessPixels >= 250
              && reuseGreenWitnessPixels.every((count) => count >= 250)))
          : false,
        repeatSelectionCleared: repeatReady,
        overlayWindowBaseline,
        overlayWindowGrowth,
        historyRecoveredAfterEmpty,
        historyWasEmpty,
        historyCountAfterRecovery: store.listHistory().length,
        historyIdMatches: store.listHistory()[0]?.id === recoveredResult.id,
        resultRendered,
        resultToolCacheVerified,
        resultPanelUsabilityVerified,
        resultPanelUsability,
        editorInitialFitVerified,
        editorInitialFit,
        editorAnnotationVerified,
        titlebarDragRegionVerified,
        titlebarDragRegions,
        captureWindowPolicyUi,
        smartSelectionSettingUi,
        smartSelectionPreview,
        smartSelectionLocked,
        smartSelectionVerified,
        smartSelectionDisabledApplied,
        hotkeyRecorderUi,
        recordedHotkeyRegistered,
        homeCaptureHotkey,
        keepTaWindowStayedVisible,
        unrelatedWindowStayedVisibleWithTa,
        keepTaCaptureTiming,
        e2eAiRunCounts,
        cachedIndicators,
        pinToolbarInteractive,
        pinMoved,
        pinShownWithMainHidden,
        pinRegions,
        pinRotationApplied,
        pinInteractionRestored,
        pinClosed,
        pinExcludedFromTaskbar,
        pinPolicy,
        selectionSnapshots: { created, moved, resized },
        ...selectionInteraction,
        displayCount: screen.getAllDisplays().length,
        displays: screen.getAllDisplays().map((candidate) => ({
          id: candidate.id,
          bounds: candidate.bounds,
          scaleFactor: candidate.scaleFactor,
          label: candidate.label,
        })),
        hotkeyStatus,
      }))
    } catch (error) {
      fs.writeFileSync(process.env.TA_E2E_SMOKE_FILE, JSON.stringify({ ready: false, error: error instanceof Error ? error.stack ?? error.message : String(error) }))
    } finally {
      if (e2eWitness && !e2eWitness.isDestroyed()) e2eWitness.destroy()
      isQuitting = true
      stopWindowsCaptureHost()
      await Promise.race([ocr.terminate(), new Promise((resolve) => setTimeout(resolve, 2_000))])
      app.exit(0)
    }
  }
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
else {
  app.on('second-instance', () => void showRoute('home'))
  app.whenReady().then(bootstrap).catch((error) => {
    dialog.showErrorBox('拓 Ta 启动失败', error instanceof Error ? error.stack ?? error.message : String(error))
    app.quit()
  })
}

app.on('activate', () => void showRoute('home'))
app.on('before-quit', () => { isQuitting = true; globalShortcut.unregisterAll(); stopWindowsCaptureHost(); void ocr?.terminate() })
app.on('window-all-closed', () => { /* Windows 版常驻托盘 */ })
