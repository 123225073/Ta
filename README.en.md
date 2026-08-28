<div align="center">

<img src="./Resources/Brand/Ta-AppIcon.png" width="112" alt="Ta">

# Ta for Windows

### Frame it. Keep it.

[![Windows](https://img.shields.io/badge/Windows-10%2F11-1676D2.svg)](./windows/README.md)
[![Version](https://img.shields.io/badge/Windows-v1.1.11-E62D1B.svg)](./docs/release-notes-v1.1.11.md)
[![License](https://img.shields.io/badge/License-MIT-D6402F.svg)](./LICENSE)

[简体中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md)

</div>

## About this fork

This repository is a Windows-focused fork of [kangarooking/Ta](https://github.com/kangarooking/Ta). The original macOS/Swift implementation remains in `Sources/`, `Tests/`, and `Package.swift`. The primary deliverable here is the Windows 10/11 x64 client in `windows/`, implemented with Electron and a persistent Windows capture host.

## Windows v1.1.11 highlights

- Full-resolution, lossless desktop capture with per-monitor DPI handling.
- Smart window selection, manual drag selection, move, eight-way resize, and double-click or `Enter` confirmation.
- Original-color selection with neutral dimming only outside the selected area.
- Automatic clipboard copy and local history for every completed screenshot.
- Quick Capture saves and copies without opening the editor.
- Offline Chinese/English OCR plus configurable OpenAI-compatible, Claude, Gemini, and compatible vision endpoints.
- Per-screenshot result cache for OCR, vision, and translation, with explicit rerun controls.
- Annotation tools with fit-to-viewport startup and manual zoom.
- Movable, interactive pin windows without duplicate taskbar entries.
- Recordable Windows global shortcuts and conflict checks.
- Capture policy: fully hide Ta, keep Ta visible, or ask every time. Other applications are never hidden.

In hide mode, Ta becomes transparent and hidden before the capture host waits for a Windows DWM composition boundary. This prevents a fading ghost of the Ta window from entering the screenshot.

## Default shortcuts

| Action | Shortcut |
|---|---|
| Quick OCR | `Ctrl + Shift + 1` |
| Standard Capture | `Ctrl + Shift + 2` |
| Quick Capture | `Ctrl + Shift + 3` |
| Capture and Pin | `Ctrl + Shift + 4` |
| Scrolling Capture | `Ctrl + Shift + 5` |
| Capture and Translate | `Ctrl + Shift + 6` |

All shortcuts can be recorded directly in Settings.

## Build

Requirements: Windows 10 22H2 or Windows 11 x64, Node.js 22+, npm.

```powershell
cd windows
npm ci
npm run dist
```

The generated installer is `windows/release/Ta-Windows-1.1.11-x64-Setup.exe`. Generated installers, build output, OCR model copies, and local user data are intentionally excluded from Git.

```powershell
npm test
npm run typecheck
npm run test:preview-fidelity
npm run smoke:e2e
```

## Privacy and limits

Screenshots, annotation, pinning, long capture, and local OCR remain local. Images are uploaded only when the user explicitly runs a configured cloud vision or translation action. API keys are encrypted with Electron `safeStorage` on Windows and are not committed or logged in plaintext.

DRM or OS-protected video may still be forced to black by Windows. Cross-monitor drag selection is not yet supported. Complex animated pages may require manual review after long-capture stitching.

See the [Windows guide](./windows/README.md), [v1.1.11 release notes](./docs/release-notes-v1.1.11.md), and [acceptance report](./docs/windows-acceptance.md).

## Upstream and license

Keep the original project as an `upstream` remote and merge reviewed changes when useful. The isolated `windows/` implementation usually avoids Swift conflicts, while shared README, brand, and documentation changes should be resolved manually. Do not auto-force-sync the fork.

Licensed under [MIT](./LICENSE). Thanks to the original Ta authors and contributors.
