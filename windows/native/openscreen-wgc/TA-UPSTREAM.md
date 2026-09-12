# OpenScreen 复用记录

来源：https://github.com/getopenscreen/openscreen

锁定版本：v1.11.0；提交 `47ab52fd0907ed07336fa1ff868e671d5d5a469f`。

原目录：`electron/native/wgc-capture/`。MIT 许可及作者声明保留于 LICENSE。

这里实际复用了 WgcSession、Media Foundation 编码、WASAPI 输入、AudioMixer、暂停时间线、分段 MP4 和停止看门狗，并非仅参考界面。视频时间线保留片段算法的改写另见 `electron/video/model.ts`。

拓 Ta 的适配：

- Windows Unicode 命令行入口，修复中文保存路径及音频设备名。
- 在编码前裁切选区纹理，选区之外的像素不进入原录像。
- 无声 screen.mp4 加独立 mic.wav、system.wav，PCM 头每秒更新。
- 原始标记由 Electron 的排除捕获窗口展示，在项目中独立保存。
- 返回显示器真实物理范围和窗口外边框坐标，兼容高 DPI 的取整。
- 捕获尺寸变化通知；音轨写入失败会终止录制并保留已写入片段。
- 适配本机 Windows 19041 SDK：C++17 /await，保留系统自带录制边框。

`scripts/adapt-openscreen-recorder.cjs` 从锁定提交重放 main.cpp 和 wgc_session.cpp 适配。它需要 `.work/openscreen` 上游检出；日常构建直接使用本目录已纳入项目的源码，不依赖联网。

构建：`npm run build:video`。脚本使用 Visual Studio C++ Build Tools 与 CMake/Ninja；可通过 TA_CMAKE / TA_NINJA 指定位置。上游的音频样本测试随构建运行。

没有引入 OpenScreen 的云分享、AI 服务、摄像头、Rust 合成插件或完整桌面程序。编辑界面与 SVG 标记是拓 Ta 的实现，FFmpeg 负责本地合成与成片输出。
