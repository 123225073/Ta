import { describe, expect, it } from 'vitest'
import { defaultSettings } from './contracts'
import {
  MAX_PNG_BYTES,
  parseCaptureAction,
  parseExternalUrl,
  parseLibraryListQuery,
  parseHistoryId,
  parseImageContextMenuRequest,
  parsePinCommand,
  parsePinPoint,
  parsePngDataUrl,
  parseSelectionRect,
  parseSettingsUpdate,
} from './validation'

const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('untrusted input validation', () => {
  it('accepts supported capture actions and rejects forged actions', () => {
    expect(parseCaptureAction('capture')).toBe('capture')
    expect(() => parseCaptureAction('../../run')).toThrow(/不受支持/)
  })

  it('rejects NaN, infinity and out-of-bounds selections', () => {
    expect(() => parseSelectionRect({ x: Number.NaN, y: 0, width: 20, height: 20 }, { width: 100, height: 100 })).toThrow(/有限数字/)
    expect(() => parseSelectionRect({ x: 90, y: 0, width: 20, height: 20 }, { width: 100, height: 100 })).toThrow(/超出/)
    expect(parseSelectionRect({ x: 1, y: 2, width: 30, height: 40 }, { width: 100, height: 100 })).toEqual({ x: 1, y: 2, width: 30, height: 40 })
  })

  it('accepts a real PNG and rejects fake or oversized image input before decoding', () => {
    expect(parsePngDataUrl(onePixelPng).subarray(1, 4).toString()).toBe('PNG')
    expect(() => parsePngDataUrl('data:image/png;base64,AAAA')).toThrow(/有效 PNG/)
    expect(() => parsePngDataUrl(`data:image/png;base64,${'A'.repeat(Math.ceil(MAX_PNG_BYTES * 4 / 3) + 8)}`)).toThrow(/过大/)
  })

  it('only opens credential-free HTTP(S) URLs', () => {
    expect(parseExternalUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(() => parseExternalUrl('file:///C:/Windows/System32/calc.exe')).toThrow(/HTTP/)
    expect(() => parseExternalUrl('custom-scheme://launch')).toThrow(/HTTP/)
    expect(() => parseExternalUrl('https://user:password@example.com')).toThrow(/HTTP/)
  })

  it('rejects traversal-like history IDs', () => {
    expect(parseHistoryId('1756300000000-12ab34cd')).toBe('1756300000000-12ab34cd')
    expect(parseHistoryId('1756300000000-12ab34cd56ef7890')).toBe('1756300000000-12ab34cd56ef7890')
    expect(() => parseHistoryId('../../settings')).toThrow(/编号无效/)
  })

  it('validates every supported image context-menu source', () => {
    expect(parseImageContextMenuRequest({ kind: 'history', historyId: '1756300000000-12ab34cd', suggestedName: '项目截图' })).toEqual({ kind: 'history', historyId: '1756300000000-12ab34cd', suggestedName: '项目截图' })
    expect(parseImageContextMenuRequest({ kind: 'data-url', imageDataUrl: onePixelPng })).toEqual({ kind: 'data-url', imageDataUrl: onePixelPng })
    expect(parseImageContextMenuRequest({ kind: 'pin' })).toEqual({ kind: 'pin' })
    expect(() => parseImageContextMenuRequest({ kind: 'history', historyId: '../../settings' })).toThrow(/编号无效/)
    expect(() => parseImageContextMenuRequest({ kind: 'data-url', imageDataUrl: 'file:///C:/secret.png' })).toThrow(/PNG/)
    expect(() => parseImageContextMenuRequest({ kind: 'filesystem', path: 'C:\\secret.png' })).toThrow(/来源不受支持/)
  })

  it('allows the pin window to leave click-through mode but rejects forged commands', () => {
    expect(parsePinCommand('interactive')).toBe('interactive')
    expect(parsePinCommand('move-start')).toBe('move-start')
    expect(parsePinPoint({ x: -120, y: 240 })).toEqual({ x: -120, y: 240 })
    expect(() => parsePinPoint({ x: Number.POSITIVE_INFINITY, y: 0 })).toThrow(/坐标无效/)
    expect(() => parsePinCommand('destroy-all')).toThrow(/不受支持/)
  })

  it('validates settings at the IPC trust boundary', () => {
    expect(parseSettingsUpdate(defaultSettings).longCaptureMaxFrames).toBe(12)
    expect(parseSettingsUpdate({ ...defaultSettings, theme: 'light' }).theme).toBe('light')
    expect(parseSettingsUpdate({ ...defaultSettings, captureWindowPolicy: 'keep-ta' } as typeof defaultSettings).captureWindowPolicy).toBe('keep-ta')
    expect(parseSettingsUpdate({ ...defaultSettings, smartSelectionEnabled: false }).smartSelectionEnabled).toBe(false)
    expect(parseSettingsUpdate({ ...defaultSettings, externalCapture: { ...defaultSettings.externalCapture, enabled: true, apps: { ...defaultSettings.externalCapture.apps, feishu: { enabled: true, mode: 'strict' } } } }).externalCapture.apps.feishu.enabled).toBe(true)
    expect(parseSettingsUpdate({ ...defaultSettings, externalCapture: { ...defaultSettings.externalCapture, apps: { ...defaultSettings.externalCapture.apps, feishu: { enabled: true, mode: 'all-images' } } } } as unknown as typeof defaultSettings).externalCapture.apps.feishu.mode).toBe('strict')
    expect(defaultSettings.providers.find((provider) => provider.id === 'fengsha-cpa')).toMatchObject({ baseUrl: 'https://cpa.fengsha.online/v1', model: 'gpt-5.5' })
    expect(() => parseSettingsUpdate({ ...defaultSettings, longCaptureMaxFrames: 100_000 })).toThrow(/3 到 30/)
    expect(() => parseSettingsUpdate({ ...defaultSettings, captureWindowPolicy: 'hide-everything' } as unknown as typeof defaultSettings)).toThrow(/截图窗口策略/)
    expect(() => parseSettingsUpdate({ ...defaultSettings, smartSelectionEnabled: 'yes' } as unknown as typeof defaultSettings)).toThrow(/布尔值/)
    expect(() => parseSettingsUpdate({ ...defaultSettings, theme: 'sepia' } as unknown as typeof defaultSettings)).toThrow(/界面主题/)
    expect(() => parseSettingsUpdate({ ...defaultSettings, externalCapture: { ...defaultSettings.externalCapture, apps: { ...defaultSettings.externalCapture.apps, feishu: { enabled: true, mode: 'guess' } } } } as unknown as typeof defaultSettings)).toThrow(/模式无效/)
    expect(() => parseSettingsUpdate({ ...defaultSettings, providers: [{ ...defaultSettings.providers[0], baseUrl: 'file:///tmp/key' }] })).toThrow(/HTTP/)
    expect(() => parseSettingsUpdate({ ...defaultSettings, providers: [{ ...defaultSettings.providers[0], baseUrl: 'https://user:pass@example.com' }] })).toThrow(/HTTP/)
  })

  it('validates library filters including real calendar dates', () => {
    expect(parseLibraryListQuery({ limit: 60, search: ' 项目 ', date: '2026-08-28' })).toEqual({ limit: 60, search: '项目', date: '2026-08-28' })
    expect(() => parseLibraryListQuery({ date: '2026-02-31' })).toThrow(/日期格式无效/)
    expect(() => parseLibraryListQuery({ source: 'remote-cloud' })).toThrow(/来源无效/)
  })
})
