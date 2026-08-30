import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type LibraryAssetAction =
  | 'capture'
  | 'ocr'
  | 'copy'
  | 'pin'
  | 'long'
  | 'translate'
  | 'edited'
  | 'beautified'
  | 'paste'
  | 'import'

export type LibraryAssetSource =
  | 'ta-capture'
  | 'external-capture'
  | 'paste'
  | 'import'
  | 'edited'
  | 'beautified'
  | 'legacy'

export type LibrarySourceApp = 'feishu' | 'weixin' | 'qq'

export interface LibraryAsset {
  id: string
  createdAt: string
  dateKey: string
  width: number
  height: number
  action: LibraryAssetAction
  source: LibraryAssetSource
  sourceApp?: LibrarySourceApp
  title: string
  fileName: string
  relativePath: string
  contentHash: string
}

export interface AssetLibraryOptions {
  metadataDirectory: string
  rootDirectory: string
  legacyHistoryDirectory?: string
  now?: () => Date
}

export interface AddPngInput {
  png: Buffer
  width: number
  height: number
  action: LibraryAssetAction
  source: LibraryAssetSource
  sourceApp?: LibrarySourceApp
  title?: string
  createdAt?: Date | string
  dedupe?: 'none' | 'short-term' | 'global'
}

export interface AddPngResult {
  asset: LibraryAsset
  created: boolean
  duplicateOf?: string
}

export interface ListAssetsOptions {
  limit?: number
  cursor?: string
  search?: string
  date?: string
  source?: LibraryAssetSource
}

export interface ListAssetsResult {
  items: LibraryAsset[]
  nextCursor?: string
}

export type CountAssetsOptions = Pick<ListAssetsOptions, 'search' | 'date' | 'source'>

export interface BatchExportResult {
  exported: Array<{ id: string; filePath: string }>
  missingIds: string[]
}

export interface LibraryStats {
  count: number
  totalBytes: number
  rootDirectory: string
  freeBytes?: number
}

export interface ChangeStorageRootOptions {
  removeOldAfterSuccess?: boolean
}

export interface ChangeStorageRootResult {
  rootDirectory: string
  copied: number
  reused: number
  oldFilesRemoved: number
}

export interface LegacyMigrationResult {
  imported: number
  skipped: number
  failed: number
  errors: string[]
}

interface AssetRow {
  id: string
  created_at: string
  created_at_ms: number
  date_key: string
  width: number
  height: number
  action: LibraryAssetAction
  source: LibraryAssetSource
  source_app: LibrarySourceApp | null
  title: string
  file_name: string
  relative_path: string
  content_hash: string
  file_size: number
}

interface CursorValue {
  createdAtMs: number
  id: string
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SHORT_TERM_DEDUPE_MS = 10_000
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200
const MAX_TITLE_LENGTH = 120
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function ensureDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true })
}

function hashBuffer(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash('sha256')
  const descriptor = fs.openSync(filePath, 'r')
  const chunk = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead = 0
    do {
      bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null)
      if (bytesRead > 0) hash.update(chunk.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}

async function hashFileAsync(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function safeResolve(rootDirectory: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error('图片路径无效。')
  }
  const root = path.resolve(rootDirectory)
  const candidate = path.resolve(root, relativePath.replaceAll('/', path.sep))
  const relation = path.relative(root, candidate)
  if (!relation || relation.startsWith(`..${path.sep}`) || relation === '..' || path.isAbsolute(relation)) {
    throw new Error('图片路径超出素材库根目录。')
  }
  return candidate
}

function sanitizeTitle(value: string | undefined, fallback: string): string {
  const sanitized = (value ?? '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+/g, '')
    .replace(/[. ]+$/g, '')
    .slice(0, MAX_TITLE_LENGTH)
    .trim()
  if (!sanitized || sanitized === '.' || sanitized === '..' || WINDOWS_RESERVED_NAME.test(sanitized)) {
    return fallback
  }
  return sanitized
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function localTimeKey(date: Date): string {
  return `${localDateKey(date)}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

function relativeDateDirectory(date: Date): string {
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
}

function sourceTitlePrefix(source: LibraryAssetSource): string {
  switch (source) {
    case 'ta-capture': return '拓截图'
    case 'external-capture': return '外部截图'
    case 'paste': return '粘贴图片'
    case 'import': return '导入图片'
    case 'edited': return '编辑图片'
    case 'beautified': return '美化图片'
    case 'legacy': return '历史截图'
  }
}

function normalizeDate(value: Date | string | undefined, fallback: Date): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : value ? new Date(value) : new Date(fallback.getTime())
  if (!Number.isFinite(date.getTime())) throw new Error('图片时间无效。')
  return date
}

function toAsset(row: AssetRow): LibraryAsset {
  return {
    id: row.id,
    createdAt: row.created_at,
    dateKey: row.date_key,
    width: row.width,
    height: row.height,
    action: row.action,
    source: row.source,
    sourceApp: row.source_app ?? undefined,
    title: row.title,
    fileName: row.file_name,
    relativePath: row.relative_path,
    contentHash: row.content_hash,
  }
}

function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(value: string): CursorValue {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CursorValue>
    if (typeof parsed.createdAtMs !== 'number' || !Number.isSafeInteger(parsed.createdAtMs) || typeof parsed.id !== 'string' || !parsed.id) throw new Error()
    return { createdAtMs: parsed.createdAtMs, id: parsed.id }
  } catch {
    throw new Error('分页位置无效，请重新加载素材库。')
  }
}

function isSameOrNested(first: string, second: string): boolean {
  const relation = path.relative(first, second)
  return !relation || (!relation.startsWith(`..${path.sep}`) && relation !== '..' && !path.isAbsolute(relation))
}

function writeFileAtomically(filePath: string, bytes: Buffer): void {
  ensureDirectory(path.dirname(filePath))
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`)
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600)
    fs.writeFileSync(descriptor, bytes)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(temporaryPath, filePath)
  } catch (error) {
    if (descriptor !== undefined) try { fs.closeSync(descriptor) } catch { /* best effort */ }
    try { fs.unlinkSync(temporaryPath) } catch { /* best effort */ }
    throw error
  }
}

function copyFileVerified(sourcePath: string, destinationPath: string, expectedHash: string): 'copied' | 'reused' {
  if (fs.existsSync(destinationPath)) {
    if (hashFile(destinationPath) !== expectedHash) {
      throw new Error(`新位置已存在同名但内容不同的文件：${destinationPath}`)
    }
    return 'reused'
  }
  ensureDirectory(path.dirname(destinationPath))
  const temporaryPath = path.join(path.dirname(destinationPath), `.${path.basename(destinationPath)}.${crypto.randomBytes(6).toString('hex')}.migrating`)
  try {
    fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL)
    if (hashFile(temporaryPath) !== expectedHash) throw new Error(`复制后的图片校验失败：${sourcePath}`)
    fs.renameSync(temporaryPath, destinationPath)
    return 'copied'
  } catch (error) {
    try { fs.unlinkSync(temporaryPath) } catch { /* best effort */ }
    throw error
  }
}

async function copyFileVerifiedAsync(sourcePath: string, destinationPath: string, expectedHash: string): Promise<'copied' | 'reused'> {
  ensureDirectory(path.dirname(destinationPath))
  if (fs.existsSync(destinationPath)) {
    if (await hashFileAsync(destinationPath) !== expectedHash) throw new Error(`目标位置已有不同内容：${destinationPath}`)
    return 'reused'
  }
  const temporaryPath = path.join(path.dirname(destinationPath), `.${path.basename(destinationPath)}.${crypto.randomBytes(6).toString('hex')}.tmp`)
  try {
    await fs.promises.copyFile(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL)
    if (await hashFileAsync(temporaryPath) !== expectedHash) throw new Error(`复制后的图片校验失败：${sourcePath}`)
    await fs.promises.rename(temporaryPath, destinationPath)
    return 'copied'
  } catch (error) {
    try { await fs.promises.unlink(temporaryPath) } catch { /* best effort */ }
    throw error
  }
}

export class AssetLibrary {
  private readonly database: DatabaseSync
  private readonly databasePath: string
  private readonly metadataDirectory: string
  private readonly now: () => Date
  private rootDirectory: string
  private legacyHistoryDirectory?: string
  private rootMigrationActive = false
  lastLegacyMigration?: LegacyMigrationResult

  constructor(options: AssetLibraryOptions) {
    if (!options.metadataDirectory.trim()) throw new Error('素材库元数据目录不能为空。')
    if (!options.rootDirectory.trim()) throw new Error('素材库保存目录不能为空。')
    this.metadataDirectory = path.resolve(options.metadataDirectory)
    this.now = options.now ?? (() => new Date())
    ensureDirectory(this.metadataDirectory)
    this.databasePath = path.join(this.metadataDirectory, 'library.sqlite')
    this.database = new DatabaseSync(this.databasePath)
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.createSchema()
    const configuredRoot = this.getSetting('storage_root')
    this.rootDirectory = path.resolve(configuredRoot || options.rootDirectory)
    ensureDirectory(this.rootDirectory)
    if (!configuredRoot) this.setSetting('storage_root', this.rootDirectory)
    if (options.legacyHistoryDirectory) {
      this.legacyHistoryDirectory = path.resolve(options.legacyHistoryDirectory)
      this.lastLegacyMigration = this.migrateLegacyHistory(this.legacyHistoryDirectory)
    }
  }

  private assertMutationAllowed(): void {
    if (this.rootMigrationActive) throw new Error('素材保存位置正在迁移，请稍候重试。')
  }

  private createSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        date_key TEXT NOT NULL,
        width INTEGER NOT NULL CHECK(width > 0),
        height INTEGER NOT NULL CHECK(height > 0),
        action TEXT NOT NULL,
        source TEXT NOT NULL,
        source_app TEXT,
        title TEXT NOT NULL,
        file_name TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        content_hash TEXT NOT NULL,
        file_size INTEGER NOT NULL CHECK(file_size >= 0)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS assets_created_idx ON assets(created_at_ms DESC, id DESC);
      CREATE INDEX IF NOT EXISTS assets_date_idx ON assets(date_key, created_at_ms DESC, id DESC);
      CREATE INDEX IF NOT EXISTS assets_hash_idx ON assets(content_hash, created_at_ms DESC);
      CREATE INDEX IF NOT EXISTS assets_source_idx ON assets(source, created_at_ms DESC, id DESC);
      CREATE INDEX IF NOT EXISTS assets_title_idx ON assets(title COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS legacy_migrations (
        migration_key TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        migrated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS legacy_tombstones (
        migration_key TEXT PRIMARY KEY,
        deleted_at TEXT NOT NULL
      ) STRICT;
    `)
    const assetColumns = this.database.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>
    if (!assetColumns.some((column) => column.name === 'source_app')) {
      this.database.exec('ALTER TABLE assets ADD COLUMN source_app TEXT')
    }
  }

  private getSetting(key: string): string | undefined {
    const row = this.database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

  private setSetting(key: string, value: string): void {
    this.database.prepare(`
      INSERT INTO settings(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  private rowById(id: string): AssetRow | undefined {
    if (!id || id.length > 200) return undefined
    return this.database.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined
  }

  close(): void {
    this.database.close()
  }

  getRootDirectory(): string {
    return this.rootDirectory
  }

  addPng(input: AddPngInput): AddPngResult {
    this.assertMutationAllowed()
    if (!Buffer.isBuffer(input.png) || input.png.length < PNG_SIGNATURE.length || !input.png.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new Error('只能将有效的 PNG 图片加入素材库。')
    }
    if (!Number.isSafeInteger(input.width) || input.width <= 0 || !Number.isSafeInteger(input.height) || input.height <= 0) {
      throw new Error('图片尺寸无效。')
    }
    const createdDate = normalizeDate(input.createdAt, this.now())
    const createdAtMs = createdDate.getTime()
    const createdAt = createdDate.toISOString()
    const contentHash = hashBuffer(input.png)
    const sourceApp = input.sourceApp
    if (sourceApp && !['feishu', 'weixin', 'qq'].includes(sourceApp)) throw new Error('外部截图来源无效。')
    if (sourceApp && input.source !== 'external-capture') throw new Error('只有外部截图可以记录来源软件。')
    const dedupe = input.dedupe ?? 'short-term'
    if (dedupe !== 'none') {
      const minimumTime = dedupe === 'global' ? 0 : createdAtMs - SHORT_TERM_DEDUPE_MS
      const duplicate = this.database.prepare(`
        SELECT * FROM assets
        WHERE content_hash = ? AND created_at_ms >= ?
        ORDER BY created_at_ms DESC, id DESC LIMIT 1
      `).get(contentHash, minimumTime) as AssetRow | undefined
      if (duplicate) return { asset: toAsset(duplicate), created: false, duplicateOf: duplicate.id }
    }

    const id = `${createdAtMs}-${crypto.randomBytes(8).toString('hex')}`
    const fallbackTitle = `${sourceTitlePrefix(input.source)}_${localTimeKey(createdDate)}`
    const title = sanitizeTitle(input.title, fallbackTitle)
    const fileName = `${title}_${id.slice(-8)}.png`
    const relativePath = `${relativeDateDirectory(createdDate)}/${fileName}`
    const filePath = safeResolve(this.rootDirectory, relativePath)
    writeFileAtomically(filePath, input.png)
    try {
      this.database.prepare(`
        INSERT INTO assets(
          id, created_at, created_at_ms, date_key, width, height, action, source,
          source_app, title, file_name, relative_path, content_hash, file_size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, createdAt, createdAtMs, localDateKey(createdDate), input.width, input.height,
        input.action, input.source, sourceApp ?? null, title, fileName, relativePath, contentHash, input.png.length,
      )
    } catch (error) {
      try { fs.unlinkSync(filePath) } catch { /* best effort */ }
      throw error
    }
    const asset = this.get(id)
    if (!asset) throw new Error('图片已写入，但无法读取素材索引。')
    return { asset, created: true }
  }

  list(options: ListAssetsOptions = {}): ListAssetsResult {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new Error(`每页数量必须在 1 到 ${MAX_PAGE_SIZE} 之间。`)
    }
    if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error('日期必须使用 YYYY-MM-DD 格式。')
    const clauses: string[] = []
    const parameters: Array<string | number> = []
    if (options.search?.trim()) {
      const escaped = options.search.trim().replace(/[\\%_]/g, '\\$&')
      clauses.push(`title LIKE ? ESCAPE '\\' COLLATE NOCASE`)
      parameters.push(`%${escaped}%`)
    }
    if (options.date) {
      clauses.push('date_key = ?')
      parameters.push(options.date)
    }
    if (options.source) {
      clauses.push('source = ?')
      parameters.push(options.source)
    }
    if (options.cursor) {
      const cursor = decodeCursor(options.cursor)
      clauses.push('(created_at_ms < ? OR (created_at_ms = ? AND id < ?))')
      parameters.push(cursor.createdAtMs, cursor.createdAtMs, cursor.id)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.database.prepare(`
      SELECT * FROM assets ${where}
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `).all(...parameters, limit + 1) as unknown as AssetRow[]
    const hasNextPage = rows.length > limit
    const page = hasNextPage ? rows.slice(0, limit) : rows
    const last = page.at(-1)
    return {
      items: page.map(toAsset),
      nextCursor: hasNextPage && last ? encodeCursor({ createdAtMs: last.created_at_ms, id: last.id }) : undefined,
    }
  }

  count(options: CountAssetsOptions = {}): number {
    if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error('日期必须使用 YYYY-MM-DD 格式。')
    const clauses: string[] = []
    const parameters: string[] = []
    if (options.search?.trim()) {
      const escaped = options.search.trim().replace(/[\\%_]/g, '\\$&')
      clauses.push(`title LIKE ? ESCAPE '\\' COLLATE NOCASE`)
      parameters.push(`%${escaped}%`)
    }
    if (options.date) {
      clauses.push('date_key = ?')
      parameters.push(options.date)
    }
    if (options.source) {
      clauses.push('source = ?')
      parameters.push(options.source)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM assets ${where}`)
      .get(...parameters) as { count: number }
    return Number(row.count)
  }

  get(id: string): LibraryAsset | undefined {
    const row = this.rowById(id)
    return row ? toAsset(row) : undefined
  }

  open(id: string): string | undefined {
    const row = this.rowById(id)
    if (!row) return undefined
    let filePath: string
    try {
      filePath = safeResolve(this.rootDirectory, row.relative_path)
    } catch {
      return undefined
    }
    return fs.existsSync(filePath) ? filePath : undefined
  }

  rename(id: string, nextTitle: string): LibraryAsset | undefined {
    this.assertMutationAllowed()
    const row = this.rowById(id)
    if (!row) return undefined
    const title = sanitizeTitle(nextTitle, '')
    if (!title) throw new Error('图片名称不能为空或 Windows 保留名称。')
    if (title === row.title) return toAsset(row)
    const oldPath = safeResolve(this.rootDirectory, row.relative_path)
    const directory = path.posix.dirname(row.relative_path)
    const fileName = `${title}_${id.slice(-8)}.png`
    const relativePath = `${directory}/${fileName}`
    const nextPath = safeResolve(this.rootDirectory, relativePath)
    if (fs.existsSync(nextPath)) throw new Error('新图片名称已被占用。')
    fs.renameSync(oldPath, nextPath)
    try {
      this.database.prepare('UPDATE assets SET title = ?, file_name = ?, relative_path = ? WHERE id = ?')
        .run(title, fileName, relativePath, id)
    } catch (error) {
      try { fs.renameSync(nextPath, oldPath) } catch { /* preserve original error */ }
      throw error
    }
    return this.get(id)
  }

  /**
   * Permanently removes the local original. The UI/main-process caller must
   * obtain explicit user confirmation before calling this method. The file is
   * staged first so a database failure can restore the original path.
   */
  delete(id: string): boolean {
    this.assertMutationAllowed()
    const row = this.rowById(id)
    if (!row) return false
    const filePath = safeResolve(this.rootDirectory, row.relative_path)
    if (!fs.existsSync(filePath)) {
      this.database.exec('BEGIN IMMEDIATE')
      try {
        this.database.prepare(`
          INSERT OR IGNORE INTO legacy_tombstones(migration_key, deleted_at)
          SELECT migration_key, ? FROM legacy_migrations WHERE asset_id = ?
        `).run(this.now().toISOString(), id)
        this.database.prepare('DELETE FROM assets WHERE id = ?').run(id)
        this.database.exec('COMMIT')
      } catch (error) {
        try { this.database.exec('ROLLBACK') } catch { /* best effort */ }
        throw error
      }
      return true
    }
    const stagedPath = path.join(path.dirname(filePath), `.${row.file_name}.${crypto.randomBytes(6).toString('hex')}.deleting`)
    fs.renameSync(filePath, stagedPath)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        INSERT OR IGNORE INTO legacy_tombstones(migration_key, deleted_at)
        SELECT migration_key, ? FROM legacy_migrations WHERE asset_id = ?
      `).run(this.now().toISOString(), id)
      this.database.prepare('DELETE FROM assets WHERE id = ?').run(id)
      this.database.exec('COMMIT')
    } catch (error) {
      try { this.database.exec('ROLLBACK') } catch { /* best effort */ }
      try { fs.renameSync(stagedPath, filePath) } catch { /* preserve original error */ }
      throw error
    }
    try { fs.unlinkSync(stagedPath) } catch { /* hidden staged file can be cleaned safely later */ }
    return true
  }

  batchExport(ids: string[], destinationDirectory: string): BatchExportResult {
    if (!destinationDirectory.trim()) throw new Error('导出目录不能为空。')
    const destinationRoot = path.resolve(destinationDirectory)
    ensureDirectory(destinationRoot)
    const exported: BatchExportResult['exported'] = []
    const missingIds: string[] = []
    for (const id of [...new Set(ids)]) {
      const row = this.rowById(id)
      const sourcePath = row ? this.open(id) : undefined
      if (!row || !sourcePath) {
        missingIds.push(id)
        continue
      }
      const baseName = sanitizeTitle(row.title, '图片')
      let destinationPath = path.join(destinationRoot, `${baseName}.png`)
      let suffix = 1
      while (fs.existsSync(destinationPath)) {
        suffix += 1
        destinationPath = path.join(destinationRoot, `${baseName} (${suffix}).png`)
      }
      fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL)
      exported.push({ id, filePath: destinationPath })
    }
    return { exported, missingIds }
  }

  async batchExportAsync(ids: string[], destinationDirectory: string): Promise<BatchExportResult> {
    if (!destinationDirectory.trim()) throw new Error('导出目录不能为空。')
    const destinationRoot = path.resolve(destinationDirectory)
    ensureDirectory(destinationRoot)
    const exported: BatchExportResult['exported'] = []
    const missingIds: string[] = []
    for (const id of [...new Set(ids)]) {
      const row = this.rowById(id)
      const sourcePath = row ? this.open(id) : undefined
      if (!row || !sourcePath) {
        missingIds.push(id)
        continue
      }
      const baseName = sanitizeTitle(row.title, '图片')
      let suffix = 1
      while (true) {
        const displaySuffix = suffix === 1 ? '' : ` (${suffix})`
        const destinationPath = path.join(destinationRoot, `${baseName}${displaySuffix}.png`)
        try {
          await fs.promises.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL)
          exported.push({ id, filePath: destinationPath })
          break
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            suffix += 1
            continue
          }
          throw error
        }
      }
    }
    return { exported, missingIds }
  }

  stats(): LibraryStats {
    const row = this.database.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(file_size), 0) AS total_bytes FROM assets')
      .get() as { count: number; total_bytes: number }
    let freeBytes: number | undefined
    try {
      const fileSystem = fs.statfsSync(this.rootDirectory)
      freeBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize)
    } catch { /* unavailable on some file systems */ }
    return {
      count: Number(row.count),
      totalBytes: Number(row.total_bytes),
      rootDirectory: this.rootDirectory,
      freeBytes,
    }
  }

  changeStorageRoot(nextRootDirectory: string, options: ChangeStorageRootOptions = {}): ChangeStorageRootResult {
    if (!nextRootDirectory.trim()) throw new Error('新的保存目录不能为空。')
    if (this.rootMigrationActive) throw new Error('素材保存位置正在迁移。')
    const oldRoot = this.rootDirectory
    const nextRoot = path.resolve(nextRootDirectory)
    if (nextRoot === oldRoot) return { rootDirectory: oldRoot, copied: 0, reused: 0, oldFilesRemoved: 0 }
    if (isSameOrNested(oldRoot, nextRoot) || isSameOrNested(nextRoot, oldRoot)) {
      throw new Error('新旧保存目录不能互相包含。')
    }
    ensureDirectory(nextRoot)
    const createdPaths: string[] = []
    let copied = 0
    let reused = 0
    try {
      let cursorMs = Number.MAX_SAFE_INTEGER
      let cursorId = '\uffff'
      while (true) {
        const rows = this.database.prepare(`
          SELECT * FROM assets
          WHERE created_at_ms < ? OR (created_at_ms = ? AND id < ?)
          ORDER BY created_at_ms DESC, id DESC LIMIT 250
        `).all(cursorMs, cursorMs, cursorId) as unknown as AssetRow[]
        if (!rows.length) break
        for (const row of rows) {
          const sourcePath = safeResolve(oldRoot, row.relative_path)
          if (!fs.existsSync(sourcePath)) throw new Error(`原图不存在：${sourcePath}`)
          if (hashFile(sourcePath) !== row.content_hash) throw new Error(`原图内容校验失败：${sourcePath}`)
          const destinationPath = safeResolve(nextRoot, row.relative_path)
          const result = copyFileVerified(sourcePath, destinationPath, row.content_hash)
          if (result === 'copied') {
            copied += 1
            createdPaths.push(destinationPath)
          } else {
            reused += 1
          }
        }
        const last = rows.at(-1)!
        cursorMs = last.created_at_ms
        cursorId = last.id
      }
      this.database.exec('BEGIN IMMEDIATE')
      try {
        this.setSetting('storage_root', nextRoot)
        this.database.exec('COMMIT')
      } catch (error) {
        try { this.database.exec('ROLLBACK') } catch { /* best effort */ }
        throw error
      }
      this.rootDirectory = nextRoot
    } catch (error) {
      for (const createdPath of createdPaths.reverse()) try { fs.unlinkSync(createdPath) } catch { /* best effort */ }
      throw error
    }

    let oldFilesRemoved = 0
    if (options.removeOldAfterSuccess) {
      let cursorMs = Number.MAX_SAFE_INTEGER
      let cursorId = '\uffff'
      while (true) {
        const rows = this.database.prepare(`
          SELECT * FROM assets
          WHERE created_at_ms < ? OR (created_at_ms = ? AND id < ?)
          ORDER BY created_at_ms DESC, id DESC LIMIT 250
        `).all(cursorMs, cursorMs, cursorId) as unknown as AssetRow[]
        if (!rows.length) break
        for (const row of rows) {
          try {
            fs.unlinkSync(safeResolve(oldRoot, row.relative_path))
            oldFilesRemoved += 1
          } catch { /* verified copy is already active */ }
        }
        const last = rows.at(-1)!
        cursorMs = last.created_at_ms
        cursorId = last.id
      }
    }
    return { rootDirectory: nextRoot, copied, reused, oldFilesRemoved }
  }

  async changeStorageRootAsync(nextRootDirectory: string, options: ChangeStorageRootOptions = {}): Promise<ChangeStorageRootResult> {
    if (!nextRootDirectory.trim()) throw new Error('新的保存目录不能为空。')
    const oldRoot = this.rootDirectory
    const nextRoot = path.resolve(nextRootDirectory)
    if (nextRoot === oldRoot) return { rootDirectory: oldRoot, copied: 0, reused: 0, oldFilesRemoved: 0 }
    if (isSameOrNested(oldRoot, nextRoot) || isSameOrNested(nextRoot, oldRoot)) throw new Error('新旧保存目录不能互相包含。')
    if (this.rootMigrationActive) throw new Error('素材保存位置正在迁移。')
    this.rootMigrationActive = true
    try {
    ensureDirectory(nextRoot)
    const createdPaths: string[] = []
    let copied = 0
    let reused = 0
    try {
      let cursorMs = Number.MAX_SAFE_INTEGER
      let cursorId = '\uffff'
      while (true) {
        const rows = this.database.prepare(`
          SELECT * FROM assets
          WHERE created_at_ms < ? OR (created_at_ms = ? AND id < ?)
          ORDER BY created_at_ms DESC, id DESC LIMIT 50
        `).all(cursorMs, cursorMs, cursorId) as unknown as AssetRow[]
        if (!rows.length) break
        for (const row of rows) {
          const sourcePath = safeResolve(oldRoot, row.relative_path)
          if (!fs.existsSync(sourcePath)) throw new Error(`原图不存在：${sourcePath}`)
          if (await hashFileAsync(sourcePath) !== row.content_hash) throw new Error(`原图内容校验失败：${sourcePath}`)
          const destinationPath = safeResolve(nextRoot, row.relative_path)
          const result = await copyFileVerifiedAsync(sourcePath, destinationPath, row.content_hash)
          if (result === 'copied') { copied += 1; createdPaths.push(destinationPath) } else reused += 1
        }
        const last = rows.at(-1)!
        cursorMs = last.created_at_ms
        cursorId = last.id
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      this.database.exec('BEGIN IMMEDIATE')
      try { this.setSetting('storage_root', nextRoot); this.database.exec('COMMIT') }
      catch (error) { try { this.database.exec('ROLLBACK') } catch { /* best effort */ }; throw error }
      this.rootDirectory = nextRoot
    } catch (error) {
      for (const createdPath of createdPaths.reverse()) try { await fs.promises.unlink(createdPath) } catch { /* best effort */ }
      throw error
    }

    let oldFilesRemoved = 0
    if (options.removeOldAfterSuccess) {
      let cursorMs = Number.MAX_SAFE_INTEGER
      let cursorId = '\uffff'
      while (true) {
        const rows = this.database.prepare(`
          SELECT * FROM assets
          WHERE created_at_ms < ? OR (created_at_ms = ? AND id < ?)
          ORDER BY created_at_ms DESC, id DESC LIMIT 50
        `).all(cursorMs, cursorMs, cursorId) as unknown as AssetRow[]
        if (!rows.length) break
        for (const row of rows) try { await fs.promises.unlink(safeResolve(oldRoot, row.relative_path)); oldFilesRemoved += 1 } catch { /* verified copy is active */ }
        const last = rows.at(-1)!
        cursorMs = last.created_at_ms
        cursorId = last.id
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
    return { rootDirectory: nextRoot, copied, reused, oldFilesRemoved }
    } finally {
      this.rootMigrationActive = false
    }
  }

  retryLegacyMigration(): LegacyMigrationResult {
    const result = this.migrateLegacyHistory(this.legacyHistoryDirectory)
    this.lastLegacyMigration = result
    return result
  }

  migrateLegacyHistory(legacyHistoryDirectory?: string): LegacyMigrationResult {
    const result: LegacyMigrationResult = { imported: 0, skipped: 0, failed: 0, errors: [] }
    if (!legacyHistoryDirectory) return result
    const legacyRoot = path.resolve(legacyHistoryDirectory)
    const indexPath = path.join(legacyRoot, 'index.json')
    if (!fs.existsSync(indexPath)) return result
    let items: unknown[]
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { items?: unknown[] }
      items = Array.isArray(parsed.items) ? parsed.items : []
    } catch (error) {
      return { ...result, failed: 1, errors: [`无法读取旧历史索引：${String(error)}`] }
    }
    for (const rawItem of items) {
      try {
        if (!rawItem || typeof rawItem !== 'object') throw new Error('索引项不是对象')
        const item = rawItem as Record<string, unknown>
        const id = typeof item.id === 'string' ? item.id : ''
        const fileName = typeof item.fileName === 'string' ? item.fileName : ''
        if (!id || !fileName || path.basename(fileName) !== fileName || fileName !== `${id}.png`) {
          throw new Error('旧图片路径不安全')
        }
        const sourcePath = safeResolve(legacyRoot, fileName)
        if (!fs.existsSync(sourcePath)) throw new Error('旧图片文件不存在')
        const migrationKey = `${indexPath}\0${id}`
        const tombstone = this.database.prepare('SELECT 1 AS found FROM legacy_tombstones WHERE migration_key = ?')
          .get(migrationKey) as { found: number } | undefined
        if (tombstone) {
          result.skipped += 1
          continue
        }
        const migrated = this.database.prepare('SELECT asset_id FROM legacy_migrations WHERE migration_key = ?')
          .get(migrationKey) as { asset_id: string } | undefined
        if (migrated && this.rowById(migrated.asset_id)) {
          result.skipped += 1
          continue
        }
        const png = fs.readFileSync(sourcePath)
        const width = Number(item.width)
        const height = Number(item.height)
        const createdAt = normalizeDate(typeof item.createdAt === 'string' ? item.createdAt : undefined, this.now())
        const rawAction = typeof item.action === 'string' ? item.action : 'capture'
        const allowedActions: LibraryAssetAction[] = ['capture', 'ocr', 'copy', 'pin', 'long', 'translate', 'edited', 'beautified', 'paste', 'import']
        const action = allowedActions.includes(rawAction as LibraryAssetAction) ? rawAction as LibraryAssetAction : 'capture'
        const added = this.addPng({
          png,
          width,
          height,
          action,
          source: 'legacy',
          createdAt,
          dedupe: 'global',
        })
        this.database.prepare(`
          INSERT INTO legacy_migrations(migration_key, asset_id, migrated_at) VALUES (?, ?, ?)
          ON CONFLICT(migration_key) DO UPDATE SET asset_id = excluded.asset_id, migrated_at = excluded.migrated_at
        `).run(migrationKey, added.asset.id, this.now().toISOString())
        result.imported += added.created ? 1 : 0
        result.skipped += added.created ? 0 : 1
      } catch (error) {
        result.failed += 1
        result.errors.push(String(error instanceof Error ? error.message : error))
      }
    }
    return result
  }
}
