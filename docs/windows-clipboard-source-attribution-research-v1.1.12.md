# Ta Windows v1.1.12：外部截图剪贴板来源识别研究

> **v1.2.0 产品决策更新（2026-08-28）**：正式版采用内置可信身份与截图上下文，不要求终端用户做校准。微信使用真实专属格式，QQ 使用已签名专用截图进程，飞书使用默认截图快捷键与剪贴板 sequence 绑定；识别不确定时失败关闭，并保留素材库聚焦粘贴、文件导入和单应用“所有图片”兼容模式。下文的用户校准方案仅保留为历史研究。

> 研究日期：2026-08-28
>
> 范围：Windows 剪贴板图片更新时识别来源应用，并按飞书、微信、QQ等应用白名单决定是否自动进入“拓”
>
> 证据边界：Windows / Electron 能力依据官方文档；微信和飞书信息中的“本机证据”仅代表本机当前版本与本次采样，不代表厂商长期接口承诺。

## 1. 结论

这个方向**可行，但必须分清两层能力**：

1. **识别是哪一个应用写入了图片：可行，可靠性较高。** Windows 可以在剪贴板变化时取得当前剪贴板所有者窗口，再映射到进程、可执行文件路径和数字签名。因此可以配置“只允许飞书，微信和 QQ 不允许”。
2. **识别该应用执行的是“截图完成”还是“普通复制图片”：Windows 没有统一、可靠的标准字段。** `WM_CLIPBOARDUPDATE` 只表示内容变化，消息参数不携带来源或动作；标准图片格式也只表示数据类型，不表示“截图”。
3. **严格区分仍然有机会做到。** 若某个截图工具会额外写入专属注册格式，可以把“可信来源应用 + 截图专属格式指纹”组合为严格规则。本机当前微信截图已经观察到 `WeChatScreenshotFormat` 和 `application/x-capturer-status`；飞书必须先做“截图完成 / 普通复制图片 / 复制文字”三组 A/B 采样，确认是否存在稳定差异。

因此建议第一版提供两种模式，但默认使用严格模式：

- **严格截图模式（推荐）**：来源应用身份匹配，并且截图格式指纹匹配，才自动导入。
- **该应用的所有图片模式**：只要该应用写入图片就导入；会把应用内普通复制的图片也导入，必须明确提示。

当来源无法解析、签名不可信、格式指纹未校准或剪贴板已再次变化时，一律不自动导入，保留用户主动粘贴/导入作为兜底。

## 2. 官方能力链

Windows 可实现下面的数据链：

```text
AddClipboardFormatListener
  -> 收到 WM_CLIPBOARDUPDATE
  -> GetClipboardSequenceNumber 记录本次变化序号
  -> GetClipboardOwner 取得最后写入数据的所有者 HWND
  -> GetWindowThreadProcessId 将 HWND 映射为 PID
  -> OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)
  -> QueryFullProcessImageNameW 取得实际可执行文件路径
  -> WinVerifyTrust 校验 Authenticode 签名是否可信且文件未被篡改
  -> 枚举剪贴板格式并取得注册格式名称
  -> 应用身份白名单 + 截图格式指纹判断
  -> Electron clipboard.read() 读取图片
  -> 再次核对 sequence，校验尺寸和哈希后写入拓的本地历史
```

关键事实：

- `AddClipboardFormatListener` 会让指定窗口在剪贴板内容变化时收到 `WM_CLIPBOARDUPDATE`。
- `WM_CLIPBOARDUPDATE` 的 `wParam`、`lParam` 都未使用，因此事件本身不提供来源应用或“截图动作”。
- `GetClipboardOwner` 通常返回最后把数据放入剪贴板的窗口，但也可能返回 `NULL`；Microsoft 明确说明即使没有所有者，剪贴板仍可能有数据。
- `GetWindowThreadProcessId` 可以把所有者窗口映射到进程 ID。
- `QueryFullProcessImageNameW` 可在拥有 `PROCESS_QUERY_LIMITED_INFORMATION` 权限时取得进程映像路径；权限不足或进程已退出时可能失败。
- Electron 44 的 `clipboard.read()` 能读取标准 MIME 类型和原始平台剪贴板格式，但 Electron 没有提供剪贴板来源进程 API。Electron 的 `BrowserWindow` 能取得 Windows `HWND` 并挂接 Windows 消息，来源解析仍需要 Win32 辅助层。

结合当前仓库，推荐新增独立的常驻 Windows 剪贴板辅助进程，由它创建隐藏消息窗口、注册监听并在事件到达时立即快照 sequence、owner、PID、路径和格式；再把结构化事件发给 Electron 主进程。当前项目已有 `windows/resources/capture/ta-capture-host.ps1` 的长期 PowerShell + C# P/Invoke 模式，可以沿用相同部署思路，但不应把高频来源查询拆成“每次事件临时启动一个 PowerShell”。本研究不修改代码。

## 3. 推荐严格规则

严格模式必须同时满足以下条件，任何一步失败都拒绝自动导入：

1. 功能总开关已开启，目标应用规则已启用。
2. 本次 `GetClipboardSequenceNumber` 尚未处理。
3. `GetClipboardOwner` 返回有效 HWND，并能立即解析出 PID 和进程路径。
4. 来源不是“拓”自身进程，避免拓截图写入剪贴板后被重复收录。
5. 路径与用户校准时记录的实际程序相符。不能只比较 `Feishu.exe`、`Weixin.exe`、`QQ.exe` 文件名。
6. `WinVerifyTrust` 校验成功，签名发布者与校准记录相符。产品名、公司名和进程名只用于显示，不能单独作为安全身份。
7. 剪贴板包含可接受的图片格式，并满足该应用经过 A/B 校准得到的截图格式指纹。
8. 拒绝 `CF_HDROP` 等文件列表场景，避免把用户复制图片文件误当截图；其他排除格式由各应用 A/B 结果决定。
9. 读取前后 sequence 保持一致；若期间剪贴板再次变化，放弃旧事件。
10. 图片通过现有像素数量/尺寸上限校验，并以内容哈希去重；自动导入只落本地历史，不自动调用 AI。

白名单身份建议保存：规范化可执行文件路径、签名发布者、签名证书指纹、校准时应用版本、允许的进程路径集合、必需/排除的格式指纹。签名证书或路径在应用升级后改变时，应暂停该规则并要求重新确认，不能静默放宽为同名进程。

三类策略的准确边界：

| 策略 | 浏览器/Office 普通复制会误入 | 同一飞书内普通复制图片会误入 | 建议 |
|---|---:|---:|---|
| 只看“剪贴板有图片” | 会 | 会 | 禁止 |
| 来源应用白名单 | 不会 | 可能 | 作为兼容模式 |
| 来源白名单 + 截图格式指纹 | 不会 | A/B 通过后可大幅降低 | 默认严格模式 |

注册格式名不是安全凭据，其他程序也可以注册同名格式。因此 `WeChatScreenshotFormat` 之类的标记只能在来源进程路径和签名已经通过后使用，不能单独决定导入。

## 4. 设置 UI

建议在“设置 → 外部截图自动收集”中提供：

- 总开关：`允许指定软件的截图自动进入拓`，默认关闭。
- 应用规则列表：飞书、微信、QQ或用户添加的其他截图程序，各自独立开关。
- 每项显示：应用名称、实际路径、可信发布者、当前版本、识别模式、校准状态、最近一次成功识别时间。
- 模式选择：
  - `只接收确认的截图（推荐）`
  - `接收此软件复制的所有图片`
- `添加并校准软件`：用户先完成一次截图，再在同一软件中普通复制一张图片、复制一段文字；拓只记录来源和格式元数据，不保存未匹配内容，然后生成严格规则。
- 状态必须区分：`已校准`、`只识别到应用，未识别截图特征`、`应用已更新，待复核`、`签名异常，已停用`。
- 被拒绝事件只记录应用名、时间和拒绝原因，不保存图片内容；提供可清除的短期诊断记录。

推荐文案不要承诺“系统能百分之百识别飞书截图”，而应写成：

> 拓仅自动收集已允许、且通过截图特征校验的软件图片；无法确认的图片不会自动保存。

## 5. 局限

- Windows 没有标准的“这是截图”标志。同一应用的截图和普通复制若使用完全相同的进程、窗口类和格式集合，就无法通过公开剪贴板 API 做绝对区分。
- 截图工具可能通过临时子进程、OLE 窗口或系统代理写入；所有者窗口也可能在事件处理前退出。此时 `GetClipboardOwner` 可能为 `NULL`，或解析到辅助进程而非主程序。
- `GetForegroundWindow` 只能表示用户当时正在使用的前台窗口，不是剪贴板来源证明，最多作为诊断信息，不能作为白名单依据。
- 标准 `CF_BITMAP`、`CF_DIB`、`CF_DIBV5` 之间可以由 Windows 自动合成，不能据此判断截图软件。
- 注册格式属于厂商当前实现细节，不是飞书、微信或 QQ 的公开稳定接口，升级后可能改变，必须保留重新校准和手动导入兜底。
- 仅靠文件名容易被伪造；仅靠腾讯发布者也不足以区分微信、QQ和 QQ 浏览器，因为同一发布者可以签名多个产品。必须组合进程实际路径、签名和格式指纹。
- 自动监听涉及潜在敏感剪贴板内容。实现必须先判断元数据和规则，只有匹配后才读取图片；拒绝的内容不得缓存，更不得自动上传 AI。

## 6. A/B 验收

每个支持的软件、每个大版本至少采样以下场景，各连续执行 10 次：

| 场景 | 预期 |
|---|---|
| 飞书截图完成 | 严格规则匹配并自动进入拓 |
| 飞书聊天中普通复制图片 | 不进入拓 |
| 飞书复制文字 | 不进入拓 |
| 微信截图完成 | 微信规则开启时进入；只开飞书时不进入 |
| QQ 截图完成 | QQ规则开启时进入；只开飞书时不进入 |
| 浏览器复制图片 | 不进入拓 |
| 资源管理器复制 PNG/JPG 文件 | 不进入拓 |
| 拓自身截图自动复制 | 只保留拓原本写入的历史，不产生第二份 |
| 快速连续复制两张图片 | 只导入 sequence 与内容对应的目标图，不串图 |
| 允许应用升级后路径/签名/格式发生变化 | 严格规则暂停或提示重新校准，不误放行 |
| 所有者为 NULL、进程已退出、签名失败 | 不自动导入，主动粘贴仍可用 |

飞书上线门槛：必须证明“飞书截图完成”和“飞书普通复制图片”的格式指纹或所有者窗口特征至少有一个稳定差异；如果没有差异，只能提供“接收飞书的所有图片”兼容模式，不能把它宣传为严格截图识别。

## 7. 本机证据

2026-08-28 的只读探针记录到：

- 当前剪贴板 `sequence=2893`。
- `GetClipboardOwner` 返回 HWND `0x51388`，映射到 PID `2580`，实际路径为 `D:\Program Files\Tencent\Weixin\Weixin.exe`，所有者窗口类为 `CLIPBRDWNDCLASS`。
- 当时图片格式包含 `CF_DIB`、`CF_BITMAP`、`CF_DIBV5`、`image/png`、`image/jpeg`、`image/webp`，并包含 `application/x-capturer-status` 和 `WeChatScreenshotFormat`。
- `Weixin.exe`：Product=`Weixin`，Company=`Tencent`，Version=`4.1.12.26`；Authenticode 状态为 `Valid`，签名者为 `Tencent Technology (Shenzhen) Company Limited`。
- 本机飞书正在运行于 `D:\5000_Software\飞书\Feishu\app\Feishu.exe`；Product=`Feishu`，Company=`Beijing Feishu Technology Co., Ltd.`，Version=`7.75.0.76`；Authenticode 状态为 `Valid`，签名者为 `Beijing Feishu Technology Co.,Ltd.`。
- 本机尚未对“飞书截图 / 飞书普通复制图片 / 飞书复制文字”做 A/B 采样，因此目前只能确认飞书进程可以被建立可信白名单，**不能确认飞书具有可用的截图专属格式指纹**。

微信本次样本说明“来源进程 + 专属格式”路线在真实机器上有现实基础，但在完成微信普通复制 A/B 前，`WeChatScreenshotFormat` 仍只能视为强特征候选，不能视为厂商长期保证。

## 8. 官方来源链接

- [Microsoft：AddClipboardFormatListener](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-addclipboardformatlistener)
- [Microsoft：WM_CLIPBOARDUPDATE](https://learn.microsoft.com/en-us/windows/win32/dataxchg/wm-clipboardupdate)
- [Microsoft：GetClipboardSequenceNumber](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclipboardsequencenumber)
- [Microsoft：GetClipboardOwner](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclipboardowner)
- [Microsoft：Clipboard Operations](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-operations)
- [Microsoft：GetWindowThreadProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid)
- [Microsoft：OpenProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocess)
- [Microsoft：QueryFullProcessImageNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew)
- [Microsoft：WinVerifyTrust](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/nf-wintrust-winverifytrust)
- [Microsoft：Clipboard Formats](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-formats)
- [Microsoft：Standard Clipboard Formats](https://learn.microsoft.com/en-us/windows/win32/dataxchg/standard-clipboard-formats)
- [Microsoft：GetClipboardFormatNameW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclipboardformatnamew)
- [Microsoft：GetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow)
- [Electron：clipboard](https://www.electronjs.org/docs/latest/api/clipboard)
- [Electron：BrowserWindow 的 getNativeWindowHandle / hookWindowMessage](https://www.electronjs.org/docs/latest/api/browser-window)
