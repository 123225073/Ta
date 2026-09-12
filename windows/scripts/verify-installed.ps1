param([string]$ExecutablePath = '')

$ErrorActionPreference = 'Stop'
if (-not $ExecutablePath) {
  $ExecutablePath = Get-ChildItem -LiteralPath "$env:LOCALAPPDATA\Programs\ta-windows" -Filter '*.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch 'uninstall' } |
    Sort-Object Length -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not (Test-Path -LiteralPath $ExecutablePath)) { throw 'Installed Ta executable was not found.' }
$marker = Join-Path ([System.IO.Path]::GetTempPath()) ("ta-installed-e2e-{0}.json" -f [guid]::NewGuid().ToString('N'))
$e2eUserData = Join-Path ([System.IO.Path]::GetTempPath()) ("ta-installed-e2e-userdata-{0}" -f [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $e2eUserData | Out-Null
$running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $ExecutablePath }
if ($running) {
  $running | Stop-Process -Force
  Start-Sleep -Milliseconds 500
}

$info = [System.Diagnostics.ProcessStartInfo]::new()
$info.FileName = $ExecutablePath
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.EnvironmentVariables['TA_E2E_SMOKE_FILE'] = $marker
$info.EnvironmentVariables['TA_E2E_USER_DATA_DIR'] = $e2eUserData
$process = [System.Diagnostics.Process]::Start($info)
$deadline = (Get-Date).AddSeconds(100)
while (-not (Test-Path -LiteralPath $marker) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
if (-not (Test-Path -LiteralPath $marker)) {
  try { $process.Kill() } catch { }
  throw 'Installed Ta E2E timed out.'
}

$result = Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
Remove-Item -LiteralPath $marker -Force
Remove-Item -LiteralPath $e2eUserData -Recurse -Force -ErrorAction SilentlyContinue
if (-not $result.ready) { throw "Installed Ta E2E failed: $($result.error)" }
if ($result.overlayCount -ne $result.displayCount -or $result.overlayReadyCount -ne $result.displayCount) { throw 'Installed overlay validation failed.' }
if ($result.captureTiming.earlyOverlay -and ($result.captureReadyMs -gt 300 -or $result.repeatCaptureReadyMs -gt 300)) { throw "Installed overlay latency validation failed: $($result.captureReadyMs)/$($result.repeatCaptureReadyMs)ms." }
if (-not $result.capturePreviewReady) { throw 'Installed frozen preview validation failed.' }
if (-not $result.captureExclusionVerified) { throw 'Installed protected-overlay capture validation failed.' }
if (-not $result.capturedImageContentVerified -or -not $result.capturedResultPersisted -or $result.persistedCaptureStats.probablyBlack -or $result.persistedCaptureStats.probablyTransparent -or -not $result.repeatedCaptureContentVerified -or $result.captureSourceStats.probablyBlack -or $result.captureSourceStats.probablyTransparent -or $result.captureCropStats.probablyBlack -or $result.captureCropStats.probablyTransparent) { throw 'Installed black/transparent-image regression validation failed.' }
$multiDisplay = $result.displayCount -gt 1
$initialFrozenLimit = if ($multiDisplay) { 700 } else { 550 }
$initialPreviewLimit = if ($multiDisplay) { 1500 } else { 1200 }
$repeatFrozenLimit = if ($multiDisplay) { 650 } else { 350 }
$repeatPreviewLimit = if ($multiDisplay) { 1200 } else { 900 }
if ($result.captureTiming.captureBackend -eq 'windows-gdi' -and (-not $result.captureTiming.frozenPreviewShown -or -not $result.captureTiming.pixelsFrozenMs -or -not $result.repeatCaptureTiming.pixelsFrozenMs -or $result.captureReadyMs -gt 180 -or $result.captureTiming.pixelsFrozenMs -gt $initialFrozenLimit -or $result.capturePreviewReadyMs -gt $initialPreviewLimit -or $result.repeatCaptureReadyMs -gt 150 -or $result.repeatCaptureTiming.pixelsFrozenMs -gt $repeatFrozenLimit -or $result.repeatPreviewReadyMs -gt $repeatPreviewLimit)) { throw "Installed native capture latency validation failed: shield/frozen/preview=$($result.captureReadyMs)/$($result.captureTiming.pixelsFrozenMs)/$($result.capturePreviewReadyMs)ms, repeat=$($result.repeatCaptureReadyMs)/$($result.repeatCaptureTiming.pixelsFrozenMs)/$($result.repeatPreviewReadyMs)ms; displays=$($result.displayCount); timing=$($result.captureTiming | ConvertTo-Json -Compress); repeatTiming=$($result.repeatCaptureTiming | ConvertTo-Json -Compress)." }
if ($result.captureTiming.inputShield -and -not $result.inputShieldReady) { throw 'Installed transparent input shield validation failed.' }
if (-not $result.startupPointerSmoothness.done -or $result.startupPointerSmoothness.frames -lt 30 -or $result.startupPointerSmoothness.moves -lt 12 -or $result.startupPointerSmoothness.maxFrameGap -gt 100 -or $result.startupPointerSmoothness.averageFrameGap -gt 30) { throw "Installed startup pointer smoothness validation failed: $($result.startupPointerSmoothness | ConvertTo-Json -Compress)." }
if (-not $result.pointerSmoothness.done -or $result.pointerSmoothness.frames -lt 30 -or $result.pointerSmoothness.moves -lt 12 -or $result.pointerSmoothness.maxFrameGap -gt 80 -or $result.pointerSmoothness.averageFrameGap -gt 30) { throw "Installed pointer smoothness validation failed: $($result.pointerSmoothness | ConvertTo-Json -Compress)." }
if (-not $result.repeatSelectionCleared) { throw 'Installed reusable overlay reset validation failed.' }
if (-not $result.selectionCreated -or -not $result.selectionMoved -or -not $result.selectionResized -or $result.resizeHandleCount -ne 8) { throw "Installed selection interaction validation failed: $($result.selectionSnapshots | ConvertTo-Json -Compress -Depth 5)." }
if (-not $result.smartSelectionVerified -or -not $result.smartSelectionDisabledApplied -or -not $result.smartSelectionSettingUi.initial -or $result.smartSelectionSettingUi.saved) { throw "Installed smart-selection validation failed: preview=$($result.smartSelectionPreview | ConvertTo-Json -Compress -Depth 5); setting=$($result.smartSelectionSettingUi | ConvertTo-Json -Compress); disabledApplied=$($result.smartSelectionDisabledApplied)." }
if (-not $result.doubleClickConfirmed -or -not $result.autoCopiedCapture) { throw 'Installed double-click confirmation or automatic clipboard validation failed.' }
$quickCaptureTitle = -join ([char[]](0x5FEB, 0x901F, 0x622A, 0x56FE))
if (-not $result.quickCaptureBehaviorVerified -or -not $result.quickCaptureSaved -or -not $result.quickCaptureCopied -or -not $result.quickCaptureDidNotOpenEditor -or $result.quickCaptureUi.title -ne $quickCaptureTitle) { throw "Installed quick-capture save/copy/no-editor validation failed: $($result.quickCaptureUi | ConvertTo-Json -Compress)." }
if (-not $result.unrelatedWindowStayedVisible -or -not $result.mainWindowHiddenByPolicy -or -not $result.mainWindowPixelExcluded -or -not $result.keepTaWindowStayedVisible -or -not $result.unrelatedWindowStayedVisibleWithTa -or $result.keepTaCaptureTiming.captureWindowPolicy -ne 'keep-ta' -or $result.keepTaCaptureTiming.mainHiddenForCapture) { throw "Installed capture-window policy validation failed: hidePixels=$($result.mainHideWitnessPixelsBefore)->$($result.mainHideWitnessPixelsAfter)." }
if (-not $result.encryptionRoundTrip) { throw 'Installed safeStorage validation failed.' }
if (-not $result.historyRecoveredAfterEmpty) { throw 'Installed empty-history recovery validation failed.' }
if (-not $result.libraryUiVerified -or -not $result.exifOrientationNormalized) { throw "Installed library/date/search/focused-paste or EXIF normalization validation failed: library=$($result.libraryUiVerified), exif=$($result.exifOrientationNormalized)." }
if (-not $result.resultToolCacheVerified -or $result.e2eAiRunCounts.vision -ne 2 -or $result.e2eAiRunCounts.translate -ne 1) { throw "Installed result-tool cache validation failed: counts=$($result.e2eAiRunCounts | ConvertTo-Json -Compress), indicators=$($result.cachedIndicators | ConvertTo-Json -Compress)." }
if (-not $result.resultPanelUsabilityVerified) { throw "Installed result-panel scroll/copy validation failed: $($result.resultPanelUsability | ConvertTo-Json -Compress)." }
if (-not $result.editorInitialFitVerified -or -not $result.editorAnnotationVerified -or -not $result.editorEscBackVerified) { throw "Installed editor fit/annotation/Escape-back validation failed: fit=$($result.editorInitialFit | ConvertTo-Json -Compress); annotation=$($result.editorAnnotationVerified); escape=$($result.editorEscBackVerified)." }
if (-not $result.imageContextMenusVerified -or -not $result.editorRightClickNoAnnotation) { throw "Installed image context-menu validation failed: $($result.imageContextMenus | ConvertTo-Json -Compress -Depth 5)." }
if (-not $result.longCaptureHudVerified -or -not $result.longCaptureHudHiddenForFrame -or -not $result.longCaptureHudRestored) { throw "Installed long-capture HUD visibility/capture-exclusion validation failed: $($result.longCaptureHudUi | ConvertTo-Json -Compress)." }
if (-not $result.themeToggleVerified -or $result.themeToggleUi.theme -ne 'light' -or $result.themeToggleUi.colorScheme -ne 'light') { throw "Installed theme-toggle/persistence validation failed: $($result.themeToggleUi | ConvertTo-Json -Compress)." }
if (-not $result.titlebarDragRegionVerified) { throw "Installed titlebar drag-region validation failed: $($result.titlebarDragRegions | ConvertTo-Json -Compress)." }
if ($result.captureWindowPolicyUi.value -ne 'keep-ta' -or -not ($result.captureWindowPolicyUi.options -contains 'hide-ta') -or -not ($result.captureWindowPolicyUi.options -contains 'keep-ta') -or -not ($result.captureWindowPolicyUi.options -contains 'ask')) { throw 'Installed capture-window policy UI validation failed.' }
if ($result.hotkeyRecorderUi.value -ne 'Alt + F1' -or -not $result.hotkeyRecorderUi.readOnly -or $result.hotkeyRecorderUi.help -notmatch 'Ctrl \+ Shift \+ 1') { throw "Installed dynamic hotkey recorder validation failed: $($result.hotkeyRecorderUi | ConvertTo-Json -Compress)." }
if ($result.homeCaptureHotkey -ne 'Alt + F1') { throw "Installed home hotkey display validation failed: $($result.homeCaptureHotkey)." }
if (-not $result.pinShownWithMainHidden -or -not $result.pinToolbarInteractive -or -not $result.pinMoved -or -not $result.pinInteractionRestored -or -not $result.pinClosed -or -not $result.pinExcludedFromTaskbar) { throw 'Installed pin-window interaction/taskbar validation failed.' }
if ($result.overlayWindowGrowth -ne 0) { throw "Installed overlay-window reuse validation failed: growth=$($result.overlayWindowGrowth)." }

[pscustomobject]@{
  InstalledVersion = (Get-Item -LiteralPath $ExecutablePath).VersionInfo.ProductVersion
  Desktop = "{0}x{1}" -f $result.desktop.width, $result.desktop.height
  OcrText = ([string]$result.ocrText -replace '\s+', ' ').Trim()
  OcrConfidence = $result.ocrConfidence
  Overlays = "{0}/{1}" -f $result.overlayReadyCount, $result.overlayCount
  CaptureReady = "Shield/Frozen/Preview={0}/{1}/{2} ms; Repeat={3}/{4}/{5} ms" -f $result.captureReadyMs, $result.captureTiming.pixelsFrozenMs, $result.capturePreviewReadyMs, $result.repeatCaptureReadyMs, $result.repeatCaptureTiming.pixelsFrozenMs, $result.repeatPreviewReadyMs
  PointerSmoothness = "Moves={0}; MaxGap={1} ms; AverageGap={2} ms" -f $result.pointerSmoothness.moves, $result.pointerSmoothness.maxFrameGap, $result.pointerSmoothness.averageFrameGap
  StartupPointerSmoothness = "Moves={0}; MaxGap={1} ms; AverageGap={2} ms" -f $result.startupPointerSmoothness.moves, $result.startupPointerSmoothness.maxFrameGap, $result.startupPointerSmoothness.averageFrameGap
  CaptureBackend = $result.captureTiming.captureBackend
  ImageContent = "Source={0}/{1}; Crop={2}/{3}; Repeated={4}" -f $result.captureSourceStats.meanLuminance, $result.captureSourceStats.luminanceStdDev, $result.captureCropStats.meanLuminance, $result.captureCropStats.luminanceStdDev, $result.repeatedCaptureContentVerified
  Selection = "Create={0}; Move={1}; Resize={2}; Handles={3}" -f $result.selectionCreated, $result.selectionMoved, $result.selectionResized, $result.resizeHandleCount
  SmartSelection = "Window={0}; OriginalColor={1}; ClickLock={2}" -f $result.smartSelectionVerified, $result.smartSelectionPreview.candidateTransparent, [bool]$result.smartSelectionLocked
  HistoryRecovery = $result.historyRecoveredAfterEmpty
  Library = "Date/Search/FocusedPaste={0}; ExifNormalized={1}" -f $result.libraryUiVerified, $result.exifOrientationNormalized
  ResultToolCache = "Vision={0}; Translate={1}; CachedSwitch={2}" -f $result.e2eAiRunCounts.vision, $result.e2eAiRunCounts.translate, $result.resultToolCacheVerified
  ResultPanel = "Scrollable={0}; CopyFixed={1}" -f $result.resultPanelUsability.scrollable, $result.resultPanelUsability.footerInsidePanel
  CaptureWindowPolicy = "HideMain={0}; PixelExcluded={1} ({2}->{3}); KeepMain={4}; OtherWindows={5}" -f $result.mainWindowHiddenByPolicy, $result.mainWindowPixelExcluded, $result.mainHideWitnessPixelsBefore, $result.mainHideWitnessPixelsAfter, $result.keepTaWindowStayedVisible, ($result.unrelatedWindowStayedVisible -and $result.unrelatedWindowStayedVisibleWithTa)
  EditorInitialFit = "Visible={0}; Annotated={1}; EscapeBack={2}; Rendered={3}x{4}; Available={5}x{6}" -f $result.editorInitialFitVerified, $result.editorAnnotationVerified, $result.editorEscBackVerified, $result.editorInitialFit.renderedWidth, $result.editorInitialFit.renderedHeight, $result.editorInitialFit.availableWidth, $result.editorInitialFit.availableHeight
  ImageContextMenus = "Workbench/Library/Result/Editor/Pin={0}; Count={1}" -f $result.imageContextMenusVerified, $result.imageContextMenus.Count
  LongCaptureHud = "Visible={0}; HiddenForFrame={1}; Restored={2}; Progress={3}" -f $result.longCaptureHudVisible, $result.longCaptureHudHiddenForFrame, $result.longCaptureHudRestored, $result.longCaptureHudUi.progress
  ThemeToggle = "DarkToLight={0}; Persisted={1}; Scheme={2}" -f $result.themeToggleVerified, $result.themeToggleUi.theme, $result.themeToggleUi.colorScheme
  HotkeyRecorder = "Captured={0}; Registered={1}" -f $result.hotkeyRecorderUi.value, $result.recordedHotkeyRegistered
  TitlebarDrag = $result.titlebarDragRegionVerified
  AutoCopyAndDoubleClick = ($result.autoCopiedCapture -and $result.doubleClickConfirmed)
  QuickCapture = "Saved={0}; Copied={1}; NoEditor={2}" -f $result.quickCaptureSaved, $result.quickCaptureCopied, $result.quickCaptureDidNotOpenEditor
  PinWindow = "Shown={0}; Toolbar={1}; Move={2}; Restore={3}; Close={4}; TaskbarHidden={5}" -f $result.pinShownWithMainHidden, $result.pinToolbarInteractive, $result.pinMoved, $result.pinInteractionRestored, $result.pinClosed, $result.pinExcludedFromTaskbar
  OverlayWindowGrowth = $result.overlayWindowGrowth
  SafeStorage = $result.secureStorageAvailable
  EncryptionRoundTrip = $result.encryptionRoundTrip
}
