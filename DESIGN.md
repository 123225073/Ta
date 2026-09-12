# Design System — 拓 Ta

## Product Context

- **What this is:** Windows 本地截图、素材归档与 AI/OCR 再处理工作台。
- **Who it's for:** 高频截图、需要重复查找素材，并在意隐私与操作效率的知识工作者。
- **Space/industry:** 桌面效率工具、截图工具、个人素材管理。
- **Project type:** Electron 桌面应用。

## Aesthetic Direction

- **Direction:** 夜幕玻璃 · 电光朱砂（Obsidian Capture Lab）与瓷白典藏（Porcelain Archive）双主题。
- **Decoration level:** intentional。
- **Mood:** 夜幕主题像沉浸、锐利、可靠的数字工作台；瓷白主题像克制的高端纸品与收藏档案。朱砂红延续“拓印”品牌，绿色只表达捕获、在线和成功状态。
- **Memorable device:** 红色“拓”印章悬浮在深色轨道与扫描网格上，素材缩略图像放置在数字底片台。

## Typography

- **Display/Hero:** `Noto Serif SC` / `Source Han Serif SC` / `STZhongsong` — 中文标题具有拓印与出版物气质。
- **Body:** `Segoe UI Variable Text` / `Microsoft YaHei UI` — Windows 原生、清晰、稳定。
- **UI/Labels:** 与正文一致，使用更高字重及字距建立仪器面板感。
- **Data/Tables:** `Cascadia Mono` / `IBM Plex Mono` / `Consolas` — 快捷键、尺寸、时间和版本使用等宽数字。
- **Code:** `Cascadia Code` / `Consolas`。
- **Loading:** 正式客户端只使用本地字体，不因网络字体阻塞界面；设计预览可加载 Noto Serif SC 与 IBM Plex Mono。
- **Scale:** 9 / 10 / 12 / 14 / 18 / 24 / 38 / 56 px。

## Color

- **Approach:** restrained；大面积冷黑，中等明度文字，少量高饱和状态色。
- **Primary:** `#FF4D37` — 朱砂红；主操作、选择和品牌印章。
- **Secondary:** `#43E6C1` — 捕获薄荷；成功、运行中和可信来源。
- **Ember:** `#FF9A62` — 暖橙；高亮、提示和红色的柔和过渡。
- **Background:** `#090C0F`。
- **Surface:** `#11171C`；高层表面 `#182127`；悬浮表面 `#202B32`。
- **Text:** 主文字 `#F4F3EE`；次文字 `#A7B0B5`；弱文字 `#6F7A80`。
- **Line:** `rgba(255,255,255,.09)`；强调线 `rgba(255,77,55,.38)`。
- **Semantic:** success `#43E6C1`，warning `#FFB45B`，error `#FF5D52`，info `#62B9FF`。
- **Light mode:** 正式提供“瓷白典藏”：背景 `#F6F3EC`，表面 `#FFFDF8`，墨色 `#202629`，朱砂 `#DC3D2C`，玉石绿 `#168C78`。避免纯白刺眼和蓝灰办公软件感。

## Spacing

- **Base unit:** 4px。
- **Density:** comfortable-compact；操作密集但分组留白明确。
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)。

## Layout

- **Approach:** hybrid；核心工作区严格网格，首页英雄区与印章轨道允许不对称和叠层。
- **Grid:** 首页操作 3 列，素材库 5 列；分别在 980/820px 降为 2–4/3 列。
- **Max content width:** 1240px。
- **Border radius:** sm 6px，md 10px，lg 16px，hero 26px；不要让所有控件都使用同一种大圆角。
- **Depth:** 依靠半透明表面、1px 内描边和定向阴影，不使用大面积渐变按钮。

## Motion

- **Approach:** intentional。
- **Easing:** enter `cubic-bezier(.16,1,.3,1)`，exit `ease-in`，move `ease-in-out`。
- **Duration:** micro 80ms，short 160ms，medium 260ms，long 520ms。
- **Rules:** 页面首次进入允许一次轻量上浮；卡片只做 2–3px 位移与边框发光；尊重 `prefers-reduced-motion`。

## Safe Choices

- 保留顶部主导航、明确主按钮、日期分组和设置侧边索引，用户无需重新学习信息架构。
- 深色结果区与编辑区继续让截图本身成为视觉中心。
- 品牌主色继续使用朱砂红，避免升级后像另一个产品。

## Deliberate Risks

- 全应用从米白编辑风切换为冷黑数字工作台，获得更强沉浸感，代价是视觉变化明显。
- 标题采用中文宋体气质，界面正文保持 Windows 原生无衬线，形成“传统拓印 × 数字工具”的反差。
- 薄荷绿仅用于捕获和可信状态，不作为第二套主按钮色，以换取更清晰的状态语义。

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-29 | 建立“夜幕玻璃 · 电光朱砂”设计系统 | 用户要求界面更炫酷；统一此前米白首页与深色编辑区，并保持拓印品牌辨识度 |
| 2026-08-29 | 正式客户端坚持本地字体 | 截图工具必须离线可用，不能因字体 CDN 影响首屏与排版稳定性 |
| 2026-08-29 | 保留现有信息架构 | 本次目标是视觉和交互升级，不扩大为导航重构 |
| 2026-08-30 | 增加“瓷白典藏”正式主题与标题栏快速切换 | 满足明亮环境和偏好浅色界面的用户，同时通过共享信息架构与主题令牌控制维护成本 |
| 2026-08-30 | 主题选择立即本地持久化 | 切换属于低风险高频偏好，不要求用户再进入设置页点击保存 |
| 2026-08-30 | 长截图使用独立深色状态浮层，并在每帧像素采集前临时隐藏 | 跨第三方页面保持可读的扫描反馈，同时确保浮层本身不会进入用户选中的截图内容；动效遵循状态色和 reduced-motion 规则 |
| 2026-08-30 | 长截图固定顶栏与底栏仅保留一次 | 拼接目标是选区内真正滚动的内容，固定浏览器栏或网页悬浮栏不应随每帧重复 |
| 2026-08-31 | 所有已入库或正在编辑的图片统一使用 Windows 原生右键菜单 | 在夜幕与瓷白主题中保持系统级熟悉感，并让工作台、素材库、结果页、编辑画布与钉图共享“复制图片/下载图片”语义 |
