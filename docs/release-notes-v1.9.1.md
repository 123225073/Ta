# 拓 Ta Windows 1.9.1

- 新增全局快捷键 Ctrl+F1：唤起主页面。
- 新增全局快捷键 Ctrl+F2：唤起录屏与 SOP 窗口，复用已打开的窗口并保留编辑内容。
- 两个窗口最小化时先恢复，再显示并聚焦。
- 托盘菜单及设置页面显示快捷键；注册失败时设置页面提示占用情况。软件须处于运行或托盘驻留状态。

验证：类型检查、构建、145 项测试、录屏资源及截图预览保真检查通过。`scripts/launcher-hotkeys-smoke.cjs` 使用 Windows 原生按键事件，验证后台唤起、主窗口关闭后重新唤起、两个窗口最小化恢复以及窗口复用。

开发构建交互记录：`windows/output/launcher-hotkeys-1789435641003/result.json`。

打包构建交互复验：`windows/output/launcher-hotkeys-1789435825718/result.json`，全部通过。

已覆盖安装 1.9.1.0，并更新桌面快捷方式。安装前后 329 个录屏、文档与配置文件 SHA256 一致，已安装 app.asar 与验证构建一致，记录：`windows/output/install-1.9.1/install-result.json`。

已安装 EXE 独立启动通过，两个新快捷键以及原有截图快捷键全部注册成功：`windows/output/install-1.9.1/startup.json`。
