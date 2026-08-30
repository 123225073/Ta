import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ExternalScreenshotApp } from './clipboard-source'

export interface StagedExternalCapture {
  filePath: string
  sourceApp: ExternalScreenshotApp
  createdAt: string
}

export class ExternalCaptureStagingFullError extends Error {
  constructor() {
    super('外部截图暂存队列已满。')
    this.name = 'ExternalCaptureStagingFullError'
  }
}

const STAGED_FILE = /^(\d{13})-(feishu|weixin|qq)-[a-f0-9]{16}\.png$/

export class ExternalCaptureStaging {
  private operation: Promise<void> = Promise.resolve()
  lastRecoveryRejected = 0

  constructor(
    private readonly directory: string,
    private readonly maxFiles = 100,
    private readonly maxBytes = 512 * 1024 * 1024,
    private readonly maxEntryBytes = 80 * 1024 * 1024,
  ) {}

  private async ensureDirectory() {
    await fs.promises.mkdir(this.directory, { recursive: true })
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const run = this.operation.then(work)
    this.operation = run.then(() => undefined, () => undefined)
    return run
  }

  private async usage() {
    await this.ensureDirectory()
    const entries = await fs.promises.readdir(this.directory, { withFileTypes: true })
    let files = 0
    let bytes = 0
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.png')) continue
      try {
        const stat = await fs.promises.stat(path.join(this.directory, entry.name))
        files += 1
        bytes += stat.size
      } catch { /* file changed during recovery */ }
    }
    return { files, bytes }
  }

  async stage(png: Buffer, sourceApp: ExternalScreenshotApp, createdAt = new Date()): Promise<StagedExternalCapture> {
    return this.withLock(async () => {
      const { files, bytes } = await this.usage()
      if (png.length > this.maxEntryBytes || files >= this.maxFiles || bytes + png.length > this.maxBytes) {
        throw new ExternalCaptureStagingFullError()
      }
      const timestamp = createdAt.getTime()
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('外部截图时间无效。')
      const name = `${timestamp}-${sourceApp}-${crypto.randomBytes(8).toString('hex')}.png`
      const filePath = path.join(this.directory, name)
      const temporary = path.join(this.directory, `.${name}.${crypto.randomBytes(4).toString('hex')}.tmp`)
      try {
        await fs.promises.writeFile(temporary, png, { flag: 'wx', mode: 0o600 })
        await fs.promises.rename(temporary, filePath)
      } catch (error) {
        try { await fs.promises.unlink(temporary) } catch { /* best effort */ }
        throw error
      }
      return { filePath, sourceApp, createdAt: createdAt.toISOString() }
    })
  }

  async recover(): Promise<StagedExternalCapture[]> {
    await this.ensureDirectory()
    const entries = await fs.promises.readdir(this.directory, { withFileTypes: true })
    this.lastRecoveryRejected = 0
    const recovered: StagedExternalCapture[] = []
    let recoveredBytes = 0
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile()) continue
      if (entry.name.startsWith('.') && entry.name.endsWith('.tmp')) {
        try { await fs.promises.unlink(path.join(this.directory, entry.name)) } catch { /* best effort */ }
        continue
      }
      const match = STAGED_FILE.exec(entry.name)
      if (!match) continue
      const timestamp = Number(match[1])
      const createdAt = new Date(timestamp)
      if (!Number.isFinite(createdAt.getTime())) continue
      const staged = {
        filePath: path.join(this.directory, entry.name),
        sourceApp: match[2] as ExternalScreenshotApp,
        createdAt: createdAt.toISOString(),
      }
      let stat: fs.Stats
      try { stat = await fs.promises.lstat(staged.filePath) } catch { continue }
      if (
        !stat.isFile()
        || stat.isSymbolicLink()
        || stat.size < 1
        || stat.size > this.maxEntryBytes
        || recovered.length >= this.maxFiles
        || recoveredBytes + stat.size > this.maxBytes
      ) {
        this.lastRecoveryRejected += 1
        await this.quarantine(staged).catch(() => undefined)
        continue
      }
      recoveredBytes += stat.size
      recovered.push(staged)
    }
    return recovered.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async read(entry: StagedExternalCapture) {
    const resolvedDirectory = path.resolve(this.directory)
    const resolvedPath = path.resolve(entry.filePath)
    if (path.dirname(resolvedPath) !== resolvedDirectory || !STAGED_FILE.test(path.basename(resolvedPath))) {
      throw new Error('外部截图暂存路径无效。')
    }
    const handle = await fs.promises.open(resolvedPath, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size < 1 || stat.size > this.maxEntryBytes) throw new Error('暂存图片大小无效或超过 80 MB。')
      const bytes = Buffer.allocUnsafe(stat.size)
      let offset = 0
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!result.bytesRead) break
        offset += result.bytesRead
      }
      if (offset !== bytes.length) throw new Error('暂存图片读取不完整。')
      return bytes
    } finally {
      await handle.close()
    }
  }

  async remove(entry: StagedExternalCapture) {
    try { await fs.promises.unlink(entry.filePath) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  async quarantine(entry: StagedExternalCapture) {
    const failedPath = `${entry.filePath}.${crypto.randomBytes(4).toString('hex')}.failed`
    try {
      await fs.promises.rename(entry.filePath, failedPath)
      return failedPath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
}
