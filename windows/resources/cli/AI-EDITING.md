# Ta 视频编辑 CLI：给 AI 的调用说明

入口是本目录 `ta-video.cmd`。无需 API 密钥和额外运行环境，使用已安装的 Ta 与 Windows PowerShell。标准输出为 JSON，失败返回非零退出码。本 CLI 提供编辑能力；自然语言理解由调用它的 AI（例如 Codex）完成，不会自行上传录像或调用收费模型。

## 推荐工作流

1. `ta-video.cmd schema` 查询命令、操作和示例。
2. `ta-video.cmd list` 获取项目 ID；`ta-video.cmd inspect --project ID` 读取 revision、轨道和片段 ID。
3. 必要时 `ta-video.cmd frame --project ID --time 12000 --output C:\Work\frame.png`，读取原片第 12 秒的画面。frame 的时间是原片时间，不是剪辑后时间。
4. 将操作写成 UTF-8 JSON 文件，再调用 `ta-video.cmd apply --file C:\Work\plan.json --dry-run`。检查返回的项目和时长，修正错误。
5. `ta-video.cmd apply --file C:\Work\plan.json` 应用整批修改。必须使用刚读取的 revision；冲突后重新 inspect，不可直接盲目重试。
6. `ta-video.cmd export --project ID --revision N --height 1080 --output C:\Work\tutorial.mp4`。输出路径必须是绝对路径，所在目录须存在，已有文件不会覆盖。

时间单位均为毫秒；标记坐标是原片像素；视频片段 rect 和缩放中心为 0..1。片段起始时间是成片时间，素材 in/out 是原片时间，关键帧 time 相对于片段开始。

## 编辑计划示例

```json
{
  "projectId": "从 list 获取",
  "revision": 0,
  "operations": [
    {"op":"mark.add","trackId":"marks","start":1000,"end":4000,"mark":{"tool":"arrow","x":500,"y":300,"width":-200,"height":0,"color":"#FF4D37","stroke":6}},
    {"op":"mark.add","trackId":"marks","start":1000,"end":4000,"mark":{"tool":"text","x":150,"y":250,"text":"点击这里","fontSize":48,"textAutoSize":true,"rotation":0,"textDirection":"horizontal"}},
    {"op":"mark.add","trackId":"marks","start":1000,"end":4000,"mark":{"tool":"highlight","x":100,"y":100,"width":500,"height":300,"highlightMode":"spotlight","dimOpacity":0.65}}
  ]
}
```

`trackId` 以 inspect 为准。箭头 width/height 是“终点减起点”的有符号差值，允许水平、垂直和反向。

其他操作：

- `track.add`：kind 为 video/audio/mark/zoom，可指定 id 和 name；随后同一批中的 clip.add/mark.add 可以引用它。
- `clip.add`：trackId + clip，clip 的完整结构参考 inspect（id、name、asset、start、in、out、speed、volume、enabled、rect、keys）。媒体 asset 必须是项目已经注册的素材。
- `clip.split`：clipId + time。原录制画面和关联声音一起分割。
- `clip.speed`：clipId + speed，0.25–4 倍；关联声音同步变速。
- `clip.patch`：clipId + patch，可修改 start/in/out/volume/enabled/rect/name/keys，不能偷偷切换 asset/id/link。
- `clip.delete`：clipId；删除编辑片段及关联声音，不删除源文件。
- `mark.patch`：clipId + patch，可改坐标、文字、颜色、fontSize、rotation、textDirection、dimOpacity。
- `keyframe.set`：clipId + keyframe（time、scale、cx、cy），相同时刻替换。
- `import --project ID --revision N --kind audio --file C:\Work\voice.wav` 导入素材，返回注册后的 asset；再用 clip.add 放入轨道。导入保留原文件。

撤销：`undo --project ID --revision N`；重做：`redo --project ID --revision N`。一次 apply 是一次撤销操作，保存最近 50 次 CLI 编辑。若期间用户在界面继续修改，旧 CLI 历史会拒绝覆盖新版本。

正在录制/导出时返回 BUSY。编辑器打开时，写操作会先完成保存，操作后重新打开目标项目。CLI 不读取或修改 CPA、飞书凭据。请求回执保存在系统临时目录 `ta-video-cli-*`；响应不确定时先 inspect 核对 revision，避免重复应用。
