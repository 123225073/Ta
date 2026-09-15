# 1.10.0 编辑器验证记录

- `npm run dist`：录制资源检查、151 项自动化测试、截图预览保真、TypeScript 检查、构建、NSIS 安装包生成通过。
- `editor-usability-smoke.cjs`：Electron 原生鼠标和键盘测试，覆盖分割、多选、关联音频组移动、整组撤销、边缘裁剪、显式变速、批量复制粘贴、精确时间定位、缩放区域时段配置、全屏进入/退出、选中第二条同类轨后添加标记。
- 波形读取真实 440 Hz 音频素材，验证峰值非空并显示 SVG 波形。
- 真实 MP4 导出：检查保留音轨、6 秒总时长、全景/进入/保持/退出/全景五个时刻的像素。蓝色区域占画面比例依次为 0.50 / 0.70 / 1.00 / 0.70 / 0.50，符合指定区域匀速放大并返回全景。
- 开发版结果：`windows/output/editor-usability-1789444892986/result.json`。
- 打包版复验：`windows/output/editor-usability-1789445199792/result.json`，同一套交互和成片检查通过；截图在同目录 `editor-preview.png`。
- `annotation-ui-smoke.cjs` 回归通过：八个方向画箭头、单独调整端点、旋转、点选输入文字、横竖排、缩放、聚光高亮像素，以及导出与 CLI 编辑后撤销。结果：`windows/output/annotation-ui-1789444929570`。

所有测试使用隔离用户目录和合成素材，没有用用户项目执行测试修改。以上不代表长视频压力测试或自动物体跟踪验收。

桌面安装验证：已安装版本 `1.10.0.0`，已更新 `拓 Ta.lnk`；已安装 app.asar 与打包验证版本 SHA256 一致。安装前后 337 个原有录屏、文档和配置文件哈希一致。记录：`windows/output/install-1.10.0/install-result.json`。

已安装 EXE 独立启动成功，Ctrl+F1 / Ctrl+F2 及既有截图快捷键注册成功。记录：`windows/output/install-1.10.0/startup.json`。

已安装 CLI 包装脚本与真实 EXE 联调通过：schema、list、inspect、dry-run、原子 apply、版本冲突拒绝、undo/redo、原片取帧、MP4 导出及拒绝覆盖旧成片。记录：`windows/output/cli-process-1789445341619/result.json`。
