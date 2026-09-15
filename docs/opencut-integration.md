# OpenCut 参考与集成取舍

本轮参考已核查的 OpenCut Classic 快照 `cf5e79e`。OpenCut 主仓库快照 `400f097` 正在重写，不能将规划中的 Editor API / MCP 当成现成可用功能。

| 参考实现 | Ta 中的应用 |
| --- | --- |
| [Classic resize-controller](https://github.com/OpenCut-app/opencut-classic/blob/cf5e79e/apps/web/src/timeline/controllers/resize-controller.ts) | 片段起止边缘、播放头与关键帧吸附；一段手势预览后提交一次历史记录 |
| [Classic command manager](https://github.com/OpenCut-app/opencut-classic/blob/cf5e79e/apps/web/src/core/managers/commands.ts) | 共用 edit-actions 层供界面和 CLI 调用；界面保留会话历史，CLI 保留带版本检查的持久历史 |
| [Classic animation types](https://github.com/OpenCut-app/opencut-classic/blob/cf5e79e/apps/web/src/animation/types.ts) | 缩放关键帧支持 smooth / linear / hold，预览与 FFmpeg 表达式采用一致规则 |
| [Classic audio waveform](https://github.com/OpenCut-app/opencut-classic/blob/cf5e79e/apps/web/src/timeline/components/audio-waveform.tsx) | 本机 FFmpeg 生成真实音频峰值；异步、按素材缓存，界面按片段入出点显示 |

以上为交互与架构参考，新增实现独立编写，未复制 OpenCut 源码。OpenCut 仓库采用 MIT，未来直接引入其源码时应同时保留对应版权和许可证声明。

保留 Ta 的 Electron、本机录制、源视频时间戳、SOP、CPA 配置、飞书、项目保存和 FFmpeg 导出。没有引入 Next.js 服务、浏览器存储或另一套视频渲染引擎。

本轮不包含任意属性贝塞尔曲线编辑、自动物体跟踪、代理媒体或 OpenCut 全量功能。保留箭头起终点、文字点选输入及聚光高亮的既有交互，并做真实鼠标回归。

验证范围：自动化命令与数据规则、Electron 实际指针/键盘操作、波形数据、全屏进出、导出音轨/时长以及局部缩放帧像素。不将源码检查或某次短素材测试描述为长视频压力验证。
