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
- 单窗口录制在尺寸变化后重新创建 WGC 帧池；通过 D3D11 视频处理器等比例适配到录制开始时的固定画幅，比例不同留黑边。拉取路径使用实际 ContentSize，丢弃过渡期间不完整纹理，短暂重试恢复帧；持续失败通知界面暂停并明确提醒。
- 适配本机 Windows 19041 SDK：C++17 /await，保留系统自带录制边框。

`scripts/adapt-openscreen-recorder.cjs` 从锁定提交重放 main.cpp 和 wgc_session.cpp 适配。它需要 `.work/openscreen` 上游检出；日常构建直接使用本目录已纳入项目的源码，不依赖联网。

该脚本随后调用 `scripts/adapt-window-resize.cjs` 重放窗口适配逻辑；辅助头文件 `ta_window_fit.h` 和 WgcSession 的内容尺寸访问器由本项目维护。桌面控制器固定使用拉取路径，旧回调回退路径不支持动态尺寸适配。

WGC 尺寸变化处理依据 [Microsoft 屏幕捕获说明](https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture) 中 ContentSize / Recreate 的约定；缩放使用 [D3D11 VideoProcessorBlt](https://learn.microsoft.com/en-us/windows/win32/api/d3d11/nf-d3d11-id3d11videocontext-videoprocessorblt)。

构建：`npm run build:video`。脚本使用 Visual Studio C++ Build Tools 与 CMake/Ninja；可通过 TA_CMAKE / TA_NINJA 指定位置。上游的音频样本测试随构建运行。

没有引入 OpenScreen 的云分享、AI 服务、摄像头、Rust 合成插件或完整桌面程序。编辑界面与 SVG 标记是拓 Ta 的实现，FFmpeg 负责本地合成与成片输出。
