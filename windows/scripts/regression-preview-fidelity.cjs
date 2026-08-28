const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')
const { spawn } = require('node:child_process')
const sharp = require('sharp')

async function main() {
  const script = path.resolve(__dirname, '..', 'resources', 'capture', 'ta-capture-host.ps1')
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-preview-fidelity-'))
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  const timeout = setTimeout(() => child.kill(), 20_000)

  try {
    const lines = readline.createInterface({ input: child.stdout })
    let verified = false
    for await (const line of lines) {
      const message = JSON.parse(line)
      if (message.type === 'ready') {
        child.stdin.write(`${JSON.stringify({ id: 'preview-fidelity', command: 'capture', outputDirectory })}\n`)
        continue
      }
      if (message.type !== 'complete') continue

      for (const screen of message.screens ?? []) {
        const metadata = await sharp(screen.previewPath).metadata()
        if (metadata.format !== 'png') {
          throw new Error(`预览必须无损，当前格式为 ${metadata.format ?? 'unknown'}：${screen.deviceName}`)
        }
        if (metadata.width !== screen.width || metadata.height !== screen.height) {
          throw new Error(`预览不得缩放：${screen.deviceName} 屏幕 ${screen.width}x${screen.height}，预览 ${metadata.width}x${metadata.height}`)
        }
        const previewPixels = await sharp(screen.previewPath).ensureAlpha().raw().toBuffer()
        const capturedPixels = fs.readFileSync(screen.path)
        if (previewPixels.length !== capturedPixels.length) {
          throw new Error(`预览与最终截图像素数量不一致：${screen.deviceName}`)
        }
        let totalDifference = 0
        let samples = 0
        const pixelCount = screen.width * screen.height
        const step = Math.max(1, Math.floor(pixelCount / 20_000))
        for (let pixel = 0; pixel < pixelCount; pixel += step) {
          const offset = pixel * 4
          totalDifference += Math.abs(previewPixels[offset] - capturedPixels[offset + 2])
          totalDifference += Math.abs(previewPixels[offset + 1] - capturedPixels[offset + 1])
          totalDifference += Math.abs(previewPixels[offset + 2] - capturedPixels[offset])
          samples += 3
        }
        if (totalDifference / Math.max(1, samples) > 0.1) {
          throw new Error(`预览与最终截图不再是同一批原始像素：${screen.deviceName}`)
        }
      }
      verified = true
      child.stdin.end(`${JSON.stringify({ command: 'exit' })}\n`)
      break
    }
    if (!verified) throw new Error(stderr || '截图辅助进程未返回完整预览。')
    console.log('Capture preview fidelity passed: lossless, full-resolution previews on every display.')
  } finally {
    clearTimeout(timeout)
    if (!child.killed) child.kill()
    fs.rmSync(outputDirectory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
