# Windows 录屏开发验证记录 — 1.4.0

日期：2026-09-12。证据均来自本机测试，不代表所有 Windows 设备。安装包与测试代码在当前工作区生成；已完成本机覆盖安装验证。

## 已验证

| 项目 | 实际结果 | 证据位置（相对 windows/） |
|---|---|---|
| 原生构建 | OpenScreen 原生 helper 编译成功；上游音频样本测试 18 项通过 | output-video-build.log |
| 类型与回归 | 19 个测试文件、94 项测试通过；类型检查、Vite 构建通过 | output-video-dist.log |
| 画面排除 | 背景 RGB 24/160/100，录制像素 24/158/99；被排除的标记后方没有黑块 | output/video-probe/result.json |
| 意外中断 | 终止测试录制进程后，分段 MP4 保留 3 秒；系统 WAV 仍可读 | output/video-probe/crash-result.json |
| 区域录制 | 1120×700，原片 2.733 秒；删 0.3 秒，导出 73 帧/2.433 秒 | output/video-ui-1789222432339/result.json |
| 单窗口 | 1148×714，原片 2.9 秒；删片后 78 帧/2.6 秒，无尺寸误暂停 | output/video-ui-1789222178992/result.json |
| 全屏 | 3072×1920，原片 2.733 秒；删片后 73 帧/2.433 秒 | output/video-ui-1789222277460/result.json |
| 标记与缩放 | 原片无红框；标记版/清洁版不同；2 倍放大后的同一坐标符合预期 | output/video-ui-1789222432339/result.json |
| 画笔时间 | 同一位置早期像素 34/176/96，笔迹到达后 251/255/255 | 同上 progressivePen=true |
| 原素材 | 两种导出前后 screen.mp4 SHA256 相同 | 同上 sourceHashUnchanged=true |
| 打包资源路径 | 使用 app.asar 内编辑器/主进程模块及打包的原生工具完成同样录制导出 | output/video-ui-1789222682531/result.json |
| 最终打包录屏闭环 | 恢复项目、录制、暂停、剪辑、标记、缩放、逐步笔迹、取消导出及修改后立即关闭保存全部通过 | output/video-ui-1789223444062/result.json；packaged/recovery/cancellation/closeSaved 均为 true |
| 打包程序回归 | win-unpacked 实际可执行文件运行原有截图、OCR、素材库等 E2E，录制资源齐全 | output/packaged-video-1789222617662/result.json |
| 显示主题 | 夜幕和瓷白编辑器截图已目视检查，修正选择框挤压标题和预览比例 | output/video-ui-1789222432339/editor-dark.png / editor-light.png |
| 原有功能 | 原截图 E2E、预览保真通过：截图/长截图/钉图/素材库/双主题/图片右键/OCR | 本轮 smoke:e2e / test:preview-fidelity 输出 |
| 启动快捷键 | 1.4.0 启动 smoke 通过，6 个截图快捷键注册成功 | smoke 测试采用隔离快捷键，避免与正在运行的旧版争用 |

双音轨短测使用系统回环与「立体声混音」输入；验证的是设备打开、独立文件保存及合成，不声称完成真人话音或长时同步验收。

## 修复过的真实问题

- Windows ANSI argv 损坏中文路径：改为 Unicode 入口并显式转 UTF-8。
- 高 DPI 的 DIP 尺寸取整超过显示器真实范围：由原生接口获取物理边界。
- WGC 包含窗口外边框，DWM 可见边界较小：统一为窗口外框，避免误暂停与标记坐标偏移。
- 媒体协议未被页面 CSP 包含：仅为本地受控视频协议补齐图片和媒体加载项。
- 片段分别编码 AAC 会累积延迟：视频按 30fps 对齐分段，音轨按同一保留范围统一编码。
- 编辑器退出时无条件写回旧状态：只保存脏编辑，关闭时等待保存，视频库重开读取最新项目。
- 导出临时片段体积累积：结束/取消后只清理本次导出生成的临时文件，保留原素材和最终成片。
- Windows 短暂文件占用导致项目替换出现 EPERM：增加有上限的重试，保留旧文件与待保存文件，并用模拟共享锁测试验证；持续写入失败时停止录制并保留原片。

## 未完成的验收

- 30 分钟闪光/提示音同步测量，目标偏差 ≤100ms。
- 60 分钟 CPU/GPU/内存/文件增长稳定性测试。
- 多显示器负坐标与混合 DPI、真实麦克风/设备拔插、磁盘不足、休眠组合。

当前状态：主要录屏—编辑—导出功能及安装包已实现；上述长时和设备验收仍需继续，不将整个 M0–M5 计划标记为全部完成。

## 重跑

从 windows 目录运行 `npm run build:video`、`npm run prepare:video`、`npm run dist`。使用 `npm run smoke:video` 执行受控画面录制与编辑导出检查。`TA_VIDEO_SOURCE_KIND=window` 或 `screen` 可切换来源用例；默认是 region。`TA_VIDEO_PACKAGED=1` 使用打包资源执行录屏用例。

每次 UI 用例使用独立 output/video-ui-时间戳 目录和测试画面，不读取用户录像作为测试素材。`TA_VIDEO_CRASH_PROBE=1` 只终止该用例自己启动的录制子进程。

## 1.4.0 覆盖安装验收

- 从 1.3.3 升级至 1.4.0，桌面“拓 Ta”快捷方式指向已安装的 1.4.0.0 可执行文件。
- 覆盖安装前后，37 个设置及素材库文件 SHA256 全部一致；检查发生在新版本首次正常启动前。证据：`windows/output/install-1.4.0/install-result.json`。
- 已安装 EXE 在独立测试配置目录完成截图、OCR、素材库、右键菜单等 E2E：`windows/output/packaged-video-1789224178963/result.json`。
- 从安装目录加载实际 app.asar 和原生录制/导出工具，完成 1120×700 录制、暂停、恢复、剪辑、标记跟随缩放、逐步笔迹、选择性导出、取消导出、立即关闭保存；原素材哈希不变，成片预期/实际均为 75 帧。证据：`windows/output/video-ui-1789224211305/result.json`。该用例由测试 Electron 宿主加载已安装模块；EXE 启动由上一项独立验证。
- 推送前重新通过 94 项测试及类型检查；锁文件仅调整项目版本，未升级第三方依赖。
