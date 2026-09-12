# 视频功能的第三方组件

## OpenScreen

项目：https://github.com/getopenscreen/openscreen

版本：v1.11.0 / 47ab52fd0907ed07336fa1ff868e671d5d5a469f。

许可：MIT。完整声明见 `native/openscreen-wgc/LICENSE`，安装资源中为 `video/OpenScreen-MIT-LICENSE.txt`。

使用范围及修改说明：`native/openscreen-wgc/TA-UPSTREAM.md`。

## FFmpeg

使用 OpenScreen v1.11.0 的依赖下载脚本指定的 BtbN LGPL Windows 构建：

https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-31-14-10/ffmpeg-n8.1.2-34-g9b6c8969e0-win64-lgpl-8.1.zip

SHA256：089e4169e93b2b3f3acbfced3c0704d24276a225641bdda04d796d28b07a2a38。

通过独立可执行文件调用 ffmpeg.exe / ffprobe.exe，不链接进 Electron。使用系统或硬件 H.264 编码器，不附带 libx264。随资源保存 `FFMPEG-LICENSE.txt` 与 `FFMPEG-BUILD-CONFIG.txt`；原压缩包的完整许可文件同样随包。

上游源码及构建入口：https://github.com/FFmpeg/FFmpeg/tree/n8.1.2 与 https://github.com/BtbN/FFmpeg-Builds 。准确补丁提交以构建文件中 g9b6c8969e0 为准。

当前交付用于本机开发与使用。后续对外分发时，须按该二进制及所含库的 LGPL 许可提供准确对应的完整源码和构建材料；这里的来源链接不替代完整源码分发义务。
