import { describe, expect, it } from 'vitest'
import { filterAssets, groupAssetsByDate, sourceLabel, type AssetView } from './LibraryPage'

const assets: AssetView[] = [
  { id: 'older', name: '需求说明', createdAt: '2026-08-27T01:00:00.000Z', dateKey: '2026-08-27', width: 800, height: 600, source: 'import' },
  { id: 'newer', name: '飞书项目讨论', createdAt: '2026-08-28T10:30:00.000Z', dateKey: '2026-08-28', width: 1200, height: 800, source: 'external-capture', sourceApp: 'feishu' },
  { id: 'same-day', name: '发布检查', createdAt: '2026-08-28T02:20:00.000Z', dateKey: '2026-08-28', width: 900, height: 700, source: 'ta-capture' },
]

describe('library asset view helpers', () => {
  it('groups assets by their persisted archive date and keeps the newest item first', () => {
    const groups = groupAssetsByDate(assets, new Date('2026-08-28T20:00:00+08:00'))

    expect(groups.map((group) => group.label)).toEqual(['今天', '昨天'])
    expect(groups[0].items.map((item) => item.id)).toEqual(['newer', 'same-day'])
  })

  it('filters by name and exact persisted archive date together', () => {
    expect(filterAssets(assets, { search: '飞书', date: '2026-08-28' }).map((item) => item.id)).toEqual(['newer'])
    expect(filterAssets(assets, { search: '不存在', date: '' })).toEqual([])
  })

  it('does not recalculate the archive day when the current timezone changes', () => {
    const midnightAsset: AssetView = {
      id: 'timezone-stable',
      name: '午夜截图',
      createdAt: '2026-08-27T16:30:00.000Z',
      dateKey: '2026-08-28',
      width: 100,
      height: 100,
      source: 'ta-capture',
    }
    expect(groupAssetsByDate([midnightAsset], new Date('2026-08-28T12:00:00.000Z'))[0].key).toBe('2026-08-28')
    expect(filterAssets([midnightAsset], { search: '', date: '2026-08-28' })).toHaveLength(1)
    expect(filterAssets([midnightAsset], { search: '', date: '2026-08-27' })).toHaveLength(0)
  })

  it('makes a recognized external source explicit to the user', () => {
    expect(sourceLabel(assets[1])).toBe('飞书截图')
    expect(sourceLabel(assets[0])).toBe('文件导入')
  })
})
