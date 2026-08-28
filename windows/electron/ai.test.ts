import { describe, expect, it } from 'vitest'
import { visionPrompt } from './ai'

describe('AI prompts', () => {
  it('keeps the selected translation languages in the request', () => {
    const prompt = visionPrompt('translate', 'English', '简体中文')
    expect(prompt).toContain('English')
    expect(prompt).toContain('简体中文')
    expect(prompt).toContain('只输出译文')
  })

  it('asks the vision model not to invent screen details', () => {
    expect(visionPrompt('vision', 'auto', '简体中文')).toContain('不要编造')
  })
})
