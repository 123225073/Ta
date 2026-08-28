# Ta Windows v1.1.9：微信式截图交互与自动边框识别研究

> 研究日期：2026-08-28
> 范围：Windows 截图框选的视觉规则、窗口/控件自动吸附、Electron + Win32 实现路线
> 结论性质：微信界面行为来自实际截图与公开资料观察；微信内部实现没有公开，本文涉及其算法的内容均为工程推断，不代表腾讯官方实现。

## 1. 结论先行

Ta v1.1.9 建议采用“**冻结桌面画面 + Electron 只负责渲染交互 + Windows 原生辅助进程一次性枚举候选边框**”的路线：

1. 框选区域必须显示冻结截图的原始颜色；只给选区外侧加一层半透明暗色蒙版，不能给整张截图加透明层后再试图把选区设为透明。
2. 开始截图时，同时冻结画面和窗口候选列表。鼠标移动只在本地候选数组中命中测试，不在每次 `mousemove` 时跨进程查询 Win32/UI Automation。
3. v1.1.9 首先实现稳定的“顶层窗口自动吸附”；控件级吸附作为下一层能力，放在独立原生线程/进程中并设置超时；像素边缘检测只做兜底。
4. 自动框选只是预选，不应直接确认。单击锁定候选，拖动超过阈值立即切换为手动画框；锁定后仍可移动、缩放，双击确认。
5. 当前 Ta 选区发暗的直接原因已经可以从代码确定：全屏 `::after` 蒙版覆盖在截图之上，选区的 `background: transparent` 无法“挖掉”这层蒙版；选区外又叠加了大范围 `box-shadow`，还会发生双重变暗。

这条路线既能复现用户可观察到的微信式体验，也避免截图启动后鼠标卡顿、底层应用被误点击、混合 DPI 错位等问题。

## 2. 证据等级与边界

| 结论 | 证据 | 可信度 |
|---|---|---:|
| 微信式截图的选区保持原色、选区外变暗，选区有明显边框与控制点 | 用户提供的微信截图实测画面 | 高 |
| 鼠标悬停窗口时可预选，单击锁定，拖动可改为自由矩形 | 公开使用说明的行为描述；也与 Windows 截图工具的通用交互一致 | 中 |
| 微信使用 Win32、UI Automation 或像素边缘检测中的某一种实现 | 微信没有公开内部代码或技术说明 | 未确认，只能推断 |
| Win32/DWM 可提供顶层窗口及可见边框，UIA 可提供控件边界 | Microsoft 官方 API 文档 | 高 |
| Electron 自身可捕获屏幕/窗口，但不能直接返回任意窗口矩形或 UI 控件树 | Electron 官方文档 | 高 |

没有找到腾讯公开的微信 Windows 截图算法、源代码或架构说明。因此，本文只把微信当作**交互结果参考**，具体技术方案依据 Microsoft 与 Electron 的公开能力设计。

公开资料对微信截图功能的补充说明：IT之家转述“微信派”功能介绍时列出了标注、翻译、文字识别、打码、取色和选区像素尺寸等能力，但这仍不是内部实现文档。[IT之家：微信截图隐藏功能](https://m.ithome.com/html/976379.htm)

## 3. 目标交互：用户能直接感知的规则

### 3.1 视觉规则

截图模式开始后：

- 桌面内容应立即冻结，避免底层页面继续动画或刷新。
- 尚未找到候选时，可以整屏轻度变暗。
- 鼠标进入可识别窗口后，候选矩形内部恢复为冻结画面的原始颜色，外部保持统一变暗。
- 选区内部不能叠加 `opacity`、灰色遮罩、`filter` 或 `mix-blend-mode`。
- 选区边框、尺寸标签、拖拽控制点和工具栏属于覆盖层，不写入最终截图。
- 变暗强度只应用一次，不能出现“全屏暗层 + 外部阴影”的双重变暗。

Microsoft 对截图工具的公开说明同样把“进入捕获模式后屏幕变暗”作为基础表现，并提供窗口捕获模式；这支持将自动窗口选择视作 Windows 用户熟悉的交互，而不是 Ta 的特殊规则。[Microsoft：使用截图工具捕获屏幕截图](https://support.microsoft.com/zh-CN/windows/apps/use-snipping-tool-to-capture-screenshots)

### 3.2 状态机

建议把“悬停候选”和“已锁定选区”分为两个状态，不要共用一个 `selection`：

```text
PREPARING
  -> READY_NO_TARGET
       -> HOVER_TARGET       鼠标命中窗口/控件候选
       -> DRAWING_MANUAL     鼠标按下并移动 > 4 DIP
  -> HOVER_TARGET
       -> LOCKED             单击且移动 <= 4 DIP
       -> DRAWING_MANUAL     拖动 > 4 DIP，手动画框优先
  -> LOCKED
       -> MOVING             拖选区内部
       -> RESIZING           拖 8 个控制点
       -> DRAWING_MANUAL     在选区外重新拖动
       -> CONFIRMED          双击选区 / Enter / 完成按钮
  -> CANCELLED               Esc
```

关键规则：

- 悬停只预览，不能自动完成截图。
- 单击锁定自动候选；拖动优先解释为用户手动画框。
- 拖动阈值建议为 `4 DIP`，而不是仅凭 `mousedown` 判定。
- 锁定后仍保留移动和八方向缩放。
- 双击候选或锁定选区可确认，继续保留 Enter 与完成按钮。
- 没有有效候选时自动退回手动画框，不能阻塞截图。

Microsoft PowerToys 的官方交互规格也采用“背景变暗、鼠标悬停高亮窗口、点击选择窗口，同时保留自由矩形和全屏模式”的组合，可作为 Ta 的公开一手交互基准。[PowerToys：Video GIF Capture 规格](https://github.com/microsoft/PowerToys/wiki/Video-GIF-Capture)

## 4. Ta 当前问题的根因

当前 `windows/renderer/src/styles.css` 同时存在两层变暗：

- `.capture-overlay::after` 覆盖整个冻结画面，使用半透明黑色背景；
- `.selection-box` 又用超大 `box-shadow` 给选区外变暗；
- `.selection-box { background: transparent }` 只能让选区自身不再新增颜色，无法穿透并移除已经位于其下方的全屏 `::after`。

因此当前效果必然是：选区内部也变暗，选区外部更暗。这不是截图源颜色错误，而是覆盖层合成错误。

推荐修复方式按优先级排序：

1. **四片蒙版（推荐）**：根据当前候选/选区生成 top、left、right、bottom 四个矩形，只覆盖选区外部。边界明确，避免超大阴影在大分辨率或缩放场景出现渲染异常。
2. 单层超大阴影：关闭全屏 `::after`，只保留选区的外部阴影。改动较少，但不如四片蒙版易测试和裁剪。
3. CSS `clip-path` 镂空：可以实现，但复杂多屏尺寸、GPU 合成和 Chromium 版本差异使其不适合作为首选。

无论采用哪种方式，都不能把 `opacity` 或 `filter` 设置在包含背景截图的共同父节点上。

## 5. 推荐架构

### 5.1 数据流

```text
快捷键/按钮
   -> 主进程发起一次 captureId
      -> 原生辅助进程：冻结屏幕原始像素
      -> 原生辅助进程：同一时刻枚举窗口候选
      -> 主进程：按显示器裁剪并转换坐标
      -> 预热的 Electron 覆盖层：一次接收图片 + snapTargets
         -> mousemove：纯本地命中测试
         -> click/drag：状态机锁定或手动画框
         -> confirm：用原始 BGRA/无损源裁剪并复制
```

冻结画面以后必须使用同一批缓存候选。若悬停时再实时查询底层窗口，候选边框可能与已经冻结的图像不一致，并可能把截图覆盖层自己识别为目标。

### 5.2 为什么 Electron 不能单独完成

Electron 的 `desktopCapturer.getSources()` 可以返回屏幕和窗口媒体源及缩略图，但不提供完整的窗口 Z 序、任意 Win32 窗口准确矩形或 UI Automation 控件树。[Electron：desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) [Electron：DesktopCapturerSource](https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source)

因此建议保留 Ta 现有“Electron + `ta-capture-host.ps1` 原生辅助进程”结构，而不是在渲染进程内增加高频系统调用。

## 6. P0：顶层窗口自动吸附

### 6.1 原生候选采集

在 `windows/resources/capture/ta-capture-host.ps1` 的同一次捕获请求中，通过 P/Invoke 返回顶层窗口候选：

1. 使用 [`EnumWindows`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows) 枚举顶层窗口。
2. 记录枚举得到的 Z 序；Windows 的窗口 Z 序概念见 [`Window Features`](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features)，也可结合 [`GetWindow`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindow) / [`GetTopWindow`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-gettopwindow) 验证。
3. 优先通过 [`DwmGetWindowAttribute`](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmgetwindowattribute) 获取 `DWMWA_EXTENDED_FRAME_BOUNDS`，它比 `GetWindowRect` 更接近用户看见的窗口边框。
4. DWM 失败时回退 [`GetWindowRect`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect)。该 API 可能包含不可见的调整大小边框，并受 DPI 虚拟化影响，不能直接当最终本地坐标。
5. 使用 `DWMWA_CLOAKED` 排除被系统隐藏的窗口；使用 [`IsIconic`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-isiconic) 排除最小化窗口。

候选过滤条件：

- 排除 Ta 主进程、覆盖层、钉图窗口对应的 PID/HWND；
- 排除不可见、最小化、cloaked、空矩形、极小矩形；
- 排除与所有显示器都不相交的矩形；
- 不要用“窗口标题非空”作为硬条件，无标题应用同样可能是有效目标；
- 对跨屏窗口按每个显示器裁剪，分别发送给对应覆盖层；
- 重叠候选按捕获瞬间的 Z 序选择最上方命中项。

建议数据结构：

```ts
type SnapTarget = {
  id: string
  kind: 'window' | 'control' | 'pixel'
  rect: { x: number; y: number; width: number; height: number }
  z: number
  hwnd?: string
  title?: string
}
```

这里的 `rect` 到达渲染层前应已经转换为该显示器覆盖层的本地 DIP 坐标。

### 6.2 渲染层命中测试

在渲染层新增纯函数模块，例如 `windows/renderer/src/snap-targets.ts`：

- 输入：本地鼠标点、候选数组、上一次候选；
- 输出：当前最优候选；
- 先过滤包含鼠标点的矩形，再按 Z 序、面积和类型确定候选；
- 同一候选内移动时不更新 React 状态；只有候选 ID 改变才重新渲染；
- 在边界附近加入 2–4 DIP 滞回区，避免鼠标轻微抖动导致候选闪烁。

禁止在 `mousemove` 中使用同步 IPC、PowerShell 调用、UIA 查询或重新截屏。

## 7. P1：控件级吸附

顶层窗口吸附稳定后，可增加控件级候选。Windows UI Automation 的 `ElementFromPoint` / `AutomationElement.FromPoint` 能按物理屏幕坐标查找元素；元素的 `BoundingRectangle` 也是物理屏幕坐标。[Microsoft：Obtaining UI Automation Elements](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-obtainingelements) [Microsoft：AutomationElement.FromPoint](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.frompoint?view=windowsdesktop-10.0) [Microsoft：UIA BoundingRectangle 属性](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-automation-element-propids)

但是 UIA 有三个必须接受的边界：

- 并非所有应用都暴露高质量 UIA 树；游戏、自绘界面、部分 Chromium/SAP 画面可能只返回粗粒度节点。
- `BoundingRectangle` 可能包含不可点击区域或被其他窗口遮挡的部分。
- UIA 查询可能很慢甚至卡住 UI 线程，Microsoft 明确建议在独立线程处理 UI Automation 客户端调用。[Microsoft：UI Automation Threading Issues](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-threading-issues)

因此实现规则应为：

1. UIA 只在独立原生线程或辅助进程执行。
2. 设置短超时；超时立即回退顶层窗口候选。
3. 对结果做有效性检查：矩形有限且非空、包含鼠标、位于父窗口内、不是 Ta 自身、尺寸合理。
4. 对同一候选连续两次结果或使用短滞回确认，避免层级跳动。
5. 可通过 UIA 缓存减少跨进程属性读取，但仍不能在 Electron 主线程同步调用。[Microsoft：Caching UI Automation Properties and Control Patterns](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-cachingforclients)

P1 不应阻塞 v1.1.9 的窗口级功能发布。

## 8. P2：像素边缘检测兜底

当 Win32 窗口候选无效、UIA 不可用时，可以在冻结截图上做轻量像素边缘检测。Microsoft PowerToys Screen Ruler 的官方说明公开了“基于图像边缘检测、快照模式/连续模式、像素容差”等设计，其开源实现可作为算法参考。[PowerToys：Screen Ruler 文档](https://github.com/MicrosoftDocs/windows-dev-docs/blob/docs/hub/powertoys/screen-ruler.md) [PowerToys：ScreenCapturing.cpp](https://github.com/microsoft/PowerToys/blob/main/src/modules/MeasureTool/MeasureToolCore/ScreenCapturing.cpp)

适合的兜底策略：

- 仅处理鼠标附近的冻结 BGRA 数据，不重新抓屏；
- 沿四个方向寻找颜色/亮度变化超过容差的边缘；
- 设最大搜索距离与最小矩形尺寸；
- 对纯色 UI、表格、对话框可能有效；
- 对照片、渐变、阴影、纹理背景容易误判，因此优先级低于 Win32/UIA。

像素法不能宣传为“准确识别控件”，只能标记为智能边缘兜底。

## 9. 色彩与清晰度

修复蒙版以后，用户看到的选区仍可能因为当前预览链路而与原画面略有差异。现有原生辅助进程会先发送最大宽度约 896 像素、JPEG 质量 76 的预览，再保留完整 BGRA；JPEG 和缩放都会改变颜色与文字锐度。

建议二选一：

- **严格保真**：覆盖层直接使用全分辨率无损 PNG 或原始像素转换后的无损图像；
- **低延迟优先**：先显示快速预览，在后台准备好全分辨率无损图后原子替换，替换时保持鼠标、候选和选区坐标不变。

最终保存/复制必须继续从原始 BGRA 或其他无损源裁剪，不能从带蒙版的覆盖层截图，也不能从 JPEG 预览裁剪。Electron `nativeImage` 支持裁剪、缩放、PNG/JPEG 和 bitmap 转换，可用于主进程侧的图像处理，但应避免不必要的有损往返。[Electron：nativeImage](https://www.electronjs.org/docs/latest/api/native-image)

## 10. 混合 DPI 与多显示器

Win32、DWM 和 UIA 返回的坐标体系并不总与 Electron 的 DIP 坐标一致：

- UIA 使用物理屏幕坐标。[Microsoft：UI Automation and Screen Scaling](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-screenscaling)
- Electron `screen.getCursorScreenPoint()` 返回 DIP；`screenToDipRect` / `dipToScreenRect` 用于物理屏幕坐标与 DIP 的转换。[Electron：screen](https://www.electronjs.org/docs/latest/api/screen/)
- Electron `Display.bounds` 是 DIP，`scaleFactor` 描述显示器缩放。[Electron：Display](https://www.electronjs.org/docs/latest/api/structures/display)

正确转换流程：

1. 原生层始终返回物理屏幕矩形。
2. 主进程使用 `screen.screenToDipRect(null, physicalRect)` 转为全局 DIP。
3. 减去目标 `display.bounds.x/y`，得到覆盖层本地 DIP。
4. 跨屏窗口先按物理显示器边界裁剪，再分别转换。
5. 不要用单个 `scaleFactor` 对跨越不同缩放率的全局坐标整体乘除。

原生捕获进程应在创建窗口或调用坐标相关 API 之前声明 Per-Monitor V2 DPI awareness；Microsoft 建议优先通过应用清单设置默认 DPI awareness。[Microsoft：Setting the default DPI awareness for a process](https://learn.microsoft.com/en-us/windows/win32/hidpi/setting-the-default-dpi-awareness-for-a-process) [Microsoft：SetProcessDpiAwarenessContext](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setprocessdpiawarenesscontext)

## 11. 性能、输入与安全边界

### 11.1 不干扰底层应用

不要为了探测鼠标下方窗口而反复调用 Electron `setIgnoreMouseEvents(true)`。该方法会让鼠标事件穿透覆盖层并传给底层窗口，可能触发悬停、菜单甚至点击，违背“截图期间其他软件保持不变”的要求。[Electron：BrowserWindow.setIgnoreMouseEvents](https://www.electronjs.org/docs/latest/api/browser-window)

正确方式是：覆盖层持续接管输入；窗口矩形在开始截图时缓存；命中测试完全在覆盖层本地完成。

### 11.2 截图源与受保护内容

Windows Graphics Capture 和 Desktop Duplication 都是可选捕获技术，Microsoft 分别提供了官方说明。[Microsoft：Screen capture](https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture) [Microsoft：Desktop Duplication API](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api)

Ta 当前 GDI 路径可先保留，因为本次目标是交互与边框识别；若未来需要更稳定的高帧率/高分辨率采集，再评估 WGC 或 Desktop Duplication。受 DRM 或系统保护的内容仍可能呈现黑色，这是 Windows 安全边界，不应尝试绕过。

Ta 自身覆盖层应继续使用系统支持的排除捕获能力。Electron 的 `setContentProtection(true)` 在 Windows 映射为 `WDA_EXCLUDEFROMCAPTURE`；Microsoft 同时提醒该 API 不是严格的内容安全/DRM 保证。[Electron：BrowserWindow.setContentProtection](https://www.electronjs.org/docs/latest/api/browser-window) [Microsoft：SetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)

### 11.3 Electron 安全基线

新增原生候选数据后仍应保持：`contextIsolation: true`、`nodeIntegration: false`、预加载层只暴露明确方法、IPC 校验矩形与数组长度、拒绝渲染层传入任意命令。参考 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)。

## 12. 对 Ta 文件的落地建议

| 文件 | 建议变更 |
|---|---|
| `windows/resources/capture/ta-capture-host.ps1` | 同一次截图返回顶层窗口候选；接收需要排除的 PID/HWND；保留物理坐标与 Z 序 |
| `windows/electron/contracts.ts` | 新增 `SnapTarget`，在 `OverlayPayload` 增加 `snapTargets` |
| `windows/renderer/src/types.ts` | 同步渲染层类型，确保矩形已经是本显示器本地 DIP |
| `windows/electron/main.ts` | 捕获时统一生成 `captureId`、屏幕图像和候选快照；按显示器裁剪/转换候选；禁止 hover 阶段重新查询 |
| `windows/renderer/src/snap-targets.ts` | 新增纯函数：过滤、命中、Z 序排序、滞回与手动优先规则 |
| `windows/renderer/src/CaptureOverlay.tsx` | 分离 `hoverCandidate` 与 `selection`；加入预选、锁定、手动画框优先的状态机 |
| `windows/renderer/src/styles.css` | 删除“全屏蒙版仍覆盖选区”的组合，改为四片外部蒙版；候选出现后选区内部保持原色 |

建议先完成窗口级 P0 与视觉修复，不把 UIA 控件级识别绑进同一个发布门槛。

## 13. 对抗式审查清单

实现时必须主动覆盖下列失败模式：

| 风险 | 防护 |
|---|---|
| 把覆盖层自身识别为窗口 | 原生枚举时排除 Ta 的 PID/HWND；使用捕获瞬间缓存 |
| 底层页面被鼠标操作 | 覆盖层接管输入，不使用鼠标穿透探测 |
| 选区内仍变暗 | 只渲染选区外四片蒙版；像素级回归测试 |
| 外部双重变暗 | 页面任何时刻只允许一层暗色合成 |
| 重叠窗口选错 | 按捕获瞬间 Z 序选择最上层命中候选 |
| 最小化/虚拟桌面窗口被选中 | 排除 `IsIconic`、`DWMWA_CLOAKED` 和不可见窗口 |
| 无标题窗口被错误过滤 | 不把标题作为可选性的必要条件 |
| 混合 DPI 偏移 | 物理坐标按显示器转换为 DIP，不进行全局单倍率换算 |
| UIA 卡住截图 | 独立线程/进程、短超时、立即回退窗口候选 |
| 候选边缘闪烁 | 候选 ID 去重 + 2–4 DIP 滞回 |
| 自动吸附妨碍手动画框 | 移动超过 4 DIP 后手动模式拥有最高优先级 |
| 预览有色差/模糊 | 使用无损全分辨率或异步替换；最终裁剪只用原始像素 |
| 受保护视频为黑色 | 接受并提示系统保护边界，不尝试绕过 |

## 14. v1.1.9 验收标准

### 14.1 视觉与颜色

- 在纯红、纯绿、纯蓝、灰阶和照片测试图上，选区内部渲染像素与冻结源一致；无损链路要求逐通道完全一致，有不可避免转换时最多允许每通道误差 1。
- 选区外平均亮度明显低于选区内，但不能全黑。
- 不存在全屏暗层与外部蒙版叠加造成的双重变暗。
- 连续截图 20 次，不出现逐次变暗、旧截图污染或覆盖层被截入。

### 14.2 交互

- 鼠标悬停重叠测试窗口时，高亮最上层有效窗口。
- 单击锁定候选；移动鼠标不丢失选区。
- 拖动超过 4 DIP 时立即进入手动画框，不被自动候选抢回。
- 锁定后可移动、八方向缩放；双击、Enter、完成按钮均可确认；Esc 取消。
- 没有候选、无标题窗口、自绘窗口场景都能回退手动框选。

### 14.3 DPI 与多屏

- 覆盖 100%、125%、150%、200% 缩放及负坐标副屏。
- 候选边框与真实窗口可见边界的误差不超过 1 个物理像素；若系统阴影被有意排除，需固定为可说明的 DWM 可见边界规则。
- 跨屏窗口在每个显示器上裁剪正确，不越过覆盖层边界。

### 14.4 性能

- 截图触发后覆盖层继续沿用当前低延迟目标，不因候选枚举阻塞首帧；必要时先显示截图，再异步补充候选。
- 连续处理 1000 次指针移动时无同步 IPC、无原生查询、无重新抓屏。
- 本地候选命中计算 p95 不超过 4 ms；同一候选内移动不触发无意义状态更新。
- 鼠标移动无可感知停顿，底层应用不收到点击或 hover 副作用。

## 15. 发布建议

v1.1.9 最小可发布范围：

1. 修复蒙版合成，保证选区内原色、选区外单层变暗。
2. 增加顶层窗口候选快照和悬停自动框选。
3. 完成点击锁定、拖动覆盖自动候选、移动/缩放、双击确认。
4. 完成混合 DPI、多屏、重叠窗口、Ta 自身排除、连续截图的自动化与人工验收。

UIA 控件级吸附和像素边缘兜底可后续迭代。这样可以先交付用户最常见、可验证、低误判的“微信式窗口自动框选”，避免为了追求一次性识别所有控件而重新引入启动延迟和鼠标卡顿。

## 16. 主要一手资料

- [Microsoft Win32：EnumWindows](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows)
- [Microsoft DWM：DWM_WINDOW_ATTRIBUTE](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)
- [Microsoft UI Automation：Obtaining UI Automation Elements](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-obtainingelements)
- [Microsoft UI Automation：Threading Issues](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-threading-issues)
- [Microsoft PowerToys：Screen Ruler](https://github.com/MicrosoftDocs/windows-dev-docs/blob/docs/hub/powertoys/screen-ruler.md)
- [Electron：desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [Electron：screen](https://www.electronjs.org/docs/latest/api/screen/)
- [Electron：BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)

以上资料证明的是 Windows/Electron 可用能力和公开交互基准，不证明微信采用了同一套内部实现。
