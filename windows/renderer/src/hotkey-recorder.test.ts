import { describe, expect, it } from 'vitest'
import { captureHotkey, duplicateAccelerators, formatAccelerator } from './hotkey-recorder'

describe('Windows 快捷键录制', () => {
  it('把真实键盘事件转换为 Electron accelerator', () => {
    expect(captureHotkey({ code: 'F1', key: 'F1', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false })).toEqual({ type: 'capture', accelerator: 'Alt+F1' })
    expect(captureHotkey({ code: 'Digit2', key: '@', altKey: false, ctrlKey: true, shiftKey: true, metaKey: false })).toEqual({ type: 'capture', accelerator: 'Ctrl+Shift+2' })
  })

  it('等待完整组合键，并允许取消或清空', () => {
    expect(captureHotkey({ code: 'ControlLeft', key: 'Control', altKey: false, ctrlKey: true, shiftKey: false, metaKey: false })).toEqual({ type: 'wait' })
    expect(captureHotkey({ code: 'Escape', key: 'Escape', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false })).toEqual({ type: 'cancel' })
    expect(captureHotkey({ code: 'Backspace', key: 'Backspace', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false })).toEqual({ type: 'clear' })
  })

  it('拒绝会劫持普通输入的无修饰字母，并格式化 Windows 显示名称', () => {
    expect(captureHotkey({ code: 'KeyA', key: 'a', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false })).toEqual({ type: 'invalid', reason: '请至少按住 Ctrl、Alt、Shift 或 Win。' })
    expect(formatAccelerator('CommandOrControl+Shift+2')).toBe('Ctrl + Shift + 2')
    expect(formatAccelerator('Alt+F1')).toBe('Alt + F1')
  })

  it('在保存前识别重复组合键', () => {
    expect(duplicateAccelerators({ capture: 'Ctrl+Shift+2', ocr: 'Control+Shift+2', pin: 'Alt+F3' })).toEqual(new Set(['capture', 'ocr']))
  })
})
