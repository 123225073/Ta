# Ta Windows 移植架构

## 为什么没有直接编译 Swift 工程

原应用的窗口、截图、OCR、快捷键与密钥存储分别依赖 AppKit/SwiftUI、ScreenCaptureKit、Apple Vision、Carbon 与 macOS Keychain。这些框架在 Windows 不存在。Windows 版因此采用独立 Electron 44 系统层，同时保留原仓库的 macOS 源码、MIT License、品牌资源、功能术语与隐私原则。

## 目录

```text
windows/
├── electron/
│   ├── main.ts          窗口、托盘、快捷键、截图、剪贴板与 IPC
│   ├── store.ts         设置、安全密钥引用和本地历史
│   ├── ocr.ts           随包离线中英 OCR
│   ├── ai.ts            OpenAI / Anthropic / Gemini 协议适配
│   ├── stitch.ts        长截图帧差、位移匹配与拼接
│   └── preload.ts       最小权限渲染层接口
├── renderer/src/
│   ├── App.tsx          工作台、设置、结果与历史
│   ├── CaptureOverlay.tsx 多显示器框选层
│   ├── Editor.tsx       非破坏性标注编辑器
│   └── PinWindow.tsx    置顶钉图窗口
├── scripts/             资源准备和真实启动/E2E 烟测
└── package.json         v1.1.8 与 NSIS 打包配置
```

## 安全边界

- 渲染层启用 `contextIsolation`、禁用 `nodeIntegration`、启用 sandbox，只能调用 preload 暴露的白名单方法。
- API Key 由 Electron `safeStorage` 使用 Windows 当前用户安全上下文加密，设置页只显示“已保存”，不回传明文。
- `ta-media` 自定义协议只根据本地历史索引读取已知图片，不接受任意文件路径。
- 本地 OCR 不联网；AI 识图和翻译必须由用户主动点击，并可开启逐次上传确认。
- 历史目录限制 40 张，删除只针对索引中的精确文件名。

## Windows 系统映射

| macOS 能力 | Windows 实现 |
|---|---|
| ScreenCaptureKit | Electron `desktopCapturer` + 每显示器覆盖窗口 |
| Apple Vision | 随包 Tesseract.js `chi_sim+eng` |
| Carbon Hot Keys | Electron `globalShortcut` |
| NSPasteboard | Electron 44 ClipboardItem API |
| Keychain | Electron `safeStorage` |
| NSPanel 钉图 | frameless `BrowserWindow` + always-on-top |
| CGEvent 自动滚动 | PowerShell 调用 Win32 `mouse_event` |
| Swift 图像拼接 | Sharp + 灰度采样位移匹配 |
| DMG | electron-builder NSIS 安装器 |
