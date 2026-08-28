<div align="center">

<img src="./Resources/Brand/Ta-AppIcon.png" width="112" alt="拓 Ta">

# 拓 Ta · Windows 截图工具

### 框住它，拓下来。

[![Windows](https://img.shields.io/badge/Windows-10%2F11-1676D2.svg)](./windows/README.md)
[![Version](https://img.shields.io/badge/Windows-v1.1.11-E62D1B.svg)](./docs/release-notes-v1.1.11.md)
[![Electron](https://img.shields.io/badge/Electron-44-47848F.svg)](./windows/package.json)
[![License](https://img.shields.io/badge/License-MIT-D6402F.svg)](./LICENSE)

截图、取字、翻译、AI 识图、长截图、钉图与标注，集中在一个 Windows 工具里。

[简体中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md)

</div>

## 项目说明

这个仓库是 [kangarooking/Ta](https://github.com/kangarooking/Ta) 的 Windows 分支改造。原项目的 macOS/Swift 源码仍保留在 `Sources/`、`Tests/` 和 `Package.swift` 中；当前仓库的主要交付物是 `windows/` 下重新实现的 Windows 10/11 x64 客户端。

Windows 版不是把 macOS 程序套壳运行，而是针对 Windows 重新实现了屏幕捕获、DPI、多显示器、全局快捷键、托盘、剪贴板、安全存储、安装和窗口生命周期。

## Windows v1.1.11 能做什么

- **通用截图**：鼠标框选后松开即保留选区，可移动、八方向缩放，双击或按 `Enter` 完成。
- **智能框选**：鼠标移动到窗口时自动识别可见边框；单击锁定，也可以继续手动框选。
- **原色预览**：选区保持截图源原色和清晰度，选区外使用四块中性遮罩置灰。
- **快速截图**：完成后自动复制到剪贴板并保存到“最近拓片”，不打开编辑页、不阻挡用户继续粘贴。
- **本地取字**：内置简体中文和英文离线 OCR；普通截图和 OCR 不需要联网。
- **AI 识图与翻译**：支持 OpenAI-compatible、DeepSeek/兼容服务、Anthropic Claude 和 Google Gemini；实际调用的模型由“设置 → 模型服务”中当前选中的服务、Base URL 和模型名共同决定。
- **同图结果缓存**：同一张截图在取字、AI 识图和翻译之间切换时保留已完成结果；只有点击“重新识别”才再次请求。
- **标注**：矩形、椭圆、箭头、画笔、高亮、文字、编号、马赛克、模糊、橡皮、撤销和重做。大图进入标注时先完整适配视口，也可手动缩放。
- **钉图**：置顶显示，支持拖动、旋转、翻转、透明度、鼠标穿透恢复和关闭，并避免在任务栏产生一排重复图标。
- **滚动长截图**：自动滚动、帧去重与拼接；复杂动画页面可能仍需人工检查接缝。
- **可录制快捷键**：直接按下 `Alt + F1` 等组合键即可写入设置，保存时检查冲突并注册。
- **可控隐藏**：截图前可选择自动隐藏 Ta、保留 Ta 或每次询问。自动隐藏会从 Windows 合成画面中完全移除 Ta，其他软件不会被隐藏。

## 默认快捷键

| 功能 | Windows 默认值 |
|---|---|
| 极速取字 | `Ctrl + Shift + 1` |
| 通用截图 | `Ctrl + Shift + 2` |
| 快速截图 | `Ctrl + Shift + 3` |
| 截图钉图 | `Ctrl + Shift + 4` |
| 滚动长截图 | `Ctrl + Shift + 5` |
| 截图翻译 | `Ctrl + Shift + 6` |

快捷键都可以在设置页重新录制。为避免影响日常输入，普通字母和数字需要搭配 `Ctrl`、`Alt`、`Shift` 或 `Win`；`F1`–`F24` 可以单独使用。

## 使用流程

```text
快捷键或“开始截图”
        ↓
冻结当前桌面（全分辨率无损 PNG）
        ↓
窗口自动框选，或鼠标拖动自定义选区
        ↓
松开后移动/缩放，双击或 Enter 确认
        ↓
自动复制并保存
        ↓
按需取字、识图、翻译、标注、钉图或另存
```

截图覆盖层在程序启动后预热。Windows 原生辅助进程使用 GDI 冻结桌面，并在自动隐藏模式下等待 DWM 完成 Ta 的透明化与隐藏，再读取屏幕，因此不会把主窗口的淡化残影截进去。

## 安装与构建

### 使用安装包

Windows 10 22H2 或 Windows 11 x64 用户可运行本项目构建出的：

```text
windows/release/Ta-Windows-1.1.11-x64-Setup.exe
```

安装器创建桌面和开始菜单快捷方式。覆盖安装不会主动删除用户设置、加密后的 API Key 或截图历史；卸载配置为保留用户数据。

> `release/` 是本机构建目录，不提交到 Git。仓库若尚未发布 GitHub Release，请按下面步骤从源码构建。

### 从源码构建

要求：Windows 10/11 x64、Node.js 22+、npm。

```powershell
cd windows
npm ci
npm run dist
```

常用验证命令：

```powershell
npm test
npm run typecheck
npm run test:preview-fidelity
npm run smoke:e2e
```

详细说明见 [Windows 构建与使用文档](./windows/README.md)。

## 模型与隐私

- 普通截图、快速截图、标注、钉图、长截图和本地 OCR 不上传图片。
- 只有用户主动执行 AI 识图或截图翻译时，图片才会发送到当前配置的服务。
- API Key 通过 Electron `safeStorage` 使用 Windows 系统能力加密保存；仓库、日志和验收文档不记录明文密钥。
- 可开启“每次云端识图前确认”，防止误把敏感截图发送到第三方服务。
- OpenAI-compatible 服务可填写自定义 Base URL 和模型名，例如自建代理或统一模型网关；能否识图取决于该端点是否真正支持图片输入。

## 工程结构

```text
Ta/
├── windows/                    Windows Electron 客户端（当前主要交付）
│   ├── electron/               主进程、截图、OCR、AI、存储与窗口生命周期
│   ├── renderer/src/           工作台、设置、框选层、结果页、标注与钉图 UI
│   ├── resources/capture/      Windows 原生截图辅助进程
│   └── scripts/                构建、回归、E2E 与安装验收
├── docs/                       Windows 版本说明、架构和对抗审查
├── Sources/ / Tests/           上游 macOS/Swift 实现（保留）
├── Resources/                  公共品牌资源
└── LICENSE                     MIT
```

## 当前边界

- Windows 受 DRM、系统内容保护或显卡驱动保护的视频区域，仍可能由操作系统强制输出为黑色；本项目不会绕过系统保护。
- 每块显示器都有独立覆盖层；当前不支持一个选区横跨两块物理显示器。
- 滚动长截图面对视频、持续动画、半透明浮层或大幅重排页面时，拼接结果可能需要人工复核。
- AI 识图效果、速度和费用由用户选择的服务与模型决定。
- Windows 安装包尚未进行商业代码签名，SmartScreen 可能显示未知发布者提示。

## 文档与验收证据

- [Windows 版使用与构建](./windows/README.md)
- [Windows 架构说明](./docs/windows-port-architecture.md)
- [Windows v1.1.11 更新说明](./docs/release-notes-v1.1.11.md)
- [Windows v1.1.11 隐藏残影与标注适配对抗审查](./docs/windows-hide-and-editor-adversarial-review-v1.1.11.md)
- [Windows 完整验收报告](./docs/windows-acceptance.md)
- [微信式截图技术调研](./docs/wechat-screenshot-research-v1.1.9.md)

历史版本说明与问题复盘保存在 `docs/release-notes-v1.1.*.md` 和 `docs/windows-*-adversarial-review-*.md`，用于防止同类问题回归。

## 与上游同步

建议把 `kangarooking/Ta` 作为 `upstream`，把本仓库作为 Windows 产品分支维护：

- 上游 macOS/Swift 更新可以定期 `fetch`，经过评审后按需合并；
- `windows/` 尽量保持独立，通常不会与 Swift 源码直接冲突；
- README、品牌资源、公共协议和 `docs/` 可能发生冲突，应逐项人工处理；
- 不建议无条件自动同步，更不应使用强制推送覆盖 Windows 历史。

## 开源说明

Ta 使用 [MIT License](./LICENSE)。感谢原项目作者和所有贡献者。Windows 改造继续沿用“拓”的品牌与产品理念，并把实际实现、已验证能力和已知边界写进仓库，避免把规划中的功能描述成已完成。
