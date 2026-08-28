export interface HotkeyEventLike {
  code: string
  key: string
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export type HotkeyCaptureResult =
  | { type: 'capture'; accelerator: string }
  | { type: 'wait' }
  | { type: 'cancel' }
  | { type: 'clear' }
  | { type: 'invalid'; reason: string }

const modifierCodes = new Set([
  'AltLeft', 'AltRight', 'ControlLeft', 'ControlRight',
  'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight',
])

const namedKeys: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
  Backspace: 'Backspace',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
}

function acceleratorKey(event: HotkeyEventLike) {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(event.code)) return event.code
  if (/^Numpad[0-9]$/.test(event.code)) return `num${event.code.slice(6)}`
  return namedKeys[event.code]
}

export function captureHotkey(event: HotkeyEventLike): HotkeyCaptureResult {
  if (event.code === 'Escape') return { type: 'cancel' }
  const hasModifier = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey
  if (!hasModifier && (event.code === 'Backspace' || event.code === 'Delete')) return { type: 'clear' }
  if (modifierCodes.has(event.code)) return { type: 'wait' }
  const key = acceleratorKey(event)
  if (!key) return { type: 'invalid', reason: '这个按键暂不支持，请使用字母、数字、F1–F24、方向键或常用功能键。' }
  if (!hasModifier && !/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) {
    return { type: 'invalid', reason: '请至少按住 Ctrl、Alt、Shift 或 Win。' }
  }
  const modifiers = [
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Super' : '',
  ].filter(Boolean)
  return { type: 'capture', accelerator: [...modifiers, key].join('+') }
}

const displayNames: Record<string, string> = {
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Win',
  meta: 'Win',
  command: 'Win',
  cmd: 'Win',
}

export function formatAccelerator(accelerator: string) {
  if (!accelerator) return ''
  return accelerator.split('+').map((part) => displayNames[part.trim().toLowerCase()] ?? part.trim()).join(' + ')
}

function canonicalAccelerator(accelerator: string) {
  const tokens = accelerator.split('+').map((part) => part.trim().toLowerCase()).filter(Boolean)
  const aliases: Record<string, string> = {
    commandorcontrol: 'ctrl',
    cmdorctrl: 'ctrl',
    control: 'ctrl',
    option: 'alt',
    meta: 'super',
    command: 'super',
    cmd: 'super',
  }
  const normalized = tokens.map((token) => aliases[token] ?? token)
  const order = ['ctrl', 'alt', 'shift', 'super']
  normalized.sort((left, right) => {
    const leftIndex = order.indexOf(left)
    const rightIndex = order.indexOf(right)
    if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex)
    return left.localeCompare(right)
  })
  return normalized.join('+')
}

export function duplicateAccelerators(hotkeys: Record<string, string>) {
  const actionsByAccelerator = new Map<string, string[]>()
  for (const [action, accelerator] of Object.entries(hotkeys)) {
    if (!accelerator.trim()) continue
    const canonical = canonicalAccelerator(accelerator)
    actionsByAccelerator.set(canonical, [...(actionsByAccelerator.get(canonical) ?? []), action])
  }
  return new Set([...actionsByAccelerator.values()].filter((actions) => actions.length > 1).flat())
}
