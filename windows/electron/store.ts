import { app, nativeImage, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import {
  AssetSource,
  AppSettings,
  CaptureAction,
  HistoryItem,
  LibraryListQuery,
  LibraryListResult,
  LibraryStats,
  PersistedSettings,
  ProviderProfile,
  defaultSettings,
} from './contracts'
import { MAX_IMAGE_PIXELS, parseSettingsUpdate, SettingsUpdate } from './validation'
import { AssetLibrary, type LibraryAsset, type LibraryAssetAction, type LibraryAssetSource, type LibrarySourceApp } from './library'

function ensureDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true })
}

function cloneDefaults(): AppSettings {
  return JSON.parse(JSON.stringify(defaultSettings)) as AppSettings
}

export class TaStore {
  private readonly dataDirectory: string
  private readonly settingsPath: string
  private readonly legacyHistoryDirectory: string
  private readonly thumbnailDirectory: string
  private settings: PersistedSettings
  private readonly library: AssetLibrary
  private storageMigration: Promise<void> = Promise.resolve()
  private readonly thumbnailJobs = new Map<string, Promise<string | undefined>>()
  private activeThumbnailJobs = 0
  private readonly thumbnailWaiters: Array<() => void> = []

  constructor() {
    this.dataDirectory = app.getPath('userData')
    this.settingsPath = path.join(this.dataDirectory, 'settings.json')
    this.legacyHistoryDirectory = path.join(this.dataDirectory, 'history')
    this.thumbnailDirectory = path.join(this.dataDirectory, 'library', 'thumbnails')
    ensureDirectory(this.dataDirectory)
    ensureDirectory(this.thumbnailDirectory)
    this.settings = this.loadSettings()
    const requestedRoot = this.settings.storageRoot.trim() || path.join(app.getPath('pictures'), '拓 Ta')
    this.library = new AssetLibrary({
      metadataDirectory: path.join(this.dataDirectory, 'library'),
      rootDirectory: requestedRoot,
      legacyHistoryDirectory: this.legacyHistoryDirectory,
    })
    this.cleanupThumbnailDirectory()
    const actualRoot = this.library.getRootDirectory()
    if (this.settings.storageRoot !== actualRoot) {
      this.settings.storageRoot = actualRoot
      this.writeSettings()
    }
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
        externalCapture: {
          ...defaults.externalCapture,
          ...parsed.externalCapture,
          apps: {
            ...defaults.externalCapture.apps,
            ...parsed.externalCapture?.apps,
          },
        },
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

  private writeSettings() {
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8')
  }

  private toHistoryItem(asset: LibraryAsset): HistoryItem {
    const source: AssetSource = asset.source === 'legacy' ? 'ta-capture' : asset.source
    const action = ['paste', 'import'].includes(asset.action) ? 'capture' : asset.action as HistoryItem['action']
    return { ...asset, action, source, thumbnailUrl: `ta-media://thumbnail/${asset.id}` }
  }

  private thumbnailPath(id: string) {
    return path.join(this.thumbnailDirectory, `${id}.png`)
  }

  private cleanupThumbnailDirectory() {
    for (const entry of fs.readdirSync(this.thumbnailDirectory, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const isTemporary = entry.name.startsWith('.') && entry.name.endsWith('.tmp')
      const id = entry.name.endsWith('.png') ? entry.name.slice(0, -4) : ''
      if (!isTemporary && (!id || this.library.get(id))) continue
      try { fs.unlinkSync(path.join(this.thumbnailDirectory, entry.name)) } catch { /* best effort */ }
    }
  }

  private async withThumbnailSlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.activeThumbnailJobs >= 2) await new Promise<void>((resolve) => this.thumbnailWaiters.push(resolve))
    this.activeThumbnailJobs += 1
    try {
      return await work()
    } finally {
      this.activeThumbnailJobs -= 1
      this.thumbnailWaiters.shift()?.()
    }
  }

  private ensureThumbnail(asset: LibraryAsset): Promise<string | undefined> {
    const target = this.thumbnailPath(asset.id)
    if (fs.existsSync(target)) return Promise.resolve(target)
    const existing = this.thumbnailJobs.get(asset.id)
    if (existing) return existing
    const job = this.withThumbnailSlot(async () => {
      const sourcePath = this.library.open(asset.id)
      if (!sourcePath) return undefined
      const temporary = path.join(this.thumbnailDirectory, `.${asset.id}.${crypto.randomBytes(4).toString('hex')}.tmp`)
      try {
        await sharp(sourcePath, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false })
          .rotate()
          .resize({ width: 480, height: 320, fit: 'inside', withoutEnlargement: true })
          .png({ compressionLevel: 9 })
          .toFile(temporary)
        if (!this.library.get(asset.id)) {
          try { fs.unlinkSync(temporary) } catch { /* deleted while thumbnail was rendering */ }
          return undefined
        }
        try { fs.renameSync(temporary, target) } catch (error) {
          try { fs.unlinkSync(temporary) } catch { /* another request may have created it */ }
          if (!fs.existsSync(target)) throw error
        }
        return target
      } catch {
        try { await fs.promises.unlink(temporary) } catch { /* best effort */ }
        return undefined
      }
    }).finally(() => this.thumbnailJobs.delete(asset.id))
    this.thumbnailJobs.set(asset.id, job)
    return job
  }

  async waitForStorageReady(): Promise<void> {
    await this.storageMigration
  }

  private async migrateStorageRoot(rootDirectory: string): Promise<void> {
    const run = this.storageMigration.then(async () => {
      await this.library.changeStorageRootAsync(rootDirectory, { removeOldAfterSuccess: false })
    })
    this.storageMigration = run.catch(() => undefined)
    await run
  }

  getSettings(): AppSettings {
    return {
      ...this.settings,
      providers: this.settings.providers.map((provider) => ({
        ...provider,
        hasApiKey: Boolean(this.settings.encryptedApiKeys[provider.id]),
      })),
      hotkeys: { ...this.settings.hotkeys },
      externalCapture: {
        enabled: this.settings.externalCapture.enabled,
        apps: Object.fromEntries(Object.entries(this.settings.externalCapture.apps).map(([appId, rule]) => [appId, { ...rule }])) as AppSettings['externalCapture']['apps'],
      },
    }
  }

  async updateSettings(nextValue: SettingsUpdate): Promise<AppSettings> {
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

    const requestedRoot = next.storageRoot.trim() || this.library.getRootDirectory()
    if (path.resolve(requestedRoot) !== path.resolve(this.library.getRootDirectory())) {
      await this.migrateStorageRoot(requestedRoot)
    }
    const { apiKeys: _apiKeys, clearApiKeys: _clearApiKeys, ...publicSettings } = next
    this.settings = {
      ...this.settings,
      ...publicSettings,
      storageRoot: this.library.getRootDirectory(),
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

  addHistory(
    png: Buffer,
    width: number,
    height: number,
    action: CaptureAction | 'edited' | 'beautified',
    source: AssetSource = action === 'edited' ? 'edited' : action === 'beautified' ? 'beautified' : 'ta-capture',
    title?: string,
    dedupe: 'none' | 'short-term' | 'global' = 'none',
    createdAt?: Date | string,
    sourceApp?: LibrarySourceApp,
  ): { item: HistoryItem; created: boolean } {
    const result = this.library.addPng({
      png,
      width,
      height,
      action: action as LibraryAssetAction,
      source: source as LibraryAssetSource,
      title,
      dedupe,
      createdAt,
      sourceApp,
    })
    return { item: this.toHistoryItem(result.asset), created: result.created }
  }

  listHistory(): HistoryItem[] {
    return this.library.list({ limit: 50 }).items.map((item) => this.toHistoryItem(item))
  }

  listAssets(query: LibraryListQuery = {}): LibraryListResult {
    const result = this.library.list(query as Parameters<AssetLibrary['list']>[0])
    return {
      items: result.items.map((item) => this.toHistoryItem(item)),
      nextCursor: result.nextCursor,
      totalCount: this.library.count(query as Parameters<AssetLibrary['count']>[0]),
    }
  }

  getLibraryStats(): LibraryStats {
    const stats = this.library.stats()
    return {
      ...stats,
      freeBytes: stats.freeBytes ?? 0,
      legacyMigration: this.library.lastLegacyMigration
        ? { ...this.library.lastLegacyMigration, errors: [...this.library.lastLegacyMigration.errors] }
        : undefined,
    }
  }

  retryLegacyMigration() {
    return this.library.retryLegacyMigration()
  }

  renameAsset(id: string, title: string): HistoryItem | undefined {
    const item = this.library.rename(id, title)
    return item ? this.toHistoryItem(item) : undefined
  }

  exportAssets(ids: string[], destinationDirectory: string) {
    return this.library.batchExportAsync(ids, destinationDirectory)
  }

  getHistoryFile(id: string): string | undefined {
    return this.library.open(id)
  }

  getHistoryItem(id: string): HistoryItem | undefined {
    const asset = this.library.get(id)
    return asset ? this.toHistoryItem(asset) : undefined
  }

  getThumbnailFile(id: string): Promise<string | undefined> {
    const asset = this.library.get(id)
    return asset ? this.ensureThumbnail(asset) : Promise.resolve(undefined)
  }

  getHistoryImage(id: string) {
    const filePath = this.getHistoryFile(id)
    return filePath ? nativeImage.createFromPath(filePath) : undefined
  }

  deleteHistory(id: string): boolean {
    const deleted = this.library.delete(id)
    if (deleted) try { fs.unlinkSync(this.thumbnailPath(id)) } catch { /* thumbnail may not exist */ }
    return deleted
  }

  close() {
    this.library.close()
  }
}
