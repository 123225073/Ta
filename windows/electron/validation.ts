import {
  AppSettings,
  CaptureAction,
  CaptureResult,
  CaptureWindowPolicy,
  ProviderKind,
  SelectionRect,
} from './contracts'

export const MAX_PNG_BYTES = 80 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 120_000_000
export const MAX_TEXT_LENGTH = 2_000_000

const captureActions = new Set<CaptureAction>(['capture', 'ocr', 'copy', 'pin', 'long', 'translate'])
const resultActions = new Set<CaptureResult['action']>([...captureActions, 'edited', 'beautified'])
const providerKinds = new Set<ProviderKind>(['openai', 'anthropic', 'gemini'])
const aiModes = new Set(['vision', 'translate', 'custom'])
const pinCommands = new Set(['close', 'opacity', 'passthrough', 'interactive', 'move-start', 'move', 'move-end'])
const captureWindowPolicies = new Set<CaptureWindowPolicy>(['hide-ta', 'keep-ta', 'ask'])
const historyIdPattern = /^\d{13}-[0-9a-f]{8}$/

function inputError(message: string): never {
  throw new Error(`输入无效：${message}`)
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) inputError(`${label}必须是对象。`)
  return value as Record<string, unknown>
}

function boundedString(value: unknown, label: string, maxLength: number, allowEmpty = false) {
  if (typeof value !== 'string') inputError(`${label}必须是文本。`)
  const result = value.trim()
  if (!allowEmpty && !result) inputError(`${label}不能为空。`)
  if (result.length > maxLength) inputError(`${label}过长。`)
  if (/[\u0000-\u001f\u007f]/.test(result)) inputError(`${label}包含控制字符。`)
  return result
}

function booleanValue(value: unknown, label: string) {
  if (typeof value !== 'boolean') inputError(`${label}必须是布尔值。`)
  return value
}

function integerInRange(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    inputError(`${label}必须在 ${minimum} 到 ${maximum} 之间。`)
  }
  return value as number
}

export function parseCaptureAction(value: unknown): CaptureAction {
  if (!captureActions.has(value as CaptureAction)) inputError('截图动作不受支持。')
  return value as CaptureAction
}

export function parseResultAction(value: unknown): CaptureResult['action'] {
  if (!resultActions.has(value as CaptureResult['action'])) inputError('图片动作不受支持。')
  return value as CaptureResult['action']
}

export function parseAiMode(value: unknown): 'vision' | 'translate' | 'custom' {
  if (!aiModes.has(value as string)) inputError('AI 操作不受支持。')
  return value as 'vision' | 'translate' | 'custom'
}

export function parsePinCommand(value: unknown): 'close' | 'opacity' | 'passthrough' | 'interactive' | 'move-start' | 'move' | 'move-end' {
  if (!pinCommands.has(value as string)) inputError('钉图命令不受支持。')
  return value as 'close' | 'opacity' | 'passthrough' | 'interactive' | 'move-start' | 'move' | 'move-end'
}

export function parsePinPoint(value: unknown) {
  const point = objectValue(value, '钉图拖动坐标')
  const x = Number(point.x)
  const y = Number(point.y)
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) inputError('钉图拖动坐标无效。')
  return { x, y }
}

export function parseSelectionRect(value: unknown, bounds: { width: number; height: number }): SelectionRect {
  const rect = objectValue(value, '截图区域')
  const numbers = ['x', 'y', 'width', 'height'].map((key) => Number(rect[key]))
  if (!numbers.every(Number.isFinite)) inputError('截图坐标必须是有限数字。')
  const [x, y, width, height] = numbers
  if (width < 2 || height < 2) inputError('截图区域过小。')
  if (x < 0 || y < 0 || x + width > bounds.width + 1 || y + height > bounds.height + 1) {
    inputError('截图区域超出当前显示器边界。')
  }
  return { x, y, width, height }
}

export function parsePngDataUrl(value: unknown): Buffer {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) inputError('图片必须是 PNG 数据。')
  const encoded = value.slice('data:image/png;base64,'.length)
  if (!encoded || encoded.length > Math.ceil(MAX_PNG_BYTES * 4 / 3) + 4) inputError('图片数据过大。')
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) inputError('图片 Base64 编码无效。')
  const buffer = Buffer.from(encoded, 'base64')
  if (!buffer.length || buffer.length > MAX_PNG_BYTES) inputError('图片数据大小无效。')
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) inputError('图片不是有效 PNG。')
  return buffer
}

export function parseText(value: unknown, label: string, maximum = MAX_TEXT_LENGTH, allowEmpty = true) {
  if (typeof value !== 'string') inputError(`${label}必须是文本。`)
  if (!allowEmpty && !value.trim()) inputError(`${label}不能为空。`)
  if (value.length > maximum) inputError(`${label}过长。`)
  return value
}

export function parseHistoryId(value: unknown) {
  if (typeof value !== 'string' || !historyIdPattern.test(value)) inputError('历史记录编号无效。')
  return value
}

export function isHistoryId(value: unknown): value is string {
  return typeof value === 'string' && historyIdPattern.test(value)
}

export function parseExternalUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) inputError('外部链接无效。')
  let url: URL
  try { url = new URL(value) } catch { return inputError('外部链接无效。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) inputError('只允许打开 HTTP 或 HTTPS 链接。')
  return url.toString()
}

function parseProviderUrl(value: unknown) {
  const normalized = parseExternalUrl(boundedString(value, '服务地址', 2048)).replace(/\/+$/, '')
  const url = new URL(normalized)
  if (url.search || url.hash) inputError('服务地址不能包含查询参数或片段。')
  return normalized
}

export type SettingsUpdate = AppSettings & { apiKeys?: Record<string, string>; clearApiKeys?: string[] }

export function parseSettingsUpdate(value: unknown): SettingsUpdate {
  const input = objectValue(value, '设置')
  if (!Array.isArray(input.providers) || input.providers.length < 1 || input.providers.length > 12) inputError('模型服务数量必须在 1 到 12 之间。')
  const seen = new Set<string>()
  const providers = input.providers.map((providerValue, index) => {
    const provider = objectValue(providerValue, `模型服务 ${index + 1}`)
    const id = boundedString(provider.id, '模型服务 ID', 64)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || seen.has(id)) inputError('模型服务 ID 格式无效或重复。')
    seen.add(id)
    if (!providerKinds.has(provider.kind as ProviderKind)) inputError('模型服务类型无效。')
    return {
      id,
      name: boundedString(provider.name, '模型服务名称', 80),
      kind: provider.kind as ProviderKind,
      baseUrl: parseProviderUrl(provider.baseUrl),
      model: boundedString(provider.model, '模型名称', 160),
      hasApiKey: typeof provider.hasApiKey === 'boolean' ? provider.hasApiKey : undefined,
    }
  })
  const activeProviderId = boundedString(input.activeProviderId, '当前模型服务 ID', 64)
  if (!seen.has(activeProviderId)) inputError('当前模型服务不存在。')
  const hotkeyInput = objectValue(input.hotkeys, '快捷键')
  const hotkeys = Object.fromEntries([...captureActions].map((action) => [action, boundedString(hotkeyInput[action], `${action} 快捷键`, 100, true)])) as AppSettings['hotkeys']
  if (!captureWindowPolicies.has(input.captureWindowPolicy as CaptureWindowPolicy)) inputError('截图窗口策略无效。')
  const settings: SettingsUpdate = {
    activeProviderId,
    providers,
    hotkeys,
    sourceLanguage: boundedString(input.sourceLanguage, '源语言', 80),
    targetLanguage: boundedString(input.targetLanguage, '目标语言', 80),
    autoLaunch: booleanValue(input.autoLaunch, '开机启动'),
    cloudUploadConfirmation: booleanValue(input.cloudUploadConfirmation, '云端上传确认'),
    longCaptureMaxFrames: integerInRange(input.longCaptureMaxFrames, '长截图帧数', 3, 30),
    longCaptureDelayMs: integerInRange(input.longCaptureDelayMs, '长截图间隔', 300, 2500),
    launchMinimized: booleanValue(input.launchMinimized, '最小化启动'),
    captureWindowPolicy: input.captureWindowPolicy as CaptureWindowPolicy,
    smartSelectionEnabled: booleanValue(input.smartSelectionEnabled, '自动识别窗口边框'),
  }
  if (input.apiKeys !== undefined) {
    const apiKeysInput = objectValue(input.apiKeys, 'API Key')
    settings.apiKeys = Object.fromEntries(Object.entries(apiKeysInput).map(([id, key]) => {
      if (!seen.has(id)) inputError('API Key 对应的模型服务不存在。')
      return [id, parseText(key, 'API Key', 16_384)]
    }))
  }
  if (input.clearApiKeys !== undefined) {
    if (!Array.isArray(input.clearApiKeys) || input.clearApiKeys.length > providers.length) inputError('待清除 API Key 列表无效。')
    settings.clearApiKeys = input.clearApiKeys.map((id) => {
      if (typeof id !== 'string' || !seen.has(id)) inputError('待清除 API Key 对应的模型服务不存在。')
      return id
    })
  }
  return settings
}
