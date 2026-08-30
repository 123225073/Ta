import {
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useMemo,
  useRef,
  useState,
} from 'react'
import './library.css'

export type AssetSource = 'ta-capture' | 'external-capture' | 'paste' | 'import' | 'edited' | 'beautified' | 'unknown'

export interface AssetView {
  id: string
  name: string
  createdAt: string
  dateKey: string
  width: number
  height: number
  thumbnailUrl?: string
  source: AssetSource
  sourceApp?: 'feishu' | 'weixin' | 'qq'
}

export interface AssetFilter {
  search: string
  date: string
}

export type AssetExportSelection =
  | { mode: 'ids'; ids: string[] }
  | { mode: 'filter'; filter: AssetFilter; excludedIds: string[] }

export interface LibraryPageProps {
  assets: AssetView[]
  loading?: boolean
  error?: string
  migrationWarning?: { failed: number; errors: string[] }
  totalCount?: number
  hasMore: boolean
  loadingMore: boolean
  onLoadMore(): void | Promise<void>
  onFilterChange?(filter: AssetFilter): void
  onPasteImages(files: File[]): void | Promise<void>
  onImport(): void | Promise<void>
  onOpenStorageLocation(): void | Promise<void>
  onOpen(id: string): void | Promise<void>
  onRename(id: string, name: string): void | Promise<void>
  onDelete(id: string): void | Promise<void>
  onExport(selection: AssetExportSelection): void | Promise<void>
  onRetry?(): void | Promise<void>
  onRetryMigration?(): void | Promise<void>
}

interface AssetGroup {
  key: string
  label: string
  items: AssetView[]
}

const SOURCE_LABELS: Record<AssetSource, string> = {
  'ta-capture': '拓截图',
  'external-capture': '外部截图',
  paste: '粘贴',
  import: '文件导入',
  edited: '标注结果',
  beautified: '美化结果',
  unknown: '本地图片',
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function localDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function filterAssets(assets: AssetView[], filter: AssetFilter) {
  const needle = filter.search.trim().toLocaleLowerCase('zh-CN')
  return assets.filter((asset) => {
    if (filter.date && asset.dateKey !== filter.date) return false
    if (!needle) return true
    return asset.name.toLocaleLowerCase('zh-CN').includes(needle)
  })
}

function groupLabel(dateKey: string, now: Date) {
  if (dateKey === 'unknown') return '日期未知'
  const today = localDateKey(now)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (dateKey === today) return '今天'
  if (dateKey === localDateKey(yesterday)) return '昨天'
  const [year, month, day] = dateKey.split('-').map(Number)
  if (year === now.getFullYear()) return `${month}月${day}日`
  return `${year}年${month}月${day}日`
}

export function groupAssetsByDate(assets: AssetView[], now = new Date()): AssetGroup[] {
  const groups = new Map<string, AssetView[]>()
  const sorted = [...assets].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime()
    const rightTime = new Date(right.createdAt).getTime()
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
  })
  for (const asset of sorted) {
    const key = /^\d{4}-\d{2}-\d{2}$/.test(asset.dateKey) ? asset.dateKey : 'unknown'
    const group = groups.get(key) ?? []
    group.push(asset)
    groups.set(key, group)
  }
  return [...groups.entries()].map(([key, items]) => ({ key, label: groupLabel(key, now), items }))
}

export function sourceLabel(asset: AssetView) {
  if (asset.source === 'external-capture' && asset.sourceApp) {
    return `${{ feishu: '飞书', weixin: '微信', qq: 'QQ' }[asset.sourceApp]}截图`
  }
  return SOURCE_LABELS[asset.source]
}

function formatAssetTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

type IconName = 'archive' | 'calendar' | 'check' | 'chevron' | 'edit' | 'export' | 'folder' | 'image' | 'import' | 'search' | 'trash'

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    archive: <><path d="M4 7.5h16v12H4z" /><path d="M3 4.5h18v3H3zm6 7h6" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4m8-4v4M4 10h16" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    edit: <><path d="m4 20 4.2-1 10.9-10.9-3.2-3.2L5 15.8z" /><path d="m14.8 6 3.2 3.2" /></>,
    export: <><path d="M12 3v12m0-12 4 4m-4-4L8 7" /><path d="M5 13v7h14v-7" /></>,
    folder: <path d="M3 6.5h7l2 2h9v10.5H3z" />,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m4 18 5-5 4 4 3-3 4 4" /></>,
    import: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 19h14" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></>,
    trash: <><path d="M5 7h14m-9-3h4l1 3H9zM7 7l1 13h8l1-13" /><path d="M10 11v5m4-5v5" /></>,
  }
  return <svg className="library-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>
}

function AssetCard({
  asset,
  selectionMode,
  selected,
  onToggle,
  onOpen,
  onRename,
  onDelete,
}: {
  asset: AssetView
  selectionMode: boolean
  selected: boolean
  onToggle(): void
  onOpen(): void
  onRename(name: string): void | Promise<void>
  onDelete(): void
}) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(asset.name)
  const [savingName, setSavingName] = useState(false)

  const commitRename = async (event?: FormEvent) => {
    event?.preventDefault()
    const nextName = name.trim()
    if (!nextName) return
    if (nextName !== asset.name) {
      setSavingName(true)
      try { await onRename(nextName) } finally { setSavingName(false) }
    }
    setRenaming(false)
  }

  const cancelRename = () => {
    setName(asset.name)
    setRenaming(false)
  }

  const onRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelRename()
    }
  }

  return (
    <article className={`library-card${selected ? ' is-selected' : ''}`}>
      <button
        type="button"
        className="library-card-preview"
        aria-label={selectionMode ? `${selected ? '取消选择' : '选择'} ${asset.name}` : `打开 ${asset.name}`}
        aria-pressed={selectionMode ? selected : undefined}
        onClick={selectionMode ? onToggle : onOpen}
      >
        {asset.thumbnailUrl
          ? <img src={asset.thumbnailUrl} alt="" loading="lazy" decoding="async" />
          : <span className="library-card-placeholder"><Icon name="image" /><small>预览生成中</small></span>}
        <span className={`library-source source-${asset.source}`}>{sourceLabel(asset)}</span>
        {selectionMode && (
          <span className="library-card-check" role="checkbox" aria-checked={selected}>
            {selected && <Icon name="check" />}
          </span>
        )}
      </button>

      <div className="library-card-details">
        {renaming ? (
          <form className="library-rename" onSubmit={commitRename}>
            <input
              autoFocus
              aria-label="图片名称"
              value={name}
              disabled={savingName}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={onRenameKeyDown}
              onBlur={(event) => {
                const nextTarget = event.relatedTarget as Node | null
                if (!savingName && (!nextTarget || !event.currentTarget.form?.contains(nextTarget))) void commitRename()
              }}
            />
            <button type="submit" disabled={!name.trim() || savingName} aria-label="保存名称"><Icon name="check" /></button>
          </form>
        ) : (
          <button type="button" className="library-card-name" title={asset.name} onClick={selectionMode ? onToggle : onOpen}>{asset.name}</button>
        )}
        <span className="library-card-meta">{formatAssetTime(asset.createdAt)} · {asset.width}×{asset.height}</span>
        {!selectionMode && !renaming && (
          <span className="library-card-actions">
            <button type="button" title="重命名" aria-label={`重命名 ${asset.name}`} onClick={() => { setName(asset.name); setRenaming(true) }}><Icon name="edit" /></button>
            <button type="button" className="danger" title="删除" aria-label={`删除 ${asset.name}`} onClick={onDelete}><Icon name="trash" /></button>
          </span>
        )}
      </div>
    </article>
  )
}

export function LibraryPage({
  assets,
  loading = false,
  error,
  migrationWarning,
  totalCount,
  hasMore,
  loadingMore,
  onLoadMore,
  onFilterChange,
  onPasteImages,
  onImport,
  onOpenStorageLocation,
  onOpen,
  onRename,
  onDelete,
  onExport,
  onRetry,
  onRetryMigration,
}: LibraryPageProps) {
  const pasteRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<AssetFilter>({ search: '', date: '' })
  const [pasteState, setPasteState] = useState<'idle' | 'ready' | 'busy' | 'success' | 'invalid' | 'error'>('idle')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectAllMatching, setSelectAllMatching] = useState(false)
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  const filteredAssets = useMemo(() => filterAssets(assets, filter), [assets, filter])
  const groups = useMemo(() => groupAssetsByDate(filteredAssets), [filteredAssets])
  const resultCount = totalCount ?? filteredAssets.length
  const selectedCount = selectAllMatching
    ? Math.max(0, resultCount - excludedIds.size)
    : selectedIds.size

  const updateFilter = (patch: Partial<AssetFilter>) => {
    const next = { ...filter, ...patch }
    setFilter(next)
    setSelectedIds(new Set())
    setExcludedIds(new Set())
    setSelectAllMatching(false)
    onFilterChange?.(next)
  }

  const isSelected = (id: string) => selectAllMatching ? !excludedIds.has(id) : selectedIds.has(id)

  const toggleItem = (id: string) => {
    if (selectAllMatching) {
      setExcludedIds((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
    } else {
      setSelectedIds((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
    }
  }

  const toggleGroup = (group: AssetGroup) => {
    const items = group.items
    const allSelected = items.length > 0 && items.every((item) => isSelected(item.id))
    if (group.key !== 'unknown') {
      if (selectAllMatching && filter.date === group.key && allSelected) {
        setSelectAllMatching(false)
        setExcludedIds(new Set())
        setSelectedIds(new Set())
        return
      }
      const next = { ...filter, date: group.key }
      setFilter(next)
      setSelectedIds(new Set())
      setExcludedIds(new Set())
      setSelectAllMatching(true)
      onFilterChange?.(next)
      return
    }
    if (selectAllMatching) {
      setExcludedIds((current) => {
        const next = new Set(current)
        for (const item of items) allSelected ? next.add(item.id) : next.delete(item.id)
        return next
      })
    } else {
      setSelectedIds((current) => {
        const next = new Set(current)
        for (const item of items) allSelected ? next.delete(item.id) : next.add(item.id)
        return next
      })
    }
  }

  const cancelSelection = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
    setExcludedIds(new Set())
    setSelectAllMatching(false)
  }

  const handlePaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (document.activeElement !== event.currentTarget) return
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (!files.length) {
      setPasteState('invalid')
      return
    }
    event.preventDefault()
    setPasteState('busy')
    try {
      await onPasteImages(files)
      setPasteState('success')
    } catch {
      setPasteState('error')
    }
  }

  const handlePasteKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.currentTarget.focus()
      setPasteState('ready')
    }
  }

  const handleExport = async () => {
    if (!selectedCount) return
    setExporting(true)
    try {
      await onExport(selectAllMatching
        ? { mode: 'filter', filter, excludedIds: [...excludedIds] }
        : { mode: 'ids', ids: [...selectedIds] })
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className={`page library-page${selectionMode ? ' has-selection-bar' : ''}`}>
      <header className="library-hero">
        <div>
          <span className="library-kicker"><i /> 本地图片素材</span>
          <h1>素材库</h1>
          <p>截图、粘贴与导入的图片按日期自然归档。只有你主动使用 AI 时，图片才会发送到模型服务。</p>
        </div>
        <span className="library-count"><b>{totalCount ?? assets.length}</b><small>张拓片保存在本机</small></span>
      </header>

      <section className="library-command-deck" aria-label="素材库工具">
        <div
          ref={pasteRef}
          className={`library-paste-zone is-${pasteState}`}
          role="button"
          tabIndex={0}
          aria-label="点击后按 Ctrl 加 V 粘贴图片"
          aria-live="polite"
          onClick={() => { pasteRef.current?.focus(); setPasteState('ready') }}
          onFocus={() => setPasteState((state) => state === 'busy' ? state : 'ready')}
          onBlur={() => setPasteState((state) => state === 'busy' ? state : 'idle')}
          onKeyDown={handlePasteKeyDown}
          onPaste={handlePaste}
        >
          <span className="library-paste-seal">贴</span>
          <span>
            <b>{pasteState === 'busy' ? '正在保存图片…' : pasteState === 'success' ? '已加入素材库' : pasteState === 'invalid' ? '剪贴板中没有图片' : pasteState === 'error' ? '粘贴失败，请重试' : pasteState === 'ready' ? '已准备接收图片' : '点击这里，再按 Ctrl + V'}</b>
            <small>{pasteState === 'ready' ? '焦点离开此区域后，粘贴不会进入拓' : '不会监听你在其他软件中的普通复制操作'}</small>
          </span>
          <kbd>Ctrl V</kbd>
        </div>
        <button type="button" className="library-import-button" onClick={() => void onImport()}><Icon name="import" /><span><b>导入图片</b><small>选择一张或多张本地图片</small></span><Icon name="chevron" /></button>
      </section>

      {migrationWarning && migrationWarning.failed > 0 && (
        <div className="library-inline-error library-migration-warning" role="alert">
          <span>!</span>
          <p><b>有 {migrationWarning.failed} 条旧版截图尚未迁移</b><small>{migrationWarning.errors[0] || '旧素材暂未完整导入，新截图不受影响。'}</small></p>
          {onRetryMigration && <button type="button" onClick={() => void onRetryMigration()}>重新迁移</button>}
        </div>
      )}

      <section className="library-browser" aria-busy={loading}>
        <header className="library-toolbar">
          <label className="library-search">
            <span className="sr-only">搜索图片名称</span>
            <Icon name="search" />
            <input value={filter.search} placeholder="搜索图片名称" onChange={(event) => updateFilter({ search: event.target.value })} />
            {filter.search && <button type="button" aria-label="清除搜索" onClick={() => updateFilter({ search: '' })}>×</button>}
          </label>
          <label className="library-date-filter">
            <span className="sr-only">按日期筛选</span>
            <Icon name="calendar" />
            <input type="date" value={filter.date} onChange={(event) => updateFilter({ date: event.target.value })} />
          </label>
          <button type="button" className="library-tool-button" onClick={() => void onOpenStorageLocation()}><Icon name="folder" />打开保存位置</button>
          <button
            type="button"
            className={`library-tool-button library-select-button${selectionMode ? ' active' : ''}`}
            aria-pressed={selectionMode}
            onClick={() => selectionMode ? cancelSelection() : setSelectionMode(true)}
          ><Icon name="check" />{selectionMode ? '退出选择' : '选择'}</button>
        </header>

        {error && (
          <div className="library-inline-error" role="alert"><span>!</span><p><b>素材读取不完整</b><small>{error}</small></p>{onRetry && <button type="button" onClick={() => void onRetry()}>重新加载</button>}</div>
        )}

        {loading && !assets.length ? (
          <div className="library-loading" role="status" aria-live="polite">
            <span className="library-loading-seal">拓</span>
            <p>正在整理你的拓片…</p>
            <div><i /><i /><i /><i /></div>
          </div>
        ) : groups.length ? (
          <div className="library-groups">
            {groups.map((group) => {
              const groupSelected = group.items.length > 0 && group.items.every((item) => isSelected(item.id))
              return (
                <section className="library-date-group" key={group.key} aria-labelledby={`library-date-${group.key}`}>
                  <header>
                    <div><span>{group.label}</span><h2 id={`library-date-${group.key}`}>{group.key === 'unknown' ? '未归档' : group.key.replaceAll('-', ' · ')}</h2><small>{group.items.length} 张已加载</small></div>
                    {selectionMode && <button type="button" aria-pressed={groupSelected} onClick={() => toggleGroup(group)}>{groupSelected ? '取消选择当天' : '选择当天'}</button>}
                  </header>
                  <div className="library-grid">
                    {group.items.map((asset) => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        selectionMode={selectionMode}
                        selected={isSelected(asset.id)}
                        onToggle={() => toggleItem(asset.id)}
                        onOpen={() => void onOpen(asset.id)}
                        onRename={(name) => onRename(asset.id, name)}
                        onDelete={() => void onDelete(asset.id)}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <div className="library-empty">
            <span><Icon name={filter.search || filter.date ? 'search' : 'archive'} /></span>
            <h2>{filter.search || filter.date ? '没有符合条件的拓片' : '素材库还是空的'}</h2>
            <p>{filter.search || filter.date ? '换个名称或日期试试；筛选只影响查看，不会删除图片。' : '完成一次截图，或者在上方明确粘贴、导入图片。'}</p>
            {(filter.search || filter.date) && <button type="button" onClick={() => updateFilter({ search: '', date: '' })}>清除筛选</button>}
          </div>
        )}

        {!loading && groups.length > 0 && (
          <footer className="library-pagination">
            {hasMore
              ? <button type="button" disabled={loadingMore} onClick={() => void onLoadMore()}>{loadingMore ? <><i />正在加载更多…</> : '加载更多拓片'}</button>
              : <span>已经看到全部拓片 · 图片默认长期保存在本机</span>}
          </footer>
        )}
      </section>

      {selectionMode && (
        <aside className="library-selection-bar" aria-label="批量操作">
          <span className="library-selection-count"><b>{selectedCount}</b><small>张已选择</small></span>
          <button
            type="button"
            className={selectAllMatching ? 'active' : ''}
            aria-pressed={selectAllMatching}
            disabled={!resultCount}
            onClick={() => { setSelectAllMatching(true); setSelectedIds(new Set()); setExcludedIds(new Set()) }}
          >全选当前筛选结果{resultCount ? `（${resultCount}）` : ''}</button>
          <span className="library-selection-note">导出会复制图片，素材库原图仍然保留</span>
          <button type="button" className="library-cancel-selection" onClick={cancelSelection}>取消</button>
          <button type="button" className="library-export-button" disabled={!selectedCount || exporting} onClick={() => void handleExport()}><Icon name="export" />{exporting ? '正在导出…' : `导出 ${selectedCount} 张`}</button>
        </aside>
      )}
    </main>
  )
}
