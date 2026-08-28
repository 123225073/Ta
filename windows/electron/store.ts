import { app, nativeImage, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  AppSettings,
  CaptureAction,
  HistoryItem,
  PersistedSettings,
  ProviderProfile,
  defaultSettings,
} from './contracts'
import { isHistoryId, parseSettingsUpdate, SettingsUpdate } from './validation'

interface HistoryIndex {
  items: HistoryItem[]
}

function ensureDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true })
}

function cloneDefaults(): AppSettings {
  return JSON.parse(JSON.stringify(defaultSettings)) as AppSettings
}

export class TaStore {
  private readonly dataDirectory: string
  private readonly settingsPath: string
  private readonly historyDirectory: string
  private readonly historyIndexPath: string
  private settings: PersistedSettings
  private history: HistoryIndex

  constructor() {
    this.dataDirectory = app.getPath('userData')
    this.settingsPath = path.join(this.dataDirectory, 'settings.json')
    this.historyDirectory = path.join(this.dataDirectory, 'history')
    this.historyIndexPath = path.join(this.historyDirectory, 'index.json')
    ensureDirectory(this.dataDirectory)
    ensureDirectory(this.historyDirectory)
    this.settings = this.loadSettings()
    this.history = this.loadHistory()
  }

  private loadSettings(): PersistedSettings {
    const defaults = cloneDefaults()
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) as Partial<PersistedSettings>
      const providerMap = new Map(defaults.providers.map((provider) => [provider.id, provider]))
      for (const provider of parsed.providers ?? []) {
        providerMap.set(provider.id, { ...providerMap.get(provider.id), ...provider } as ProviderProfile)
      }
      const validated = parseSettingsUpdate({
        ...defaults,
        ...parsed,
        hotkeys: { ...defaults.hotkeys, ...parsed.hotkeys },
        providers: [...providerMap.values()],
      })
      const encryptedApiKeys = Object.fromEntries(Object.entries(parsed.encryptedApiKeys ?? {}).filter(([providerId, encrypted]) => (
        validated.providers.some((provider) => provider.id === providerId)
        && typeof encrypted === 'string'
        && encrypted.length <= 32_768
      )))
      return { ...validated, encryptedApiKeys }
    } catch {
      return { ...defaults, encryptedApiKeys: {} }
    }
  }

  private loadHistory(): HistoryIndex {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.historyIndexPath, 'utf8')) as HistoryIndex
      return { items: (parsed.items ?? []).filter((item) => {
        const filePath = this.safeHistoryFilePath(item.id, item.fileName)
        return Boolean(filePath && fs.existsSync(filePath))
      }) }
    } catch {
      return { items: [] }
    }
  }

  private safeHistoryFilePath(id: unknown, fileName: unknown): string | undefined {
    if (!isHistoryId(id) || fileName !== `${id}.png`) return undefined
    const filePath = path.resolve(this.historyDirectory, fileName)
    return path.dirname(filePath) === path.resolve(this.historyDirectory) ? filePath : undefined
  }

  private writeSettings() {
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8')
  }

  private writeHistory() {
    fs.writeFileSync(this.historyIndexPath, JSON.stringify(this.history, null, 2), 'utf8')
  }

  getSettings(): AppSettings {
    return {
      ...this.settings,
      providers: this.settings.providers.map((provider) => ({
        ...provider,
        hasApiKey: Boolean(this.settings.encryptedApiKeys[provider.id]),
      })),
      hotkeys: { ...this.settings.hotkeys },
    }
  }

  updateSettings(nextValue: SettingsUpdate): AppSettings {
    const next = parseSettingsUpdate(nextValue)
    const encryptedApiKeys = { ...this.settings.encryptedApiKeys }
    for (const [providerId, apiKey] of Object.entries(next.apiKeys ?? {})) {
      if (!apiKey.trim()) continue
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Windows 安全凭据加密暂不可用，请重新登录 Windows 后再保存 API Key。')
      }
      encryptedApiKeys[providerId] = safeStorage.encryptString(apiKey.trim()).toString('base64')
    }
    for (const providerId of next.clearApiKeys ?? []) delete encryptedApiKeys[providerId]

    const { apiKeys: _apiKeys, clearApiKeys: _clearApiKeys, ...publicSettings } = next
    this.settings = {
      ...this.settings,
      ...publicSettings,
      providers: publicSettings.providers.map(({ hasApiKey: _hasApiKey, ...provider }) => provider),
      encryptedApiKeys,
    }
    this.writeSettings()
    return this.getSettings()
  }

  getApiKey(providerId: string): string {
    const encrypted = this.settings.encryptedApiKeys[providerId]
    if (!encrypted) return ''
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return ''
    }
  }

  getActiveProvider(): { profile: ProviderProfile; apiKey: string } {
    const profile = this.settings.providers.find((item) => item.id === this.settings.activeProviderId)
    if (!profile) throw new Error('没有找到当前 AI 服务配置。')
    const apiKey = this.getApiKey(profile.id)
    if (!apiKey) throw new Error(`请先在“模型设置”中填写 ${profile.name} 的 API Key。`)
    return { profile, apiKey }
  }

  addHistory(png: Buffer, width: number, height: number, action: CaptureAction | 'edited' | 'beautified'): HistoryItem {
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const fileName = `${id}.png`
    fs.writeFileSync(path.join(this.historyDirectory, fileName), png)
    const item: HistoryItem = {
      id,
      createdAt: new Date().toISOString(),
      width,
      height,
      action,
      fileName,
    }
    this.history.items.unshift(item)
    const removed = this.history.items.splice(40)
    for (const oldItem of removed) {
      const filePath = this.safeHistoryFilePath(oldItem.id, oldItem.fileName)
      if (filePath) try { fs.unlinkSync(filePath) } catch { /* already gone */ }
    }
    this.writeHistory()
    return item
  }

  listHistory(): HistoryItem[] {
    return this.history.items.map((item) => ({ ...item, thumbnailUrl: `ta-media://image/${item.id}` }))
  }

  getHistoryFile(id: string): string | undefined {
    const item = this.history.items.find((candidate) => candidate.id === id)
    if (!item) return undefined
    const filePath = this.safeHistoryFilePath(item.id, item.fileName)
    if (!filePath) return undefined
    return fs.existsSync(filePath) ? filePath : undefined
  }

  getHistoryImage(id: string) {
    const filePath = this.getHistoryFile(id)
    return filePath ? nativeImage.createFromPath(filePath) : undefined
  }

  deleteHistory(id: string): boolean {
    const index = this.history.items.findIndex((item) => item.id === id)
    if (index < 0) return false
    const [item] = this.history.items.splice(index, 1)
    const filePath = this.safeHistoryFilePath(item.id, item.fileName)
    if (filePath) try { fs.unlinkSync(filePath) } catch { /* already gone */ }
    this.writeHistory()
    return true
  }
}
