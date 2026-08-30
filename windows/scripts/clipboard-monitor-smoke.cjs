const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

if (process.platform !== 'win32') {
  console.log('Clipboard monitor smoke skipped: Windows only.')
  process.exit(0)
}

const script = process.env.TA_CLIPBOARD_MONITOR_SCRIPT
  ? path.resolve(process.env.TA_CLIPBOARD_MONITOR_SCRIPT)
  : path.resolve(__dirname, '..', 'resources', 'capture', 'ta-clipboard-monitor.ps1')
if (!fs.existsSync(script)) {
  console.error(`Clipboard monitor script was not found: ${script}`)
  process.exit(1)
}
const systemPowerShell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const executable = fs.existsSync(systemPowerShell) ? systemPowerShell : 'powershell.exe'
const requestId = crypto.randomUUID()
const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
})

let output = ''
let errors = ''
let settled = false
const finish = (error, event) => {
  if (settled) return
  settled = true
  clearTimeout(timer)
  try { child.stdin.end('exit\n') } catch { child.kill() }
  if (error) {
    console.error(`${error}\n${errors}`)
    process.exitCode = 1
  } else {
    console.log(`Clipboard monitor smoke passed: sequence=${event.sequence}, stable=${event.stable}, owner=${event.executablePath || 'none'}, formats=${event.formats.length}`)
  }
}

child.stderr.on('data', (chunk) => { errors += chunk.toString('utf8') })
child.stdout.on('data', (chunk) => {
  output += chunk.toString('utf8')
  let newline = output.indexOf('\n')
  while (newline >= 0) {
    const line = output.slice(0, newline).trim()
    output = output.slice(newline + 1)
    newline = output.indexOf('\n')
    if (!line) continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event.requestId !== requestId) continue
    if (event.type !== 'clipboard-update' || event.stable !== true || !Number.isSafeInteger(event.sequence) || !Array.isArray(event.formats)) {
      finish(`Clipboard monitor returned invalid inspection: ${line}`)
      return
    }
    finish(undefined, event)
  }
})
child.on('error', (error) => finish(`Clipboard monitor failed to start: ${error.message}`))
child.on('exit', (code) => { if (!settled) finish(`Clipboard monitor exited before inspection (exit ${code}).`) })
child.stdin.write(`inspect ${requestId}\n`)

const timer = setTimeout(() => finish('Clipboard monitor inspection timed out.'), 20_000)
