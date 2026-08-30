import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssetLibrary, LibraryAssetSource } from './library'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const temporaryDirectories: string[] = []

function png(label: string): Buffer {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from(label, 'utf8')])
}

function createWorkspace(): { base: string; metadata: string; root: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-library-'))
  temporaryDirectories.push(base)
  return {
    base,
    metadata: path.join(base, 'metadata'),
    root: path.join(base, 'pictures', '拓 Ta'),
  }
}

function createLibrary(workspace: ReturnType<typeof createWorkspace>, root = workspace.root): AssetLibrary {
  return new AssetLibrary({
    metadataDirectory: workspace.metadata,
    rootDirectory: root,
    now: () => new Date('2026-08-28T07:47:13.000Z'),
  })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('AssetLibrary', () => {
  it('原子入库、短期/全局去重、重命名和安全删除形成一致闭环', () => {
    const workspace = createWorkspace()
    const library = createLibrary(workspace)
    const bytes = png('first')
    const first = library.addPng({
      png: bytes,
      width: 120,
      height: 80,
      action: 'capture',
      source: 'ta-capture',
    })
    expect(first.created).toBe(true)
    expect(first.asset.relativePath).toMatch(/^2026\/08\/28\//)
    expect(first.asset.dateKey).toBe('2026-08-28')
    expect(first.asset.title).toContain('拓截图')
    expect(fs.readFileSync(library.open(first.asset.id)!)).toEqual(bytes)

    const shortTermDuplicate = library.addPng({
      png: bytes,
      width: 120,
      height: 80,
      action: 'capture',
      source: 'ta-capture',
      createdAt: '2026-08-28T07:47:18.000Z',
    })
    expect(shortTermDuplicate).toMatchObject({ created: false, duplicateOf: first.asset.id })

    const laterCopy = library.addPng({
      png: bytes,
      width: 120,
      height: 80,
      action: 'paste',
      source: 'paste',
      createdAt: '2026-08-29T07:47:13.000Z',
    })
    expect(laterCopy.created).toBe(true)
    const external = library.addPng({
      png: png('feishu'),
      width: 120,
      height: 80,
      action: 'capture',
      source: 'external-capture',
      sourceApp: 'feishu',
      dedupe: 'none',
    })
    expect(library.get(external.asset.id)?.sourceApp).toBe('feishu')
    const globalDuplicate = library.addPng({
      png: bytes,
      width: 120,
      height: 80,
      action: 'import',
      source: 'import',
      createdAt: '2026-09-29T07:47:13.000Z',
      dedupe: 'global',
    })
    expect(globalDuplicate.created).toBe(false)

    const oldPath = library.open(first.asset.id)!
    const renamed = library.rename(first.asset.id, '..\\..\\CON\\项目图 : 01')!
    const renamedPath = library.open(first.asset.id)!
    expect(renamed.title).toBe('CON 项目图 01')
    expect(renamedPath.startsWith(path.resolve(workspace.root) + path.sep)).toBe(true)
    expect(renamedPath).not.toBe(oldPath)
    expect(fs.existsSync(oldPath)).toBe(false)
    expect(fs.existsSync(renamedPath)).toBe(true)

    expect(library.delete(first.asset.id)).toBe(true)
    expect(library.get(first.asset.id)).toBeUndefined()
    expect(fs.existsSync(renamedPath)).toBe(false)
    expect(library.delete(first.asset.id)).toBe(false)
    expect(library.stats()).toMatchObject({ count: 2, totalBytes: bytes.length + png('feishu').length, rootDirectory: path.resolve(workspace.root) })
    library.close()
  })

  it('使用 SQLite 键集分页处理上千条记录，并支持搜索、日期和来源筛选', { timeout: 60_000 }, () => {
    const workspace = createWorkspace()
    const library = createLibrary(workspace)
    const total = 1_025
    for (let index = 0; index < total; index += 1) {
      const day = index % 2 === 0 ? '28' : '27'
      const source: LibraryAssetSource = index % 3 === 0 ? 'external-capture' : 'ta-capture'
      library.addPng({
        png: png(`asset-${index}`),
        width: 10,
        height: 10,
        action: 'capture',
        source,
        title: index % 111 === 0 ? `重点项目 ${index}` : `普通图片 ${index}`,
        createdAt: `2026-08-${day}T07:${String(index % 60).padStart(2, '0')}:00.000Z`,
        dedupe: 'none',
      })
    }

    const collected = new Set<string>()
    let cursor: string | undefined
    do {
      const page = library.list({ limit: 73, cursor })
      expect(page.items.length).toBeLessThanOrEqual(73)
      page.items.forEach((item) => collected.add(item.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(collected.size).toBe(total)
    expect(library.stats().count).toBe(total)

    const search = library.list({ search: '重点项目', limit: 100 })
    expect(search.items).toHaveLength(10)
    expect(search.items.every((item) => item.title.includes('重点项目'))).toBe(true)
    expect(library.count({ search: '重点项目' })).toBe(10)
    const date = library.list({ date: '2026-08-28', limit: 200 })
    expect(date.items).toHaveLength(200)
    expect(date.nextCursor).toBeTruthy()
    const source = library.list({ source: 'external-capture', limit: 200 })
    expect(source.items.every((item) => item.source === 'external-capture')).toBe(true)
    expect(library.count({ date: '2026-08-28', source: 'external-capture' })).toBeGreaterThan(0)
    expect(() => library.list({ cursor: '../invalid' })).toThrow('分页位置无效')
    library.close()
  })

  it('关闭并重新打开后保留元数据、文件和已配置的根目录', () => {
    const workspace = createWorkspace()
    let library = createLibrary(workspace)
    const added = library.addPng({
      png: png('restart'),
      width: 20,
      height: 30,
      action: 'paste',
      source: 'paste',
      title: '需求截图',
    }).asset
    library.close()

    library = new AssetLibrary({
      metadataDirectory: workspace.metadata,
      rootDirectory: path.join(workspace.base, 'a-different-default-must-not-win'),
    })
    expect(library.getRootDirectory()).toBe(path.resolve(workspace.root))
    expect(library.get(added.id)).toEqual(added)
    expect(fs.readFileSync(library.open(added.id)!)).toEqual(png('restart'))
    library.close()
  })

  it('批量导出异步复制图片，同名时生成新文件且不破坏原图', async () => {
    const workspace = createWorkspace()
    const library = createLibrary(workspace)
    const first = library.addPng({
      png: png('export-1'), width: 10, height: 10, action: 'import', source: 'import', title: '项目截图', dedupe: 'none',
    }).asset
    const second = library.addPng({
      png: png('export-2'), width: 10, height: 10, action: 'paste', source: 'paste', title: '项目截图', dedupe: 'none',
    }).asset
    const exportDirectory = path.join(workspace.base, 'export')
    fs.mkdirSync(exportDirectory, { recursive: true })
    fs.writeFileSync(path.join(exportDirectory, '项目截图.png'), png('existing'))

    const exported = await library.batchExportAsync([first.id, second.id, first.id, 'missing'], exportDirectory)
    expect(exported.exported.map((item) => path.basename(item.filePath))).toEqual(['项目截图 (2).png', '项目截图 (3).png'])
    expect(exported.missingIds).toEqual(['missing'])
    expect(fs.readFileSync(library.open(first.id)!)).toEqual(png('export-1'))
    expect(fs.readFileSync(library.open(second.id)!)).toEqual(png('export-2'))
    library.close()
  })

  it('更换保存路径时先复制并校验，成功后切换且默认保留旧文件', () => {
    const workspace = createWorkspace()
    let library = createLibrary(workspace)
    const added = library.addPng({
      png: png('move'), width: 40, height: 50, action: 'capture', source: 'ta-capture', dedupe: 'none',
    }).asset
    const oldPath = library.open(added.id)!
    const nextRoot = path.join(workspace.base, 'new-pictures')
    const changed = library.changeStorageRoot(nextRoot)
    expect(changed).toMatchObject({ rootDirectory: path.resolve(nextRoot), copied: 1, reused: 0, oldFilesRemoved: 0 })
    expect(fs.existsSync(oldPath)).toBe(true)
    expect(fs.readFileSync(library.open(added.id)!)).toEqual(png('move'))
    library.close()

    library = createLibrary(workspace, workspace.root)
    expect(library.getRootDirectory()).toBe(path.resolve(nextRoot))
    expect(fs.readFileSync(library.open(added.id)!)).toEqual(png('move'))
    library.close()
  })

  it('异步迁移期间拒绝绕过队列的直接写入，避免切换后出现缺失原图', async () => {
    const workspace = createWorkspace()
    const library = createLibrary(workspace)
    const original = library.addPng({
      png: png('migration-guard'), width: 20, height: 20, action: 'capture', source: 'ta-capture', dedupe: 'none',
    }).asset
    const nextRoot = path.join(workspace.base, 'async-root')
    const migration = library.changeStorageRootAsync(nextRoot)
    expect(() => library.addPng({
      png: png('must-wait'), width: 20, height: 20, action: 'paste', source: 'paste', dedupe: 'none',
    })).toThrow('正在迁移')
    await migration
    expect(fs.readFileSync(library.open(original.id)!)).toEqual(png('migration-guard'))
    library.close()
  })

  it('迁移目标有内容冲突时回滚，重启后仍使用旧根目录', () => {
    const workspace = createWorkspace()
    let library = createLibrary(workspace)
    const first = library.addPng({
      png: png('migration-first'), width: 10, height: 10, action: 'capture', source: 'ta-capture', dedupe: 'none',
    }).asset
    const second = library.addPng({
      png: png('migration-second'), width: 10, height: 10, action: 'capture', source: 'ta-capture', dedupe: 'none',
      createdAt: '2026-08-29T07:47:13.000Z',
    }).asset
    const nextRoot = path.join(workspace.base, 'conflicting-root')
    const conflictingPath = path.join(nextRoot, ...second.relativePath.split('/'))
    fs.mkdirSync(path.dirname(conflictingPath), { recursive: true })
    fs.writeFileSync(conflictingPath, png('different-content'))

    expect(() => library.changeStorageRoot(nextRoot)).toThrow('同名但内容不同')
    expect(library.getRootDirectory()).toBe(path.resolve(workspace.root))
    expect(fs.readFileSync(library.open(first.id)!)).toEqual(png('migration-first'))
    expect(fs.existsSync(path.join(nextRoot, ...first.relativePath.split('/')))).toBe(false)
    library.close()

    library = createLibrary(workspace)
    expect(library.getRootDirectory()).toBe(path.resolve(workspace.root))
    expect(fs.readFileSync(library.open(second.id)!)).toEqual(png('migration-second'))
    library.close()
  })

  it('从旧 history/index.json 幂等迁移，保留旧文件并拒绝路径穿越', () => {
    const workspace = createWorkspace()
    const legacy = path.join(workspace.base, 'appData', 'history')
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'old-1.png'), png('legacy'))
    fs.writeFileSync(path.join(workspace.base, 'escape.png'), png('escape'))
    fs.writeFileSync(path.join(legacy, 'index.json'), JSON.stringify({
      items: [
        { id: 'old-1', createdAt: '2026-08-20T01:02:03.000Z', width: 88, height: 99, action: 'capture', fileName: 'old-1.png' },
        { id: '../escape', createdAt: '2026-08-20T01:02:03.000Z', width: 1, height: 1, action: 'capture', fileName: '../escape.png' },
      ],
    }))

    let library = new AssetLibrary({
      metadataDirectory: workspace.metadata,
      rootDirectory: workspace.root,
      legacyHistoryDirectory: legacy,
    })
    expect(library.lastLegacyMigration).toMatchObject({ imported: 1, skipped: 0, failed: 1 })
    expect(library.stats().count).toBe(1)
    const migrated = library.list({ limit: 10 }).items[0]
    expect(migrated.source).toBe('legacy')
    expect(fs.readFileSync(library.open(migrated.id)!)).toEqual(png('legacy'))
    expect(fs.existsSync(path.join(legacy, 'old-1.png'))).toBe(true)
    library.close()

    library = new AssetLibrary({
      metadataDirectory: workspace.metadata,
      rootDirectory: workspace.root,
      legacyHistoryDirectory: legacy,
    })
    expect(library.lastLegacyMigration).toMatchObject({ imported: 0, skipped: 1, failed: 1 })
    expect(library.stats().count).toBe(1)
    const migratedAgain = library.list({ limit: 10 }).items[0]
    expect(library.delete(migratedAgain.id)).toBe(true)
    library.close()

    library = new AssetLibrary({
      metadataDirectory: workspace.metadata,
      rootDirectory: workspace.root,
      legacyHistoryDirectory: legacy,
    })
    expect(library.lastLegacyMigration).toMatchObject({ imported: 0, skipped: 1, failed: 1 })
    expect(library.stats().count).toBe(0)
    library.close()
  })
})
