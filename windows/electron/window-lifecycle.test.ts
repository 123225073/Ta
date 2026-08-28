import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { destroyWindowSessions, registerWindowSession } from './window-lifecycle'

class FakeWindow extends EventEmitter {
  private destroyed = false
  private readonly contentsId: number
  destroyCalls = 0

  constructor(id: number) {
    super()
    this.contentsId = id
  }

  readonly webContents = {
    get id() {
      const owner = (this as { owner?: FakeWindow }).owner
      if (owner?.isDestroyed()) throw new TypeError('Object has been destroyed')
      return owner?.contentsId ?? -1
    },
    owner: this,
  }

  isDestroyed() {
    return this.destroyed
  }

  destroy() {
    this.destroyCalls += 1
    this.destroyed = true
    this.emit('closed')
  }
}

describe('window lifecycle', () => {
  it('销毁窗口后不再读取已经销毁的 webContents', () => {
    const sessions = new Map<number, { window: FakeWindow }>()
    const readyIds = new Set([67])
    registerWindowSession(sessions, { window: new FakeWindow(67) })

    expect(() => destroyWindowSessions(sessions, readyIds)).not.toThrow()
    expect(sessions.size).toBe(0)
    expect(readyIds.size).toBe(0)
  })

  it('重复关闭为幂等操作，不会二次销毁窗口', () => {
    const sessions = new Map<number, { window: FakeWindow }>()
    const window = new FakeWindow(9)
    registerWindowSession(sessions, { window })

    destroyWindowSessions(sessions)
    destroyWindowSessions(sessions)

    expect(window.destroyCalls).toBe(1)
  })

  it('多窗口同步关闭时先撤销全部会话，再触发 closed 回调', () => {
    const sessions = new Map<number, { window: FakeWindow }>()
    const windows = Array.from({ length: 32 }, (_, index) => new FakeWindow(index + 1))
    for (const window of windows) registerWindowSession(sessions, { window })

    destroyWindowSessions(sessions)

    expect(sessions.size).toBe(0)
    expect(windows.every((window) => window.destroyCalls === 1)).toBe(true)
  })

  it('窗口自行关闭后能用缓存 ID 清理会话', () => {
    const sessions = new Map<number, { window: FakeWindow }>()
    const window = new FakeWindow(21)
    registerWindowSession(sessions, { window })

    expect(() => window.destroy()).not.toThrow()
    expect(sessions.size).toBe(0)
  })
})
