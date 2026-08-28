const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const mode = process.argv[2]
if (!['import', 'verify'].includes(mode)) {
  console.error('Usage: node scripts/cpa-maintenance.cjs <import|verify>')
  process.exit(2)
}

const projectDir = path.resolve(__dirname, '..')
const electronBinary = require('electron')
const marker = path.join(os.tmpdir(), `ta-windows-cpa-${mode}-${process.pid}.json`)

function runProcess(executable, args, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, options)
    const stdout = []
    const stderr = []
    child.stdout.on('data', (data) => stdout.push(Buffer.from(data)))
    child.stderr.on('data', (data) => stderr.push(Buffer.from(data)))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('process timed out'))
    }, timeoutMs)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') })
    })
    if (options.input !== undefined) child.stdin.end(options.input)
  })
}

async function readLegacyCpaKey() {
  const legacyProject = path.resolve(projectDir, '..', '..', '工作任务管理小工具')
  const legacyElectron = path.join(legacyProject, 'node_modules', 'electron', 'dist', 'electron.exe')
  const settingsPath = path.join(process.env.APPDATA || '', 'sap-ops-task-float', 'settings.json')
  if (!fs.existsSync(legacyElectron) || !fs.existsSync(settingsPath)) throw new Error('未找到旧任务工具运行时或其设置文件。')
  const helper = path.join(os.tmpdir(), `ta-cpa-legacy-reader-${process.pid}.cjs`)
  const helperSource = `
const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
app.setPath('userData', path.dirname(process.argv[2]))
app.whenReady().then(() => {
  const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const encrypted = String(raw.aiProviders?.cpa?.encryptedApiKey || raw.encryptedApiKey || '')
  if (!encrypted || !safeStorage.isEncryptionAvailable()) throw new Error('legacy CPA key is unavailable')
  process.stdout.write(safeStorage.decryptString(Buffer.from(encrypted, 'base64')))
  app.exit(0)
}).catch((error) => { process.stderr.write(error.message); app.exit(1) })
`
  fs.writeFileSync(helper, helperSource, { encoding: 'utf8', mode: 0o600 })
  try {
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    const result = await runProcess(legacyElectron, [helper, settingsPath], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] }, 20_000)
    if (result.code !== 0 || !result.stdout) throw new Error(`旧任务工具无法解密 CPA 凭据：${result.stderr || `exit ${result.code}`}`)
    return result.stdout
  } finally {
    try { fs.unlinkSync(helper) } catch { /* already gone */ }
  }
}

async function main() {
  try { fs.unlinkSync(marker) } catch { /* no stale marker */ }
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  environment[mode === 'import' ? 'TA_CPA_IMPORT_MARKER' : 'TA_CPA_VERIFY_MARKER'] = marker
  let apiKey
  if (mode === 'import') {
    apiKey = await readLegacyCpaKey()
    environment.TA_CPA_IMPORT_FROM_STDIN = '1'
  }
  const result = await runProcess(electronBinary, ['.'], {
    cwd: projectDir,
    env: environment,
    stdio: [mode === 'import' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    input: apiKey,
  }, mode === 'verify' ? 120_000 : 20_000)
  apiKey = undefined
  if (!fs.existsSync(marker)) throw new Error(`Ta 未生成结果；可能已有实例持有单实例锁。${result.stderr ? ` ${result.stderr}` : ''}`)
  const maintenanceResult = JSON.parse(fs.readFileSync(marker, 'utf8'))
  fs.unlinkSync(marker)
  if (!maintenanceResult.ok) throw new Error(maintenanceResult.error || '视觉响应与测试图片不匹配。')
  console.log(`CPA ${mode} passed: provider=${maintenanceResult.activeProviderId}, model=${maintenanceResult.model}, key=${maintenanceResult.hasApiKey === false ? 'missing' : 'encrypted/present'}, vision=${maintenanceResult.visionRoundTrip ?? 'not-run'}`)
}

main().catch((error) => {
  try { fs.unlinkSync(marker) } catch { /* already gone */ }
  console.error(`CPA ${mode} failed: ${error.message}`)
  process.exitCode = 1
})
