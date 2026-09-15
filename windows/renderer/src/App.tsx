import { KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Editor } from './Editor'
import { AppSettings, CaptureAction, CaptureResult, HistoryItem, LibraryListQuery, LibraryStats } from './types'
import { LibraryPage, type AssetExportSelection, type AssetFilter, type AssetView } from './LibraryPage'
import {
  beginToolRun,
  completeToolRun,
  createResultToolCache,
  failToolRun,
  shouldRunTool,
  type ResultTool,
} from './result-tool-cache'
import { captureHotkey, duplicateAccelerators, formatAccelerator } from './hotkey-recorder'

type Page = 'home' | 'library' | 'settings' | 'result'
type Notice = { message: string; tone?: 'success' | 'error' }

const actionCopy: Array<{ action: CaptureAction; title: string; description: string; key: string; glyph: string }> = [
  { action: 'capture', title: '通用截图', description: '框选后再决定下一步', key: 'Ctrl Shift 2', glyph: '⌗' },
  { action: 'ocr', title: '极速取字', description: '本地中英文 OCR', key: 'Ctrl Shift 1', glyph: '文' },
  { action: 'copy', title: '快速截图', description: '自动复制并保存，不打开编辑页', key: 'Ctrl Shift 3', glyph: '快' },
  { action: 'pin', title: '截图钉图', description: '置顶作为参考', key: 'Ctrl Shift 4', glyph: '钉' },
  { action: 'long', title: '滚动长截图', description: '自动滚动与拼接', key: 'Ctrl Shift 5', glyph: '长' },
  { action: 'translate', title: '截图翻译', description: '保持原文结构', key: 'Ctrl Shift 6', glyph: '译' },
]

const windowsDefaultHotkeys: Record<CaptureAction, string> = {
  ocr: 'Ctrl+Shift+1',
  capture: 'Ctrl+Shift+2',
  copy: 'Ctrl+Shift+3',
  pin: 'Ctrl+Shift+4',
  long: 'Ctrl+Shift+5',
  translate: 'Ctrl+Shift+6',
}

const actionNames: Record<string, string> = {
  capture: '通用截图', ocr: '极速取字', copy: '快速截图', pin: '截图钉图', long: '滚动长图', translate: '截图翻译', edited: '标注图片', beautified: '美化图片',
}

function cachedTheme(): AppSettings['theme'] {
  try { return window.localStorage.getItem('ta-theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}

function cacheTheme(theme: AppSettings['theme']) {
  try { window.localStorage.setItem('ta-theme', theme) } catch { /* Settings remains the source of truth. */ }
}

function formatDate(value: string) {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function TitleBar({ page, version, theme, themeBusy, onNavigate, onThemeToggle }: {
  page: Page
  version: string
  theme: AppSettings['theme']
  themeBusy: boolean
  onNavigate(page: Page): void
  onThemeToggle(): void
}) {
  return (
    <header className="titlebar">
      <div className="brand" title="按住这里拖动窗口"><img src="./icon.png" alt="拓" /><span><b>拓 Ta</b><small>Windows · v{version}</small></span></div>
      <nav>
        <button className={page === 'home' ? 'active' : ''} onClick={() => onNavigate('home')}>工作台</button>
        <button className={page === 'library' ? 'active' : ''} onClick={() => onNavigate('library')}>素材库</button>
        <button onClick={() => void window.taVideo.open()}>录屏与剪辑</button>
        <button className={page === 'settings' ? 'active' : ''} onClick={() => onNavigate('settings')}>设置</button>
      </nav>
      <div className="titlebar-actions">
        <button
          type="button"
          className="theme-toggle"
          data-testid="theme-toggle"
          aria-label={`切换为${theme === 'dark' ? '瓷白' : '夜幕'}主题`}
          aria-pressed={theme === 'light'}
          aria-busy={themeBusy}
          disabled={themeBusy}
          title={`当前：${theme === 'light' ? '瓷白典藏' : '夜幕玻璃'}主题`}
          onClick={onThemeToggle}
        >
          <span className="theme-toggle-track" aria-hidden="true"><i>{theme === 'light' ? '☀' : '☾'}</i></span>
          <b>{theme === 'light' ? '瓷白' : '夜幕'}</b>
        </button>
        <div className="window-controls">
          <button aria-label="最小化" onClick={() => window.ta.windowMinimize()}>—</button>
          <button aria-label="最大化" onClick={() => window.ta.windowToggleMaximize()}>□</button>
          <button aria-label="关闭" className="close" onClick={() => window.ta.windowClose()}>×</button>
        </div>
      </div>
    </header>
  )
}

function HotkeyRecorder({ action, title, glyph, value, conflictReason, onChange }: {
  action: CaptureAction
  title: string
  glyph: string
  value: string
  conflictReason?: string
  onChange(value: string): void
}) {
  const [recording, setRecording] = useState(false)
  const [feedback, setFeedback] = useState('')
  const stopRecording = () => {
    setRecording(false)
    window.ta.setHotkeyRecording(false)
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const result = captureHotkey(event.nativeEvent)
    if (result.type === 'wait') {
      setFeedback('继续按下字母、数字或功能键…')
      return
    }
    if (result.type === 'invalid') {
      setFeedback(result.reason)
      return
    }
    if (result.type === 'capture') onChange(result.accelerator)
    if (result.type === 'clear') onChange('')
    setFeedback('')
    event.currentTarget.blur()
  }
  const conflict = Boolean(conflictReason)
  return <label className={`${recording ? 'recording' : ''}${conflict ? ' conflict' : ''}`} data-hotkey-action={action}>
    <span><i>{glyph}</i><b>{title}</b></span>
    <input
      readOnly
      aria-label={`${title}快捷键`}
      aria-invalid={conflict}
      value={recording ? '请直接按下组合键…' : formatAccelerator(value)}
      placeholder="未启用"
      onFocus={() => {
        setRecording(true)
        setFeedback('录制中：Esc 取消，Backspace 清空')
        window.ta.setHotkeyRecording(true)
      }}
      onBlur={stopRecording}
      onKeyDown={onKeyDown}
    />
    <em className="hotkey-feedback">{conflictReason || feedback || '\u00a0'}</em>
  </label>
}

function Home({ history, hotkeys, onCapture, onOpenHistory, onDeleteHistory, onLibrary, onSettings }: {
  history: HistoryItem[]
  hotkeys?: AppSettings['hotkeys']
  onCapture(action: CaptureAction): void
  onOpenHistory(id: string): void
  onDeleteHistory(id: string): void
  onLibrary(): void
  onSettings(): void
}) {
  return (
    <div className="page home-page">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span /> AI 原生截图工具 · Windows</div>
          <h1>框住它，<em>拓下来。</em></h1>
          <p>截图、取字、翻译、钉图与标注，不再散落在五六个软件里。</p>
          <div className="hero-actions">
            <button className="capture-button" onClick={() => onCapture('capture')}><span>⌗</span><b>开始截图</b><kbd>{formatAccelerator(hotkeys?.capture ?? windowsDefaultHotkeys.capture) || '未启用'}</kbd></button>
            <button className="quiet-button" onClick={() => onCapture('ocr')}>极速取字</button>
          </div>
        </div>
        <div className="hero-mark" aria-hidden="true"><span>拓</span><i>TA · WINDOWS</i></div>
      </section>

      <section className="section actions-section">
        <div className="section-heading"><div><span>01</span><h2>快速开始</h2></div><p>也可以在任意应用中直接按全局快捷键</p></div>
        <div className="action-grid">
          {actionCopy.map((item) => (
            <button key={item.action} className="action-card" data-capture-action={item.action} onClick={() => onCapture(item.action)}>
              <span className="action-glyph">{item.glyph}</span>
              <span className="action-copy"><b>{item.title}</b><small>{item.description}</small></span>
              <kbd>{formatAccelerator(hotkeys?.[item.action] ?? windowsDefaultHotkeys[item.action]) || '未启用'}</kbd>
            </button>
          ))}
        </div>
      </section>

      <section className="section history-section">
        <div className="section-heading"><div><span>02</span><h2>最近拓片</h2></div><p>按日期长期保存在本机 · <button className="inline-link" onClick={onLibrary}>查看全部</button></p></div>
        {history.length ? (
          <div className="history-grid">
            {history.slice(0, 8).map((item) => (
              <article className="history-card" key={item.id}>
                <button
                  className="history-preview"
                  title="右键可复制或下载"
                  onClick={() => onOpenHistory(item.id)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void window.ta.showImageContextMenu({ kind: 'history', historyId: item.id, suggestedName: item.title })
                  }}
                ><img src={item.thumbnailUrl} alt={actionNames[item.action]} /></button>
                <div><span><b>{actionNames[item.action]}</b><small>{formatDate(item.createdAt)} · {item.width}×{item.height}</small></span><button title="删除" onClick={() => onDeleteHistory(item.id)}>×</button></div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-history"><span>拓</span><div><b>还没有拓片</b><p>按 Ctrl + Shift + 2 截下第一张，也可以在素材库明确粘贴或导入图片。</p></div></div>
        )}
      </section>

      <aside className="privacy-strip"><span>本地优先</span><p>截图与 OCR 默认离线处理；只有你主动使用 AI 识图或翻译时，内容才会发送到已配置的服务。</p><button onClick={onSettings}>查看隐私与模型设置 →</button></aside>
    </div>
  )
}

function SettingsPage({ settings, hotkeyStatus, onSave }: { settings?: AppSettings; hotkeyStatus: Record<string, boolean>; onSave(value: AppSettings & { apiKeys?: Record<string, string>; clearApiKeys?: string[] }): Promise<void> }) {
  const [draft, setDraft] = useState<AppSettings>()
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  useEffect(() => { if (settings) setDraft(structuredClone(settings)) }, [settings])
  useEffect(() => () => window.ta.setHotkeyRecording(false), [])
  const duplicateHotkeys = useMemo(() => duplicateAccelerators(draft?.hotkeys ?? {}), [draft?.hotkeys])
  if (!draft) return <div className="page loading-page">正在读取设置…</div>
  const active = draft.providers.find((provider) => provider.id === draft.activeProviderId)!
  const effective = settings?.providers.find((provider) => provider.id === settings.activeProviderId)
  const routePending = draft.activeProviderId !== settings?.activeProviderId
  const updateActive = (updates: Partial<typeof active>) => setDraft({ ...draft, providers: draft.providers.map((provider) => provider.id === active.id ? { ...provider, ...updates } : provider) })

  const save = async () => {
    if (duplicateHotkeys.size) return
    setSaving(true); setSaved(false); setSaveError('')
    try { await onSave({ ...draft, apiKeys }); setApiKeys({}); setSaved(true); setTimeout(() => setSaved(false), 2200) }
    catch (error) { setSaveError(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }

  return (
    <div className="page settings-page">
      <div className="page-intro"><div className="eyebrow"><span /> 个性化与隐私</div><h1>设置</h1><p>让快捷键、模型与长截图方式贴合你的习惯。</p></div>
      <div className="settings-layout">
        <aside className="settings-index"><a href="#models">01 模型服务</a><a href="#hotkeys">02 快捷键</a><a href="#capture">03 截图行为</a><a href="#library-settings">04 自动收集与存储</a><a href="#general">05 常规</a></aside>
        <div className="settings-content">
          <section id="models" className="settings-panel">
            <header><span>01</span><div><h2>模型服务</h2><p>AI Key 使用 Windows 安全加密后保存在本机。</p></div></header>
            <div className="provider-tabs">{draft.providers.map((provider) => <button key={provider.id} className={provider.id === active.id ? 'active' : ''} onClick={() => setDraft({ ...draft, activeProviderId: provider.id })}><i />{provider.name}{provider.id === settings?.activeProviderId && <em>当前</em>}</button>)}</div>
            <div className={`provider-route ${routePending ? 'pending' : ''}`}>
              <span>{routePending ? '保存后使用' : '当前 AI 路由'}</span>
              <strong>{active.name} · {active.model}</strong>
              <p>AI 识图与截图翻译使用这个服务；极速取字使用本地 OCR，截图、长截图、标注和美化不调用云端模型。</p>
              {routePending && effective && <small>现在仍在使用：{effective.name} · {effective.model}</small>}
            </div>
            <div className="form-grid">
              <label><span>接口协议</span><select value={active.kind} onChange={(event) => updateActive({ kind: event.target.value as typeof active.kind })}><option value="openai">OpenAI Compatible</option><option value="anthropic">Anthropic</option><option value="gemini">Google Gemini</option></select></label>
              <label><span>模型名称</span><input value={active.model} onChange={(event) => updateActive({ model: event.target.value })} /></label>
              <label className="wide"><span>Base URL</span><input value={active.baseUrl} onChange={(event) => updateActive({ baseUrl: event.target.value })} /></label>
              <label className="wide"><span>API Key</span><input type="password" value={apiKeys[active.id] ?? ''} placeholder={active.hasApiKey ? '已安全保存；留空表示不修改' : '输入后将使用 Windows 安全加密'} onChange={(event) => setApiKeys({ ...apiKeys, [active.id]: event.target.value })} /></label>
            </div>
            <div className="privacy-choice"><label><input type="checkbox" checked={draft.cloudUploadConfirmation} onChange={(event) => setDraft({ ...draft, cloudUploadConfirmation: event.target.checked })} /><span><b>每次云端识图前确认</b><small>避免误把含敏感信息的截图发给第三方模型。</small></span></label></div>
          </section>

          <section id="hotkeys" className="settings-panel">
            <header><span>02</span><div><h2>全局快捷键</h2><p>点击输入框后直接按下组合键，Ta 会自动识别；无需手写快捷键语法。</p></div><button className="hotkey-reset" onClick={() => setDraft({ ...draft, hotkeys: { ...windowsDefaultHotkeys } })}>恢复 Windows 默认值</button></header>
            <div className="hotkey-list">{actionCopy.map((item) => {
              const unavailable = Boolean(draft.hotkeys[item.action])
                && draft.hotkeys[item.action] === settings?.hotkeys[item.action]
                && hotkeyStatus[item.action] === false
              return <HotkeyRecorder
                key={item.action}
                action={item.action}
                title={item.title}
                glyph={item.glyph}
                value={draft.hotkeys[item.action]}
                conflictReason={duplicateHotkeys.has(item.action) ? '与其他功能重复，请重新录制' : unavailable ? '该组合键已被 Windows 或其他软件占用' : undefined}
                onChange={(value) => setDraft({ ...draft, hotkeys: { ...draft.hotkeys, [item.action]: value } })}
              />
            })}</div>
            <p className="hotkey-help">Windows 默认：极速取字 Ctrl + Shift + 1，通用截图 Ctrl + Shift + 2，其余功能依次为 3–6。F1–F24 可单独使用；普通字母和数字需搭配 Ctrl、Alt、Shift 或 Win，避免影响日常输入。</p>
            <p className="hotkey-help">全局唤起：Ctrl + F1 打开主页面，Ctrl + F2 打开录屏页面。关闭主窗口后仍可使用；从托盘彻底退出软件后不可用。</p>
            {(hotkeyStatus.openHome === false || hotkeyStatus.openVideo === false) && <p className="hotkey-help" role="alert">{hotkeyStatus.openHome === false ? 'Ctrl + F1 ' : ''}{hotkeyStatus.openVideo === false ? 'Ctrl + F2 ' : ''}未能注册，可能已被其他软件或截图快捷键占用。请解除占用后重新保存设置。</p>}
          </section>

          <section id="capture" className="settings-panel">
            <header><span>03</span><div><h2>截图与翻译</h2><p>只控制拓 Ta 自身是否出现在截图里；其他软件始终保持原样。</p></div></header>
            <div className="form-grid">
              <label className="wide"><span>开始截图时如何处理拓 Ta 窗口</span><select data-testid="capture-window-policy" value={draft.captureWindowPolicy} onChange={(event) => setDraft({ ...draft, captureWindowPolicy: event.target.value as AppSettings['captureWindowPolicy'] })}><option value="hide-ta">自动隐藏拓 Ta（推荐）</option><option value="keep-ta">保留拓 Ta 当前窗口</option><option value="ask">每次截图时询问</option></select><small className="field-help">“每次询问”会在截图前让你临时选择隐藏、保留或取消；不会最小化或隐藏任何其他应用。</small></label>
              <label className="wide setting-checkbox"><span>智能框选</span><span className="checkbox-line"><input data-testid="smart-selection-enabled" type="checkbox" checked={draft.smartSelectionEnabled} onChange={(event) => setDraft({ ...draft, smartSelectionEnabled: event.target.checked })} /><b>自动识别鼠标下的窗口边框</b></span><small className="field-help">默认开启。移动鼠标预选窗口，单击锁定；按住拖动仍可自由框选。</small></label>
              <label><span>源语言</span><select value={draft.sourceLanguage} onChange={(event) => setDraft({ ...draft, sourceLanguage: event.target.value })}><option value="auto">自动检测</option><option value="简体中文">简体中文</option><option value="English">English</option><option value="日本語">日本語</option></select></label>
              <label><span>目标语言</span><select value={draft.targetLanguage} onChange={(event) => setDraft({ ...draft, targetLanguage: event.target.value })}><option>简体中文</option><option>English</option><option>日本語</option><option>繁體中文</option></select></label>
              <label><span>长截图最大帧数</span><input type="number" min="3" max="30" value={draft.longCaptureMaxFrames} onChange={(event) => setDraft({ ...draft, longCaptureMaxFrames: Number(event.target.value) })} /></label>
              <label><span>滚动等待（毫秒）</span><input type="number" min="300" max="2500" step="50" value={draft.longCaptureDelayMs} onChange={(event) => setDraft({ ...draft, longCaptureDelayMs: Number(event.target.value) })} /></label>
            </div>
          </section>

          <section id="library-settings" className="settings-panel">
            <header><span>04</span><div><h2>自动收集与存储</h2><p>让指定软件的截图直接进入拓；普通复制默认不会被收集。</p></div></header>
            <div className="storage-setting">
              <label><span>素材保存路径</span><input readOnly value={draft.storageRoot} title={draft.storageRoot} /></label>
              <div><button type="button" className="quiet-button" onClick={() => void window.ta.chooseStorageRoot().then((result) => { if (!result.canceled && result.rootDirectory) setDraft({ ...draft, storageRoot: result.rootDirectory }) })}>选择位置</button><button type="button" className="quiet-button" onClick={() => void window.ta.openStorageRoot()}>打开当前目录</button></div>
              <small>保存后会把现有素材安全复制到新位置并核验；旧文件保留，避免误删。图片按 年 / 月 / 日 自动归档，数量不设上限。</small>
            </div>
            <div className="external-capture-settings">
              <label className="external-master"><span><b>外部截图自动进入拓</b><small>仅在拓正在运行时生效；关闭后不会读取外部图片。</small></span><input type="checkbox" checked={draft.externalCapture.enabled} onChange={(event) => setDraft({ ...draft, externalCapture: { ...draft.externalCapture, enabled: event.target.checked } })} /></label>
              {([
                ['feishu', '飞书', '严格模式识别默认截图快捷键与可信飞书进程'],
                ['weixin', '微信', '只接收通过微信截图产生的图片'],
                ['qq', 'QQ', '严格模式识别 QQ 专用截图进程，并排除 QQ 浏览器'],
              ] as const).map(([appId, appName, description]) => {
                const rule = draft.externalCapture.apps[appId]
                return <div className={`external-app-rule${draft.externalCapture.enabled ? '' : ' disabled'}`} key={appId}>
                  <label><span><b>{appName}</b><small>{description}</small></span><input type="checkbox" disabled={!draft.externalCapture.enabled} checked={rule.enabled} onChange={(event) => setDraft({ ...draft, externalCapture: { ...draft.externalCapture, apps: { ...draft.externalCapture.apps, [appId]: { ...rule, enabled: event.target.checked } } } })} /></label>
                  <span className="external-strict-badge">仅收集截图</span>
                </div>
              })}
              <p className="capture-privacy-note">“只收集截图”会核验进程路径、软件身份、数字签名与截图专用格式，识别不确定时不保存；仍可在素材库点击粘贴区后 Ctrl + V 手动加入。</p>
            </div>
          </section>

          <section id="general" className="settings-panel">
            <header><span>05</span><div><h2>常规</h2><p>关闭主窗口后仍驻留系统托盘，快捷键和已开启的外部截图收集继续可用。</p></div></header>
            <div className="toggle-list"><label><span><b>开机自动启动</b><small>登录 Windows 后自动运行拓 Ta</small></span><input type="checkbox" checked={draft.autoLaunch} onChange={(event) => setDraft({ ...draft, autoLaunch: event.target.checked })} /></label><label><span><b>启动时最小化</b><small>不显示主窗口，只驻留系统托盘</small></span><input type="checkbox" checked={draft.launchMinimized} onChange={(event) => setDraft({ ...draft, launchMinimized: event.target.checked })} /></label></div>
          </section>
        </div>
      </div>
      <div className="settings-save"><span className={saveError ? 'save-error' : ''}>{duplicateHotkeys.size ? '存在重复快捷键，请先重新录制' : saveError || (saved ? '设置已保存并生效' : '修改仅在点击保存后生效')}</span><button className="button-primary" disabled={saving || duplicateHotkeys.size > 0} onClick={save}>{saving ? '保存中…' : '保存设置'}</button></div>
    </div>
  )
}

function beautifyImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const padding = Math.round(Math.max(56, Math.min(140, image.width * 0.09)))
      const canvas = document.createElement('canvas')
      canvas.width = image.width + padding * 2
      canvas.height = image.height + padding * 2
      const context = canvas.getContext('2d')!
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
      gradient.addColorStop(0, '#efe4d0'); gradient.addColorStop(0.46, '#fbf7ed'); gradient.addColorStop(1, '#d8c1a6')
      context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = 'rgba(109, 84, 52, 0.045)'
      for (let x = 0; x < canvas.width; x += 11) for (let y = (x % 17); y < canvas.height; y += 17) context.fillRect(x, y, 1, 1)
      context.shadowColor = 'rgba(54, 36, 18, .26)'; context.shadowBlur = Math.round(padding * .38); context.shadowOffsetY = Math.round(padding * .16)
      context.drawImage(image, padding, padding)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('无法读取截图。'))
    image.src = dataUrl
  })
}

function ResultPage({ result, settings, onBack, notify }: { result?: CaptureResult; settings?: AppSettings; onBack(): void; notify(notice: Notice): void }) {
  const [current, setCurrent] = useState(result)
  const [panel, setPanel] = useState<ResultTool>()
  const [toolCache, setToolCache] = useState(createResultToolCache)
  const toolCacheRef = useRef(toolCache)
  const requestSequence = useRef(0)
  const [editing, setEditing] = useState(false)
  const activeProvider = settings?.providers.find((provider) => provider.id === settings.activeProviderId)
  useEffect(() => setCurrent(result), [result])
  useEffect(() => {
    const empty = createResultToolCache()
    toolCacheRef.current = empty
    setToolCache(empty)
    setPanel(undefined)
  }, [result?.id])

  const updateToolCache = (next: ReturnType<typeof createResultToolCache>) => {
    toolCacheRef.current = next
    setToolCache(next)
  }
  const runTool = async (tool: ResultTool, force = false) => {
    if (!current) return
    setPanel(tool)
    if (!shouldRunTool(toolCacheRef.current[tool], force)) return
    const requestId = ++requestSequence.current
    updateToolCache(beginToolRun(toolCacheRef.current, tool, requestId))
    try {
      if (tool === 'ocr') {
        const value = await window.ta.runOCR(current.imageDataUrl)
        updateToolCache(completeToolRun(toolCacheRef.current, tool, requestId, value.text || '没有识别到文字。', value))
      } else {
        const value = await window.ta.runAI(tool === 'ai' ? 'vision' : 'translate', current.imageDataUrl)
        updateToolCache(completeToolRun(toolCacheRef.current, tool, requestId, value.trim() || '没有返回可显示内容。'))
      }
    } catch (error) {
      updateToolCache(failToolRun(toolCacheRef.current, tool, requestId, error))
    }
  }
  useEffect(() => {
    if (!current) return
    if (current.action === 'ocr') void runTool('ocr')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])
  useEffect(() => {
    if (current?.action === 'translate' && settings) void runTool('translate')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, Boolean(settings)])

  const commit = async (dataUrl: string, action: 'edited' | 'beautified') => {
    const next = await window.ta.commitImage(dataUrl, action)
    const empty = createResultToolCache()
    toolCacheRef.current = empty
    setToolCache(empty)
    setPanel(undefined)
    setCurrent(next); setEditing(false); notify({ message: action === 'edited' ? '标注已保存到历史记录' : '美化图片已生成', tone: 'success' })
  }
  if (!current) return <div className="page loading-page">正在准备截图…</div>
  if (editing) return <Editor imageDataUrl={current.imageDataUrl} onCancel={() => setEditing(false)} onExport={(dataUrl) => void commit(dataUrl, 'edited')} />

  return (
    <div className="result-page">
      <div className="result-toolbar">
        <button className="back-button" onClick={onBack}>← 返回</button><span className="result-divider" />
        <button onClick={() => { void window.ta.copyImage(current.imageDataUrl); notify({ message: '图片已复制', tone: 'success' }) }}>叠 复制</button>
        <button onClick={() => void window.ta.saveImage(current.imageDataUrl)}>⇩ 保存</button>
        <button onClick={() => void window.ta.pinImage(current.imageDataUrl)}>钉 钉图</button>
        <span className="result-divider" />
        <button className={`${panel === 'ocr' ? 'active' : ''}${toolCache.ocr.status === 'success' ? ' has-cache' : ''}`} onClick={() => void runTool('ocr')}>文 取字</button>
        <button title={activeProvider ? `使用 ${activeProvider.name} · ${activeProvider.model}` : '使用设置中的当前模型'} className={`${panel === 'ai' ? 'active' : ''}${toolCache.ai.status === 'success' ? ' has-cache' : ''}`} onClick={() => void runTool('ai')}>✦ AI 识图</button>
        <button title={activeProvider ? `使用 ${activeProvider.name} · ${activeProvider.model}` : '使用设置中的当前模型'} className={`${panel === 'translate' ? 'active' : ''}${toolCache.translate.status === 'success' ? ' has-cache' : ''}`} onClick={() => void runTool('translate')}>译 翻译</button>
        <button onClick={() => setEditing(true)}>✎ 标注</button>
        <button onClick={() => void beautifyImage(current.imageDataUrl).then((dataUrl) => commit(dataUrl, 'beautified'))}>◇ 美化</button>
        <span className="result-meta">{current.width} × {current.height}</span>
      </div>
      <div className={`result-workspace ${panel ? 'with-panel' : ''}`}>
        <div className="result-canvas"><div className="image-mat"><img
          src={current.imageDataUrl}
          alt="截图结果"
          title="右键可复制或下载"
          onContextMenu={(event) => {
            event.preventDefault()
            void window.ta.showImageContextMenu({ kind: 'data-url', imageDataUrl: current.imageDataUrl, suggestedName: '截图结果' })
          }}
        /></div></div>
        {panel && (() => {
          const entry = toolCache[panel]
          const loading = entry.status === 'loading'
          const cached = entry.status === 'success'
          return <aside className="result-panel"><header><div><span>{panel === 'ocr' ? 'OCR' : panel === 'ai' ? 'AI' : '译'}</span><div><b>{panel === 'ocr' ? '本地取字' : panel === 'ai' ? 'AI 识图' : '截图翻译'}</b><small>{panel === 'ocr' ? (entry.ocrMeta ? `${entry.ocrMeta.language} · 置信度 ${entry.ocrMeta.confidence}%` : '本地 Tesseract · 不上传') : activeProvider ? `${activeProvider.name} · ${activeProvider.model}` : '使用设置中的当前模型'}</small></div></div><button onClick={() => setPanel(undefined)}>×</button></header><div className={`panel-content ${loading ? 'loading' : ''}${entry.status === 'error' ? ' error' : ''}`}>{loading ? <><i /><p>{panel === 'ocr' ? '离线模型正在识别…' : `正在调用 ${activeProvider?.name ?? '当前模型服务'}…`}</p></> : <pre>{entry.text}</pre>}</div>{!loading && entry.status !== 'idle' && <footer><span className={`cache-note ${cached ? 'saved' : ''}`}>{cached ? '✓ 已保留在本次截图' : entry.status === 'canceled' ? '本次没有发送图片' : '处理未完成'}</span><div><button className="rerun-button" onClick={() => void runTool(panel, true)}>重新识别</button>{cached && entry.text && <button className="copy-result-button" onClick={() => void window.ta.copyText(entry.text).then(() => notify({ message: '文字已复制', tone: 'success' }))}>复制文字</button>}</div></footer>}</aside>
        })()}
      </div>
    </div>
  )
}

export function App({ initialRoute }: { initialRoute?: string }) {
  const [page, setPage] = useState<Page>((['home', 'library', 'settings', 'result'].includes(initialRoute ?? '') ? initialRoute : 'home') as Page)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [libraryAssets, setLibraryAssets] = useState<HistoryItem[]>([])
  const [libraryFilter, setLibraryFilter] = useState<AssetFilter>({ search: '', date: '' })
  const libraryFilterRef = useRef<AssetFilter>({ search: '', date: '' })
  const libraryRequestSequence = useRef(0)
  const [libraryCursor, setLibraryCursor] = useState<string>()
  const [libraryTotal, setLibraryTotal] = useState(0)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryLoadingMore, setLibraryLoadingMore] = useState(false)
  const [libraryError, setLibraryError] = useState<string>()
  const [libraryStats, setLibraryStats] = useState<LibraryStats>()
  const [settings, setSettings] = useState<AppSettings>()
  const [themeFallback, setThemeFallback] = useState<AppSettings['theme']>(cachedTheme)
  const [themeBusy, setThemeBusy] = useState(false)
  const [result, setResult] = useState<CaptureResult>()
  const [version, setVersion] = useState('1.4.0')
  const [notice, setNotice] = useState<Notice>()
  const [hotkeyStatus, setHotkeyStatus] = useState<Record<string, boolean>>({})

  const refreshHistory = () => window.ta.getHistory().then(setHistory)
  const loadLibrary = async (reset = true, filter = libraryFilterRef.current) => {
    const requestId = reset ? ++libraryRequestSequence.current : libraryRequestSequence.current
    if (reset) setLibraryLoading(true); else setLibraryLoadingMore(true)
    setLibraryError(undefined)
    try {
      const query: LibraryListQuery = { limit: 60, search: filter.search, date: filter.date || undefined }
      if (!reset && libraryCursor) query.cursor = libraryCursor
      const [response, stats] = await Promise.all([window.ta.listAssets(query), window.ta.getLibraryStats()])
      if (requestId !== libraryRequestSequence.current) return
      setLibraryAssets((current) => reset ? response.items : [...current, ...response.items])
      setLibraryCursor(response.nextCursor)
      setLibraryTotal(response.totalCount)
      setLibraryStats(stats)
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestId === libraryRequestSequence.current) { setLibraryLoading(false); setLibraryLoadingMore(false) }
    }
  }
  useEffect(() => {
    void refreshHistory(); void loadLibrary(); void window.ta.getSettings().then((value) => { setSettings(value); setThemeFallback(value.theme); cacheTheme(value.theme) }); void window.ta.getAppInfo().then((info) => setVersion(info.version))
    if (page === 'result') void window.ta.getResult().then(setResult)
    const unsubscribeHotkeys = window.ta.onHotkeyStatus(setHotkeyStatus)
    const unsubscribeHistory = window.ta.onHistoryChanged(setHistory)
    const unsubscribeLibrary = window.ta.onLibraryChanged(() => { void refreshHistory(); void loadLibrary(true) })
    const unsubscribeNavigation = window.ta.onNavigate((payload) => {
      setNotice(undefined)
      setPage(payload.route)
      window.history.replaceState(null, '', `#/${payload.route}`)
      if (payload.route === 'home') void refreshHistory()
      if (payload.route === 'library') void loadLibrary(true)
      if (payload.route === 'result') {
        if (payload.result) setResult(payload.result)
        else void window.ta.getResult().then(setResult)
      }
    })
    return () => { unsubscribeHotkeys(); unsubscribeHistory(); unsubscribeLibrary(); unsubscribeNavigation() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(undefined), 2600); return () => window.clearTimeout(timer) }, [notice])

  const navigate = (next: Page) => {
    setNotice(undefined)
    setPage(next)
    window.history.replaceState(null, '', `#/${next}`)
    if (next === 'home') void refreshHistory()
    if (next === 'library') void loadLibrary(true)
  }
  const capture = async (action: CaptureAction) => {
    try { await window.ta.startCapture(action) } catch (error) { setNotice({ message: error instanceof Error ? error.message : String(error), tone: 'error' }) }
  }
  const saveSettings = async (value: AppSettings & { apiKeys?: Record<string, string>; clearApiKeys?: string[] }) => {
    const response = await window.ta.saveSettings(value)
    setSettings(response.settings); setHotkeyStatus(response.hotkeyStatus); setNotice({ message: '设置已保存', tone: 'success' })
  }
  const toggleTheme = async () => {
    if (!settings || themeBusy) return
    const previous = settings
    const next = { ...settings, theme: settings.theme === 'light' ? 'dark' as const : 'light' as const }
    setThemeBusy(true)
    setSettings(next)
    setThemeFallback(next.theme)
    cacheTheme(next.theme)
    try {
      const response = await window.ta.saveSettings(next)
      setSettings(response.settings)
      setThemeFallback(response.settings.theme)
      cacheTheme(response.settings.theme)
      setHotkeyStatus(response.hotkeyStatus)
    } catch (error) {
      setSettings(previous)
      setThemeFallback(previous.theme)
      cacheTheme(previous.theme)
      setNotice({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
    } finally {
      setThemeBusy(false)
    }
  }
  const openAsset = (id: string) => void window.ta.openHistory(id).then((value) => { setResult(value); navigate('result') }).catch((error) => setNotice({ message: error instanceof Error ? error.message : String(error), tone: 'error' }))
  const refreshLibrary = () => loadLibrary(true, libraryFilter)
  const exportLibrarySelection = async (selection: AssetExportSelection) => {
    try {
      const response = await window.ta.exportAssets(selection)
      if (!response.canceled) setNotice({ message: `已导出 ${response.exportedCount} 张图片${response.missingIds.length ? `，${response.missingIds.length} 张已不存在` : ''}`, tone: 'success' })
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
    }
  }
  const assetViews: AssetView[] = libraryAssets.map((item) => ({
    id: item.id,
    name: item.title,
    createdAt: item.createdAt,
    dateKey: item.dateKey,
    width: item.width,
    height: item.height,
    thumbnailUrl: item.thumbnailUrl,
    source: item.source,
    sourceApp: item.sourceApp,
  }))
  const content = useMemo(() => {
    if (page === 'settings') return <SettingsPage settings={settings} hotkeyStatus={hotkeyStatus} onSave={saveSettings} />
    if (page === 'result') return <ResultPage result={result} settings={settings} onBack={() => navigate('home')} notify={setNotice} />
    if (page === 'library') return <LibraryPage
      assets={assetViews}
      loading={libraryLoading}
      error={libraryError}
      migrationWarning={libraryStats?.legacyMigration?.failed ? libraryStats.legacyMigration : undefined}
      totalCount={libraryTotal}
      hasMore={Boolean(libraryCursor)}
      loadingMore={libraryLoadingMore}
      onLoadMore={() => loadLibrary(false, libraryFilter)}
      onFilterChange={(filter) => { libraryFilterRef.current = filter; setLibraryFilter(filter); void loadLibrary(true, filter) }}
      onPasteImages={async () => { const response = await window.ta.pasteClipboardImage(); setNotice({ message: response.created ? '图片已粘贴到素材库' : '相同图片刚刚已经收集', tone: 'success' }); await refreshLibrary() }}
      onImport={async () => { try { const response = await window.ta.importImages(); if (!response.canceled) { setNotice({ message: `已导入 ${response.imported.length} 张图片${response.failed.length ? `，${response.failed.length} 张失败` : ''}`, tone: response.failed.length ? 'error' : 'success' }); await refreshLibrary() } } catch (error) { setNotice({ message: error instanceof Error ? error.message : String(error), tone: 'error' }) } }}
      onOpenStorageLocation={async () => { try { await window.ta.openStorageRoot() } catch (error) { setNotice({ message: error instanceof Error ? error.message : String(error), tone: 'error' }) } }}
      onOpen={openAsset}
      onRename={async (id, name) => { try { await window.ta.renameAsset(id, name); await refreshLibrary() } catch (error) { setNotice({ message: error instanceof Error ? error.message : String(error), tone: 'error' }); throw error } }}
      onDelete={async (id) => { if (!window.confirm('确定从素材库删除这张图片吗？原图会移入 Windows 回收站。')) return; try { await window.ta.deleteAssets([id]); await refreshLibrary() } catch (error) { setNotice({ message: error instanceof Error ? error.message : String(error), tone: 'error' }) } }}
      onExport={exportLibrarySelection}
      onRetry={refreshLibrary}
      onRetryMigration={async () => {
        try {
          const migration = await window.ta.retryLegacyMigration()
          setNotice({ message: migration?.failed ? `仍有 ${migration.failed} 条旧截图无法迁移` : '旧版截图迁移已完成', tone: migration?.failed ? 'error' : 'success' })
          await refreshLibrary()
        } catch (error) {
          setNotice({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
        }
      }}
    />
    return <Home history={history} hotkeys={settings?.hotkeys} onCapture={capture} onOpenHistory={openAsset} onDeleteHistory={(id) => { if (window.confirm('确定删除这张图片吗？原图会移入 Windows 回收站。')) void window.ta.deleteHistory(id).then(refreshHistory).catch((error) => setNotice({ message: error instanceof Error ? error.message : String(error), tone: 'error' })) }} onLibrary={() => navigate('library')} onSettings={() => navigate('settings')} />
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, history, settings, result, hotkeyStatus, libraryAssets, libraryLoading, libraryError, libraryStats, libraryTotal, libraryCursor, libraryLoadingMore, libraryFilter])

  const theme = settings?.theme ?? themeFallback
  return <main className="app-shell" data-page={page} data-theme={theme}><TitleBar page={page} version={version} theme={theme} themeBusy={themeBusy} onNavigate={navigate} onThemeToggle={toggleTheme} />{content}{notice && <div className={`toast ${notice.tone ?? ''}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}><span>{notice.tone === 'error' ? '!' : '✓'}</span>{notice.message}</div>}</main>
}
