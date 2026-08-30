export type ExternalScreenshotApp = 'feishu' | 'weixin' | 'qq'
export type ClipboardSourceApp = ExternalScreenshotApp | 'ta' | 'unknown'
export type ClipboardImportMode = 'strict'
export type ClipboardSourceConfidence = 'high' | 'none'

export interface ClipboardSourceEvent {
  sequence: number
  stable: boolean
  ownerPid: number | null
  executablePath: string | null
  product: string | null
  company: string | null
  signer: string | null
  signatureStatus: string | null
  signerSubject: string | null
  signerThumbprint: string | null
  formats: string[]
  imagePresent: boolean
  captureIntentApp?: ExternalScreenshotApp | null
}

export interface ClipboardAppRuleSettings {
  enabled: boolean
  mode: ClipboardImportMode
}

export interface ClipboardSourceSettings {
  enabled: boolean
  apps: Record<ExternalScreenshotApp, ClipboardAppRuleSettings>
}

export type ClipboardSourceReason =
  | 'global-disabled'
  | 'invalid-event'
  | 'unstable-snapshot'
  | 'image-missing'
  | 'source-missing'
  | 'self-source'
  | 'unsupported-source'
  | 'identity-mismatch'
  | 'invalid-signature'
  | 'app-disabled'
  | 'screenshot-marker-missing'
  | 'matched-strict-screenshot'

export interface ClipboardSourceDecision {
  action: 'auto-import' | 'ignore'
  reason: ClipboardSourceReason
  sourceApp: ClipboardSourceApp
  confidence: ClipboardSourceConfidence
}

export const DEFAULT_CLIPBOARD_SOURCE_SETTINGS: ClipboardSourceSettings = {
  enabled: false,
  apps: {
    feishu: { enabled: false, mode: 'strict' },
    weixin: { enabled: false, mode: 'strict' },
    qq: { enabled: false, mode: 'strict' },
  },
}

interface ApplicationIdentityRule {
  processNames: readonly string[]
  dedicatedCapturePathPatterns?: readonly RegExp[]
  productPatterns: readonly RegExp[]
  companyPatterns: readonly RegExp[]
  signerPatterns: readonly RegExp[]
  signerSubjectPatterns: readonly RegExp[]
  screenshotFormats: readonly string[]
}

const APPLICATION_RULES: Record<ExternalScreenshotApp, ApplicationIdentityRule> = {
  feishu: {
    processNames: ['feishu.exe'],
    productPatterns: [/\bfeishu\b/i],
    companyPatterns: [/beijing\s+feishu\s+technology/i, /\bfeishu\b/i],
    signerPatterns: [/^beijing\s+feishu\s+technology\s+co\.,?\s*ltd\.?$/i],
    signerSubjectPatterns: [/\bCN\s*=\s*"?beijing\s+feishu\s+technology\s+co\.,?\s*ltd\.?/i],
    screenshotFormats: [],
  },
  weixin: {
    processNames: ['weixin.exe', 'wechat.exe'],
    productPatterns: [/\bweixin\b/i, /\bwechat\b/i, /微信/i],
    companyPatterns: [/\btencent\b/i, /腾讯/i],
    signerPatterns: [/^tencent\s+technology\s*\(shenzhen\)\s+company\s+limited$/i],
    signerSubjectPatterns: [/\bCN\s*=\s*"?tencent\s+technology\s*\(shenzhen\)\s+company\s+limited/i],
    screenshotFormats: ['WeChatScreenshotFormat'],
  },
  qq: {
    // Exact basenames intentionally exclude QQBrowser.exe and browser helper processes.
    processNames: ['qq.exe', 'qqnt.exe', 'qqscreenshot.exe'],
    dedicatedCapturePathPatterns: [
      /\\tencent\\qqnt\\versions\\[^\\]+\\resources\\app\\qqscreenshot\\binrelease-(?:x64|x86)\\qqscreenshot\.exe$/i,
    ],
    productPatterns: [/^qq$/i, /^tencent\s+qq$/i, /^qq\s+nt$/i],
    companyPatterns: [/\btencent\b/i, /腾讯/i],
    signerPatterns: [/^tencent\s+technology\s*\(shenzhen\)\s+company\s+limited$/i],
    signerSubjectPatterns: [/\bCN\s*=\s*"?tencent\s+technology\s*\(shenzhen\)\s+company\s+limited/i],
    screenshotFormats: [],
  },
}

function normalize(value: string | null | undefined) {
  return value?.trim() ?? ''
}

function processBasename(executablePath: string) {
  return executablePath.replace(/\//g, '\\').split('\\').pop()?.toLowerCase() ?? ''
}

function isAbsoluteWindowsPath(executablePath: string) {
  return /^[a-z]:\\/i.test(executablePath.replace(/\//g, '\\')) || executablePath.startsWith('\\\\')
}

function matchesAny(value: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(value))
}

function isSignatureValid(status: string | null | undefined) {
  return /^(valid|trusted)$/i.test(normalize(status))
}

function isTaIdentity(event: ClipboardSourceEvent, basename: string) {
  const product = normalize(event.product)
  const company = normalize(event.company)
  if (/^(?:拓(?:\s*ta)?|ta\s+windows)$/i.test(product)) return true
  if (/\bta\s+contributors\b/i.test(company)) return true
  return ['拓 ta.exe', '拓.exe', 'ta.exe', 'ta-windows.exe'].includes(basename)
}

function identifyCandidate(event: ClipboardSourceEvent): ClipboardSourceApp {
  const executablePath = normalize(event.executablePath)
  if (!executablePath || !isAbsoluteWindowsPath(executablePath)) return 'unknown'
  const basename = processBasename(executablePath)
  if (isTaIdentity(event, basename)) return 'ta'
  if (basename === 'feishu.exe') return 'feishu'
  if (basename === 'weixin.exe' || basename === 'wechat.exe') return 'weixin'
  if (basename === 'qq.exe' || basename === 'qqnt.exe' || basename === 'qqscreenshot.exe') return 'qq'
  return 'unknown'
}

function isDedicatedCaptureProcess(event: ClipboardSourceEvent, app: ExternalScreenshotApp) {
  const executablePath = normalize(event.executablePath).replace(/\//g, '\\')
  return APPLICATION_RULES[app].dedicatedCapturePathPatterns?.some((pattern) => pattern.test(executablePath)) ?? false
}

function hasCompleteIdentity(event: ClipboardSourceEvent, app: ExternalScreenshotApp) {
  const executablePath = normalize(event.executablePath)
  const product = normalize(event.product)
  const company = normalize(event.company)
  const signer = normalize(event.signer)
  const signerSubject = normalize(event.signerSubject)
  const signerThumbprint = normalize(event.signerThumbprint)
  if (!executablePath || !signer || !signerSubject || !/^[a-f0-9]{40,128}$/i.test(signerThumbprint)) return false

  const rule = APPLICATION_RULES[app]
  const signedProcessMatches = (
    isAbsoluteWindowsPath(executablePath) &&
    rule.processNames.includes(processBasename(executablePath)) &&
    matchesAny(signer, rule.signerPatterns) &&
    matchesAny(signerSubject, rule.signerSubjectPatterns)
  )
  if (!signedProcessMatches) return false
  if (isDedicatedCaptureProcess(event, app)) return true
  return Boolean(product && company && matchesAny(product, rule.productPatterns) && matchesAny(company, rule.companyPatterns))
}

function hasScreenshotMarker(event: ClipboardSourceEvent, app: ExternalScreenshotApp) {
  if (isDedicatedCaptureProcess(event, app)) return true
  // Only Feishu's native default-hotkey flow currently produces a verified
  // capture intent. Never let a generic app hint turn an ordinary QQ/Weixin
  // copy into a strict screenshot event.
  if (app === 'feishu' && event.captureIntentApp === 'feishu') return true
  const actualFormats = new Set(event.formats.map((format) => normalize(format).toLowerCase()).filter(Boolean))
  return APPLICATION_RULES[app].screenshotFormats.some((format) => actualFormats.has(format.toLowerCase()))
}

function ignore(reason: ClipboardSourceReason, sourceApp: ClipboardSourceApp): ClipboardSourceDecision {
  return { action: 'ignore', reason, sourceApp, confidence: 'none' }
}

/**
 * Classifies clipboard metadata before Electron reads any image bytes.
 *
 * The classifier fails closed: an absent owner, incomplete identity, invalid
 * signature, disabled source, or missing screenshot marker can never import.
 */
export function classifyClipboardSource(
  event: ClipboardSourceEvent,
  settings: ClipboardSourceSettings,
): ClipboardSourceDecision {
  if (!settings.enabled) return ignore('global-disabled', 'unknown')
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0 || !Array.isArray(event.formats)) {
    return ignore('invalid-event', 'unknown')
  }
  if (!event.stable) return ignore('unstable-snapshot', 'unknown')
  if (!event.imagePresent) return ignore('image-missing', 'unknown')
  if (!Number.isSafeInteger(event.ownerPid) || (event.ownerPid ?? 0) <= 0 || !normalize(event.executablePath)) {
    return ignore('source-missing', 'unknown')
  }

  const sourceApp = identifyCandidate(event)
  if (sourceApp === 'ta') return ignore('self-source', sourceApp)
  if (sourceApp === 'unknown') return ignore('unsupported-source', sourceApp)
  if (!hasCompleteIdentity(event, sourceApp)) return ignore('identity-mismatch', sourceApp)
  if (!isSignatureValid(event.signatureStatus)) return ignore('invalid-signature', sourceApp)

  const appSettings = settings.apps[sourceApp]
  if (!appSettings?.enabled) return ignore('app-disabled', sourceApp)
  if (appSettings.mode !== 'strict') {
    return ignore('invalid-event', sourceApp)
  }
  if (!hasScreenshotMarker(event, sourceApp)) {
    return ignore('screenshot-marker-missing', sourceApp)
  }
  return {
    action: 'auto-import',
    reason: 'matched-strict-screenshot',
    sourceApp,
    confidence: 'high',
  }
}
