export interface ManagedWindow {
  readonly webContents: { readonly id: number }
  isDestroyed(): boolean
  destroy(): void
  on(event: 'closed', listener: () => void): unknown
}

export interface ManagedWindowSession {
  window: ManagedWindow
}

export function registerWindowSession<T extends ManagedWindowSession>(sessions: Map<number, T>, session: T) {
  const webContentsId = session.window.webContents.id
  sessions.set(webContentsId, session)
  session.window.on('closed', () => sessions.delete(webContentsId))
  return webContentsId
}

export function destroyWindowSessions<T extends ManagedWindowSession>(sessions: Map<number, T>, readyIds?: Set<number>) {
  const pending = [...sessions.values()]
  sessions.clear()
  readyIds?.clear()
  for (const session of pending) {
    if (!session.window.isDestroyed()) session.window.destroy()
  }
}
