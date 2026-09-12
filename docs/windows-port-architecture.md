# Ta Windows 移植架构

## 为什么没有直接编译 Swift 工程

原应用的窗口、截图、OCR、快捷键与密钥存储分别依赖 AppKit/SwiftUI、ScreenCaptureKit、Apple Vision、Carbon 与 macOS Keychain。这些框架在 Windows 不存在。Windows 版因此采用独立 Electron 44 系统层，同时保留原仓库的 macOS 源码、MIT License、品牌资源、功能术语与隐私原则。

## 目录

```text
windows/
├── electron/
│   ├── main.ts          窗口、托盘、快捷键、截图、剪贴板与 IPC
│   ├── store.ts         设置、安全密钥引用、缩略图与素材库门面
│   ├── library.ts       SQLite 索引、日期归档、迁移和批量导出
│   ├── clipboard-source.ts 外部截图来源的失败关闭判定
│   ├── ocr.ts           随包离线中英 OCR
│   ├── ai.ts            OpenAI / Anthropic / Gemini 协议适配
│   ├── stitch.ts        长截图固定边带识别、帧差、位移匹配与拼接
│   └── preload.ts       最小权限渲染层接口
├── renderer/src/
│   ├── App.tsx          工作台、设置、结果与历史
│   ├── LibraryPage.tsx  分页素材库、筛选、重命名与批量选择
│   ├── CaptureOverlay.tsx 多显示器框选层
│   ├── Editor.tsx       非破坏性标注编辑器
│   ├── PinWindow.tsx    置顶钉图窗口
│   └── LongCaptureHud.tsx 长截图采集状态浮层
├── resources/capture/ta-clipboard-monitor.ps1 剪贴板所有者与签名监听
├── scripts/             资源准备、监听验证和真实启动/E2E 烟测
└── package.json         v1.3.3 与 NSIS 打包配置
```

## 安全边界

- 渲染层启用 `contextIsolation`、禁用 `nodeIntegration`、启用 sandbox，只能调用 preload 暴露的白名单方法。
- API Key 由 Electron `safeStorage` 使用 Windows 当前用户安全上下文加密，设置页只显示“已保存”，不回传明文。
- `ta-media` 自定义协议只根据本地历史索引读取已知图片，不接受任意文件路径。
- 图片右键菜单由主进程统一创建；渲染层只能提交受校验的历史 ID、PNG 数据或当前钉图引用，不能传入任意文件路径。工作台/素材库解析原图，编辑器解析已渲染画布。
- 本地 OCR 不联网；AI 识图和翻译必须由用户主动点击，并可开启逐次上传确认。
- 素材库使用 SQLite 键集分页，不设业务数量上限；原图按日期目录长期保留，容量只受用户磁盘限制。
- 外部剪贴板先核对稳定 sequence、所有者 PID、路径、产品、公司、有效 Authenticode 发布者、证书主题/指纹和截图格式，再读取图片；读取前后再次核验同一事件。
- 卡片仅加载 Sharp 生成的受限缩略图，原图只在用户打开结果时读取；大图像素和编码字节均设上限。
- UI 删除先明确确认并移入 Windows 回收站；索引和旧历史 tombstone 在事务内更新，避免重启后复活。

## Windows 系统映射

| macOS 能力 | Windows 实现 |
|---|---|
| ScreenCaptureKit | 常驻 Win32/GDI 捕获宿主 + 每显示器覆盖窗口 |
| Apple Vision | 随包 Tesseract.js `chi_sim+eng` |
| Carbon Hot Keys | Electron `globalShortcut` |
| NSPasteboard | Electron 44 ClipboardItem API |
| 剪贴板来源 | `AddClipboardFormatListener` + Win32 所有者/签名辅助进程 |
| Keychain | Electron `safeStorage` |
| NSPanel 钉图 | frameless `BrowserWindow` + always-on-top |
| CGEvent 自动滚动 | PowerShell 调用 Win32 `mouse_event` |
| Swift 图像拼接 | Sharp + 灰度采样位移匹配 |
| DMG | electron-builder NSIS 安装器 |
