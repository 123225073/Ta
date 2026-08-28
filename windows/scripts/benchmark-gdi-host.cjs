const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')
const { spawn } = require('node:child_process')

const script = path.resolve(__dirname, '..', 'resources', 'capture', 'ta-capture-host.ps1')
const outputDirectory = path.join(os.tmpdir(), `ta-gdi-host-${process.pid}`)
fs.mkdirSync(outputDirectory, { recursive: true })
const started = performance.now()
const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
})
const lines = readline.createInterface({ input: child.stdout })
let run = 0

lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.type === 'ready') {
    console.log(JSON.stringify({ readyMilliseconds: Math.round(performance.now() - started) }))
    requestCapture()
    return
  }
  if (message.type === 'captured') {
    console.log(JSON.stringify({ run, stage: 'pixels-frozen', roundTripMilliseconds: Math.round(performance.now() - requestStarted), helperMilliseconds: message.milliseconds }))
    return
  }
  console.log(JSON.stringify({ run, roundTripMilliseconds: Math.round(performance.now() - requestStarted), helperMilliseconds: message.milliseconds, screens: message.screens?.map((screen) => ({ primary: screen.primary, deviceName: screen.deviceName, x: screen.x, y: screen.y, width: screen.width, height: screen.height, bytes: fs.statSync(screen.path).size, previewBytes: fs.statSync(screen.previewPath).size })) }))
  for (const screen of message.screens ?? []) {
    fs.rmSync(screen.path, { force: true })
    fs.rmSync(screen.previewPath, { force: true })
  }
  if (run < 3) requestCapture()
  else {
    child.stdin.end(`${JSON.stringify({ command: 'exit' })}\n`)
    fs.rmSync(outputDirectory, { recursive: true, force: true })
  }
})

let requestStarted = 0
function requestCapture() {
  run += 1
  requestStarted = performance.now()
  child.stdin.write(`${JSON.stringify({ id: `run-${run}`, command: 'capture', outputDirectory })}\n`)
}

child.stderr.on('data', (data) => process.stderr.write(data))
child.on('error', (error) => { console.error(error); process.exit(1) })
