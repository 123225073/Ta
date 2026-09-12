# SOP 功能参考与复用

产品工作流参考（2026-09-12 核对）：Clueso Article Copilot / Custom Prompts，Glitter Magic Editor，Scribe Video Import，Trupeer Document Editing。独立实现相应行为，不复制商业产品代码、商标或界面素材。

实际开源代码复用：westpoint-io/mimik，提交 8fb183d1a80ae382a9aa033f192aa62d1c3fd23c，MIT。
- electron/sop/export-utils.ts 改写 src/core/export/utils.ts 的 escapeHtml、containFit。
- 步骤文档与图片分离、编号步骤和备注导出流程参考 src/core/export/markdown-export.ts。
- 完整许可见 electron/sop/MIMIK-LICENSE.txt。

Windows 录制仍使用此前纳入的 OpenScreen WGC/MF/WASAPI 原生代码；FFmpeg/Sharp 负责原视频抽帧、截图编辑、图文媒体处理。SOP 不更改原视频。
