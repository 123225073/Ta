# Windows 1.9.0 标记与 CLI 验收

## 真实交互

`windows/output/annotation-ui-1789358560362/result.json`：使用 Electron 原生鼠标事件验证 8 个箭头方向（包括纯水平、纯垂直）、独立起终点拖动、90 度旋转、单击输入文字、不强制换行、横/竖排、画面旋转手柄、字号随缩放变化、高亮预览、导出，以及 CLI 保存并重新打开编辑器后用 Ctrl+Z 撤销。

测试中发现并修复：单击创建文字时浏览器默认聚焦夺走文本输入焦点；快捷栏覆盖旋转手柄。这些问题由实际指针操作发现，而不是用设置字段代替鼠标操作。

聚光预览的选区外红色像素为 `[75,11,0]`，选区内蓝色像素为 `[26,35,255]`，证明背景变暗而选区清晰。

`windows/output/editor-interaction-1789358408618/result.json`：242.2 秒视频的全屏、时间线适配、面板调整、文字移动缩放、指定轨道复制粘贴、撤销/重做、重新打开与关闭时保存输入均通过。

## 实际成片

`windows/output/annotation-render-1789358629157/result.json`：FFmpeg 导出的 MP4 逐帧验证反向水平箭头的首尾像素、聚光明暗区域，以及旋转 90 度后的竖排文字实际像素范围。使用共享 SVG 绘制逻辑，未用界面截图代替成片验证。

## CLI

`windows/output/cli-process-1789358161644/result.json`：通过独立 EXE 进程和应用单实例消息通信，完成 schema/list/inspect、预演不写入、应用整批标记、拒绝过期 revision、undo/redo、截原视频帧、导出，以及拒绝覆盖已有成片。

新增几何和 CLI 单元测试覆盖有符号箭头、尾部调整保留箭头尖端、旋转、文字方向、旧窄框兼容、旧荧光笔兼容、原始画笔轨迹移动、无效批次不写入和版本冲突。原有 144 项测试全部通过，随后新增旧文字兼容测试，并重新通过相关 19 项测试；合计 145 项。

测试使用隔离目录和合成视频，不改动用户原片、SOP 或凭据。原生屏幕枚举期间出现的 DXGI 重试日志不作为录屏捕获成功的证据；本次主要验收范围为编辑交互、成片和 CLI。

## 安装包和本机更新

最终安装包的原生鼠标交互复验：`windows/output/annotation-ui-1789358994766/result.json`，上述箭头、文字、聚光、CLI 保存重开及撤销流程通过。

安装包 EXE 经真实 PowerShell CLI 包装器完成全链路验证：`windows/output/cli-process-1789358819465/result.json`，不是直接调用内部函数代替命令行。

正式安装目录的复验发现 Windows PowerShell 5 的文件枚举顺序会先选到同产品名的卸载程序，导致 CLI 没有回执。入口已改为精确定位主程序文件名，不再依赖枚举顺序，并增加非零启动退出码提示。修正后已安装 EXE + PowerShell CLI 的完整链路通过：`windows/output/cli-process-1789359449846/result.json`，覆盖查询、预演、批量编辑、过期版本拒绝、撤销/重做、截帧和 MP4 导出。

`windows/output/install-1.9.0/install-result.json`：桌面程序产品版本 `1.9.0.0`，安装后的 app.asar 与已验收构建一致，桌面快捷方式指向安装目录。安装前后的 326 个录屏、文档和配置文件 SHA256 全部相同。

安装包为 `Ta-Windows-1.9.0-x64-Setup.exe`，最终 SHA256 记录在上述安装验收文件中。

已安装程序启动及截图/素材库回归：`windows/output/packaged-video-1789359499283/result.json`，`ready`、`libraryUiVerified` 均为 true，所需录屏资源存在。

额外测试软件未启动时调用实际 `.cmd schema`。发现 GUI 进程继承命令行管道会使外层管道一直等待；包装器改为 Shell 启动，避免继承调用方管道。修正后冷启动在约 2.7 秒返回可解析 JSON，CLI 退出而软件可继续驻留。

最终 CLI 包装器的已安装软件全链路复验通过：`windows/output/cli-process-1789359673629/result.json`。
