const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const projectDir = path.resolve(__dirname, '..')
const electronBinary = require('electron')
const marker = path.join(os.tmpdir(), `ta-windows-e2e-${process.pid}.json`)
const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-windows-e2e-userdata-'))
try { fs.unlinkSync(marker) } catch { /* no stale marker */ }

const environment = { ...process.env, TA_E2E_SMOKE_FILE: marker, TA_E2E_USER_DATA_DIR: userDataDirectory }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(electronBinary, ['.'], { cwd: projectDir, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
let childExit
child.stdout.on('data', (data) => { output += data.toString() })
child.stderr.on('data', (data) => { output += data.toString() })
child.on('exit', (code, signal) => { childExit = { code, signal } })

const deadline = Date.now() + 90_000
const poll = setInterval(() => {
  if (!fs.existsSync(marker)) {
    if (childExit) {
      clearInterval(poll)
      console.error(`Ta E2E process exited before writing its marker (${JSON.stringify(childExit)}). Another Ta instance may hold the single-instance lock.\n${output}`)
      process.exit(1)
    }
    if (Date.now() < deadline) return
    clearInterval(poll)
    child.kill()
    console.error(`Ta E2E smoke timed out.\n${output}`)
    process.exit(1)
  }
  clearInterval(poll)
  const result = JSON.parse(fs.readFileSync(marker, 'utf8'))
  fs.unlinkSync(marker)
  if (!child.killed) child.kill()
  try { fs.rmSync(userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* Chromium may still release cache files while exiting */ }
  if (!result.ready) {
    console.error(`Ta E2E failed: ${result.error}\n${output}`)
    process.exit(1)
  }
  const normalized = String(result.ocrText).replace(/\s+/g, ' ').toUpperCase()
  const multiDisplay = Number(result.displayCount || 0) > 1
  const windowsGdiLatencyInvalid = result.captureTiming?.captureBackend === 'windows-gdi'
    && (!result.captureTiming?.frozenPreviewShown
      || !result.captureTiming?.pixelsFrozenMs
      || !result.repeatCaptureTiming?.pixelsFrozenMs
      || result.captureReadyMs > 180
      || result.captureTiming.pixelsFrozenMs > (multiDisplay ? 700 : 550)
      || result.capturePreviewReadyMs > (multiDisplay ? 1_500 : 1_200)
      || result.repeatCaptureReadyMs > 150
      || result.repeatCaptureTiming.pixelsFrozenMs > (multiDisplay ? 650 : 350)
      || result.repeatPreviewReadyMs > (multiDisplay ? 1_200 : 900))
  const latencyInvalid = result.captureTiming?.earlyOverlay
    ? result.captureReadyMs > 300 || result.repeatCaptureReadyMs > 300
    : windowsGdiLatencyInvalid
  const pointerStuttered = !result.pointerSmoothness?.done
    || result.pointerSmoothness.frames < 30
    || result.pointerSmoothness.moves < 12
    || result.pointerSmoothness.maxFrameGap > 80
    || result.pointerSmoothness.averageFrameGap > 30
  const startupPointerStuttered = !result.startupPointerSmoothness?.done
    || result.startupPointerSmoothness.frames < 30
    || result.startupPointerSmoothness.moves < 12
    || result.startupPointerSmoothness.maxFrameGap > 100
    || result.startupPointerSmoothness.averageFrameGap > 30
  const pixelWitnessInvalid = result.capturePixelWitnessSupported
    ? !result.captureWitnessPixelsVerified
    : false
  if (!result.desktop?.width || result.sample?.width !== 320 || !/TA\s*WINDOWS\s*2026/.test(normalized) || !result.encryptionRoundTrip || result.overlayCount !== result.displayCount || result.overlayReadyCount !== result.displayCount || latencyInvalid || (result.captureTiming?.inputShield && !result.inputShieldReady) || startupPointerStuttered || pointerStuttered || !result.capturePreviewReady || !result.captureExclusionVerified || pixelWitnessInvalid || !result.capturedImageContentVerified || !result.capturedResultPersisted || result.persistedCaptureStats?.probablyBlack || result.persistedCaptureStats?.probablyTransparent || !result.repeatedCaptureContentVerified || result.captureSourceStats?.probablyBlack || result.captureSourceStats?.probablyTransparent || result.captureCropStats?.probablyBlack || result.captureCropStats?.probablyTransparent || result.repeatSourceStats?.probablyBlack || result.repeatSourceStats?.probablyTransparent || result.reuseCaptureStats?.some((stats) => stats.probablyBlack || stats.probablyTransparent) || !result.repeatSelectionCleared || !result.smartSelectionVerified || !result.smartSelectionDisabledApplied || result.smartSelectionSettingUi?.initial !== true || result.smartSelectionSettingUi?.saved !== false || !result.selectionCreated || !result.selectionMoved || !result.selectionResized || result.resizeHandleCount !== 8 || !result.doubleClickConfirmed || !result.autoCopiedCapture || !result.quickCaptureBehaviorVerified || !result.quickCaptureSaved || !result.quickCaptureCopied || !result.quickCaptureDidNotOpenEditor || result.quickCaptureUi?.title !== '快速截图' || !result.unrelatedWindowStayedVisible || !result.mainWindowHiddenByPolicy || !result.mainWindowPixelExcluded || !result.historyRecoveredAfterEmpty || !result.resultToolCacheVerified || !result.resultPanelUsabilityVerified || !result.editorInitialFitVerified || !result.editorAnnotationVerified || !result.titlebarDragRegionVerified || result.captureWindowPolicyUi?.value !== 'keep-ta' || !['hide-ta', 'keep-ta', 'ask'].every((value) => result.captureWindowPolicyUi?.options?.includes(value)) || result.hotkeyRecorderUi?.value !== 'Alt + F1' || !result.hotkeyRecorderUi?.readOnly || !result.hotkeyRecorderUi?.help?.includes('Windows 默认') || !result.recordedHotkeyRegistered || result.homeCaptureHotkey !== 'Alt + F1' || !result.keepTaWindowStayedVisible || !result.unrelatedWindowStayedVisibleWithTa || result.keepTaCaptureTiming?.captureWindowPolicy !== 'keep-ta' || result.keepTaCaptureTiming?.mainHiddenForCapture !== false || !result.pinShownWithMainHidden || !result.pinToolbarInteractive || !result.pinMoved || !result.pinInteractionRestored || !result.pinClosed || !result.pinExcludedFromTaskbar || result.overlayWindowGrowth !== 0) {
    console.error(`Ta E2E returned an unexpected result: ${JSON.stringify(result)}\n${output}`)
    process.exit(1)
  }
  console.log(`Ta E2E passed: captured ${result.desktop.width}x${result.desktop.height}, sourceLuma=${result.captureSourceStats.meanLuminance}/${result.captureSourceStats.luminanceStdDev}, cropLuma=${result.captureCropStats.meanLuminance}/${result.captureCropStats.luminanceStdDev}, OCR="${normalized}", confidence=${result.ocrConfidence}%, overlays=${result.overlayReadyCount}/${result.overlayCount}, shield/frozen/preview=${result.captureReadyMs}/${result.captureTiming?.pixelsFrozenMs}/${result.capturePreviewReadyMs}ms, repeat=${result.repeatCaptureReadyMs}/${result.repeatCaptureTiming?.pixelsFrozenMs}/${result.repeatPreviewReadyMs}ms, startupPointer=${JSON.stringify(result.startupPointerSmoothness)}, selectionPointer=${JSON.stringify(result.pointerSmoothness)}, timing=${JSON.stringify(result.captureTiming)}, repeatTiming=${JSON.stringify(result.repeatCaptureTiming)}, pixelWitness=${result.capturePixelWitnessSupported ? 'verified' : 'isolated-desktop'}, hidePixels=${result.mainHideWitnessPixelsBefore}->${result.mainHideWitnessPixelsAfter}, editorFit=${JSON.stringify(result.editorInitialFit)}, editorAnnotation=${result.editorAnnotationVerified}, smartSelection=${result.smartSelectionPreview?.kind}/click-lock/original-color, resultCache=${JSON.stringify(result.e2eAiRunCounts)}, hotkeyRecorder=Alt+F1, resultPanel=scroll/copy-fixed, selection=create/move/resize/double-click, autoCopy=true, quickCapture=copy/save/no-editor, windowPolicy=hide/keep/ask, titlebar=drag, handles=${result.resizeHandleCount}, history=empty/recover, pin=interactive/move/restore/close/taskbar-hidden, overlayGrowth=${result.overlayWindowGrowth}, secureStorage=${result.secureStorageAvailable}`)
  process.exit(0)
}, 250)
