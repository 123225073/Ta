import { describe, expect, it } from 'vitest'
import { isEditorCancelShortcut } from './editor-shortcuts'

describe('editor keyboard shortcuts', () => {
  it('maps Escape to the same cancel action as the back button', () => {
    expect(isEditorCancelShortcut('Escape')).toBe(true)
  })

  it('does not close the editor for ordinary editing keys', () => {
    expect(isEditorCancelShortcut('Enter')).toBe(false)
    expect(isEditorCancelShortcut('Backspace')).toBe(false)
  })
})
