import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExternalCaptureStaging, ExternalCaptureStagingFullError } from './external-capture-staging'

const temporaryDirectories: string[] = []

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-external-staging-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('ExternalCaptureStaging', () => {
  it('persists source and capture time so a restart can recover pending screenshots', async () => {
    const staging = new ExternalCaptureStaging(temporaryDirectory())
    const firstTime = new Date('2026-08-28T01:02:03.000Z')
    const entry = await staging.stage(Buffer.from('png-one'), 'feishu', firstTime)
    expect(await staging.read(entry)).toEqual(Buffer.from('png-one'))

    const recovered = await new ExternalCaptureStaging(path.dirname(entry.filePath)).recover()
    expect(recovered).toEqual([{ filePath: entry.filePath, sourceApp: 'feishu', createdAt: firstTime.toISOString() }])

    await staging.remove(entry)
    expect(await staging.recover()).toEqual([])
  })

  it('bounds both queued file count and bytes instead of growing memory or disk without limit', async () => {
    const countLimited = new ExternalCaptureStaging(temporaryDirectory(), 1, 100)
    await countLimited.stage(Buffer.from('first'), 'weixin')
    await expect(countLimited.stage(Buffer.from('second'), 'weixin')).rejects.toBeInstanceOf(ExternalCaptureStagingFullError)

    const byteLimited = new ExternalCaptureStaging(temporaryDirectory(), 10, 5)
    await expect(byteLimited.stage(Buffer.alloc(6), 'qq')).rejects.toBeInstanceOf(ExternalCaptureStagingFullError)
  })

  it('quarantines a permanently invalid item without making it recoverable again', async () => {
    const staging = new ExternalCaptureStaging(temporaryDirectory())
    const entry = await staging.stage(Buffer.from('not-a-real-png'), 'qq')
    const failedPath = await staging.quarantine(entry)
    expect(failedPath).toMatch(/\.failed$/)
    expect(fs.existsSync(failedPath!)).toBe(true)
    expect(await staging.recover()).toEqual([])
  })

  it('bounds restart recovery before allocating file contents', async () => {
    const directory = temporaryDirectory()
    const validName = (index: number) => `${String(1_777_000_000_000 + index)}-qq-${String(index).padStart(16, '0')}.png`
    fs.writeFileSync(path.join(directory, validName(1)), Buffer.alloc(4))
    fs.writeFileSync(path.join(directory, validName(2)), Buffer.alloc(4))
    fs.writeFileSync(path.join(directory, validName(3)), Buffer.alloc(9))
    const staging = new ExternalCaptureStaging(directory, 2, 8, 8)

    const recovered = await staging.recover()
    expect(recovered).toHaveLength(2)
    expect(staging.lastRecoveryRejected).toBe(1)
    expect((await fs.promises.readdir(directory)).some((name) => name.endsWith('.failed'))).toBe(true)
    await expect(staging.read(recovered[0])).resolves.toHaveLength(4)
  })
})
