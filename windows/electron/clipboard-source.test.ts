import { describe, expect, it } from 'vitest'
import {
  classifyClipboardSource,
  type ClipboardSourceEvent,
  type ClipboardSourceSettings,
  type ExternalScreenshotApp,
} from './clipboard-source'

const strictSettings = (enabledApp: ExternalScreenshotApp): ClipboardSourceSettings => ({
  enabled: true,
  apps: {
    feishu: { enabled: enabledApp === 'feishu', mode: 'strict' },
    weixin: { enabled: enabledApp === 'weixin', mode: 'strict' },
    qq: { enabled: enabledApp === 'qq', mode: 'strict' },
  },
})

const event = (overrides: Partial<ClipboardSourceEvent> = {}): ClipboardSourceEvent => ({
  sequence: 2893,
  stable: true,
  ownerPid: 2580,
  executablePath: 'D:\\Program Files\\Tencent\\Weixin\\Weixin.exe',
  product: 'Weixin',
  company: 'Tencent',
  signer: 'Tencent Technology (Shenzhen) Company Limited',
  signatureStatus: 'Valid',
  signerSubject: 'CN=Tencent Technology (Shenzhen) Company Limited, O=Tencent Technology (Shenzhen) Company Limited, C=CN',
  signerThumbprint: '534A38126BA11897D69F565E298FF91899A72560',
  formats: ['CF_DIB', 'image/png', 'WeChatScreenshotFormat'],
  imagePresent: true,
  captureIntentApp: null,
  ...overrides,
})

describe('clipboard source classifier', () => {
  it('requires the global switch and application whitelist', () => {
    const disabled = strictSettings('weixin')
    disabled.enabled = false
    expect(classifyClipboardSource(event(), disabled)).toMatchObject({
      action: 'ignore',
      reason: 'global-disabled',
    })

    expect(classifyClipboardSource(event(), strictSettings('feishu'))).toMatchObject({
      action: 'ignore',
      reason: 'app-disabled',
      sourceApp: 'weixin',
    })
  })

  it('fails closed when metadata was not captured from one stable clipboard snapshot', () => {
    expect(classifyClipboardSource(event({ stable: false }), strictSettings('weixin'))).toMatchObject({
      action: 'ignore',
      reason: 'unstable-snapshot',
    })
  })

  it('accepts a verified Weixin screenshot carrying its dedicated marker', () => {
    expect(
      classifyClipboardSource(event({ formats: ['CF_DIBV5', 'WeChatScreenshotFormat'] }), strictSettings('weixin')),
    ).toEqual({
      action: 'auto-import',
      reason: 'matched-strict-screenshot',
      sourceApp: 'weixin',
      confidence: 'high',
    })
  })

  it('accepts a verified Feishu image correlated with the observed default screenshot shortcut', () => {
    expect(
      classifyClipboardSource(
        event({
          executablePath: 'D:\\5000_Software\\飞书\\Feishu\\app\\Feishu.exe',
          product: 'Feishu',
          company: 'Beijing Feishu Technology Co., Ltd.',
          signer: 'Beijing Feishu Technology Co.,Ltd.',
          signerSubject: 'CN=Beijing Feishu Technology Co.,Ltd., O=Beijing Feishu Technology Co., Ltd., C=CN',
          formats: ['image/png'],
          captureIntentApp: 'feishu',
        }),
        strictSettings('feishu'),
      ),
    ).toMatchObject({ action: 'auto-import', sourceApp: 'feishu', confidence: 'high' })
  })

  it('rejects ordinary copying from the QQ main process and does not confuse QQBrowser with QQ', () => {
    const qqEvent = event({
      executablePath: 'C:\\Program Files\\Tencent\\QQNT\\QQ.exe',
      product: 'QQ',
      company: 'Tencent Technology (Shenzhen) Company Limited',
      signer: 'Tencent Technology (Shenzhen) Company Limited',
      formats: ['CF_DIB', 'image/png'],
    })
    expect(classifyClipboardSource(qqEvent, strictSettings('qq'))).toMatchObject({
      action: 'ignore',
      reason: 'screenshot-marker-missing',
      sourceApp: 'qq',
    })
    expect(
      classifyClipboardSource(
        { ...qqEvent, executablePath: 'C:\\Program Files\\Tencent\\QQBrowser\\QQBrowser.exe', product: 'QQBrowser' },
        strictSettings('qq'),
      ),
    ).toMatchObject({ action: 'ignore', reason: 'unsupported-source', sourceApp: 'unknown' })
  })

  it('does not let a QQ hotkey hint bypass the dedicated screenshot helper rule', () => {
    const qqEvent = event({
      executablePath: 'C:\\Program Files\\Tencent\\QQNT\\QQ.exe',
      product: 'QQ',
      company: 'Tencent Technology (Shenzhen) Company Limited',
      signer: 'Tencent Technology (Shenzhen) Company Limited',
      formats: ['CF_DIB', 'image/png'],
      captureIntentApp: 'qq',
    })

    expect(classifyClipboardSource(qqEvent, strictSettings('qq'))).toMatchObject({
      action: 'ignore',
      reason: 'screenshot-marker-missing',
      sourceApp: 'qq',
    })
  })

  it('accepts the signed QQ dedicated screenshot helper without relying on a guessed clipboard marker', () => {
    const helperEvent = event({
      executablePath: 'C:\\Program Files\\Tencent\\QQNT\\versions\\9.9.31-49738\\resources\\app\\QQScreenShot\\BinRelease-x64\\QQScreenshot.exe',
      product: null,
      company: null,
      signer: 'Tencent Technology (Shenzhen) Company Limited',
      formats: ['CF_DIBV5', 'image/png'],
    })
    expect(classifyClipboardSource(helperEvent, strictSettings('qq'))).toEqual({
      action: 'auto-import',
      reason: 'matched-strict-screenshot',
      sourceApp: 'qq',
      confidence: 'high',
    })
    expect(
      classifyClipboardSource(
        { ...helperEvent, executablePath: 'C:\\Temp\\QQScreenshot.exe' },
        strictSettings('qq'),
      ),
    ).toMatchObject({ action: 'ignore', reason: 'identity-mismatch', sourceApp: 'qq' })
  })

  it('rejects ordinary browsers even if an image is present', () => {
    expect(
      classifyClipboardSource(
        event({
          ownerPid: 991,
          executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          product: 'Google Chrome',
          company: 'Google LLC',
          signer: 'Google LLC',
          formats: ['image/png'],
        }),
        strictSettings('weixin'),
      ),
    ).toMatchObject({ action: 'ignore', reason: 'unsupported-source', sourceApp: 'unknown' })
  })

  it('rejects an ordinary image copied inside the same app in strict mode', () => {
    expect(classifyClipboardSource(event({ formats: ['CF_DIB', 'image/png'] }), strictSettings('weixin'))).toMatchObject({
      action: 'ignore',
      reason: 'screenshot-marker-missing',
      sourceApp: 'weixin',
    })
  })

  it('rejects a generic capture-status format that is not app-specific', () => {
    expect(
      classifyClipboardSource(event({ formats: ['CF_DIB', 'image/png', 'application/x-capturer-status'] }), strictSettings('weixin')),
    ).toMatchObject({
      action: 'ignore',
      reason: 'screenshot-marker-missing',
      sourceApp: 'weixin',
    })
  })

  it('fails closed if an obsolete all-images mode reaches the classifier', () => {
    const settings = strictSettings('weixin')
    settings.apps.weixin.mode = 'all-images' as 'strict'
    expect(classifyClipboardSource(event({ formats: ['image/png'] }), settings)).toEqual({
      action: 'ignore',
      reason: 'invalid-event',
      sourceApp: 'weixin',
      confidence: 'none',
    })
  })

  it('fails closed if persisted settings contain an unknown mode', () => {
    const settings = strictSettings('weixin')
    settings.apps.weixin.mode = 'unexpected' as 'strict'
    expect(classifyClipboardSource(event(), settings)).toMatchObject({
      action: 'ignore',
      reason: 'invalid-event',
      sourceApp: 'weixin',
    })
  })

  it.each([
    ['C:\\Program Files\\Ta\\拓 Ta.exe', '拓 Ta', 'Ta contributors'],
    ['C:\\Program Files\\Ta\\ta-windows.exe', 'Ta Windows', 'Ta contributors'],
  ])('always excludes Ta itself (%s)', (executablePath, product, company) => {
    expect(
      classifyClipboardSource(event({ executablePath, product, company, signer: null }), strictSettings('weixin')),
    ).toMatchObject({ action: 'ignore', reason: 'self-source', sourceApp: 'ta' })
  })

  it.each(['Invalid', 'NotSigned', 'Unknown', null])('rejects an abnormal signature status: %s', (signatureStatus) => {
    expect(classifyClipboardSource(event({ signatureStatus }), strictSettings('weixin'))).toMatchObject({
      action: 'ignore',
      reason: 'invalid-signature',
      sourceApp: 'weixin',
    })
  })

  it('fails closed when owner metadata is missing or the path is not absolute', () => {
    expect(classifyClipboardSource(event({ ownerPid: null }), strictSettings('weixin'))).toMatchObject({
      action: 'ignore',
      reason: 'source-missing',
    })
    expect(classifyClipboardSource(event({ executablePath: 'Weixin.exe' }), strictSettings('weixin'))).toMatchObject({
      action: 'ignore',
      reason: 'unsupported-source',
    })
  })

  it('rejects incomplete or inconsistent publisher identity', () => {
    expect(classifyClipboardSource(event({ product: 'QQBrowser' }), strictSettings('weixin'))).toMatchObject({
      action: 'ignore',
      reason: 'identity-mismatch',
      sourceApp: 'weixin',
    })
    expect(classifyClipboardSource(event({ signer: 'Unknown Publisher' }), strictSettings('weixin'))).toMatchObject({
      action: 'ignore',
      reason: 'identity-mismatch',
      sourceApp: 'weixin',
    })
    expect(classifyClipboardSource(event({ signerSubject: 'CN=Unknown Publisher', signerThumbprint: '0'.repeat(40) }), strictSettings('weixin'))).toMatchObject({
      action: 'ignore',
      reason: 'identity-mismatch',
      sourceApp: 'weixin',
    })
    expect(classifyClipboardSource(event({ signerThumbprint: 'not-a-thumbprint' }), strictSettings('weixin'))).toMatchObject({
      action: 'ignore',
      reason: 'identity-mismatch',
      sourceApp: 'weixin',
    })
  })

  it('rejects events without image content before any source can be imported', () => {
    expect(classifyClipboardSource(event({ imagePresent: false }), strictSettings('weixin'))).toMatchObject({
      action: 'ignore',
      reason: 'image-missing',
    })
  })
})
