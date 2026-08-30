const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const projectDir = path.resolve(__dirname, '..')
const electronBinary = require('electron')
const smokeFile = path.join(os.tmpdir(), `ta-windows-smoke-${process.pid}.json`)
const smokeUserData = fs.mkdtempSync(path.join(os.tmpdir(), `ta-windows-smoke-profile-${process.pid}-`))
try { fs.unlinkSync(smokeFile) } catch { /* no stale marker */ }

const environment = { ...process.env, TA_SMOKE_FILE: smokeFile, TA_E2E_USER_DATA_DIR: smokeUserData }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(electronBinary, ['.'], {
  cwd: projectDir,
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
})

let output = ''
child.stdout.on('data', (data) => { output += data.toString() })
child.stderr.on('data', (data) => { output += data.toString() })

const timer = setTimeout(() => {
  child.kill()
  console.error(`Ta smoke timed out.\n${output}`)
  process.exitCode = 1
}, 20_000)

child.on('exit', (code) => {
  clearTimeout(timer)
  try { fs.rmSync(smokeUserData, { recursive: true, force: true }) } catch { /* profile may still be releasing files */ }
  if (!fs.existsSync(smokeFile)) {
    console.error(`Ta did not write its ready marker (exit ${code}).\n${output}`)
    process.exitCode = 1
    return
  }
  const result = JSON.parse(fs.readFileSync(smokeFile, 'utf8'))
  fs.unlinkSync(smokeFile)
  if (!result.ready || result.platform !== 'win32' || result.version !== '1.3.2' || Object.values(result.hotkeyStatus ?? {}).some((value) => !value)) {
    console.error(`Unexpected smoke result: ${JSON.stringify(result)}`)
    process.exitCode = 1
    return
  }
  console.log(`Ta Windows smoke passed: v${result.version}, pid ${result.pid}, packaged=${result.packaged}, hotkeys=${Object.keys(result.hotkeyStatus).length}`)
})
