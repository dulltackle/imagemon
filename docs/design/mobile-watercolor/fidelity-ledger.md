# 移动端水彩视觉保真验收台账

## 结论

生产实现已遵守获批的“水彩品牌层 / 中性工具层 / 中性媒体层”方向，以及概念稿 README 中的七项生产纠正规则。图鉴首页正常、完全空、加载、失败和提炼进行中状态均已完成真实渲染对照；Web 四档视口通过，Android 主要页面已分批完成截图验证。

本台账不把尚未执行的外部验收写成完成：当前 Linux 环境无法运行 iOS Simulator；Android 全量截图单命令仍被一条既有的跨视口文本断言阻断；七条真实端到端业务链路、iOS Dynamic Type 与 VoiceOver 仍需后续设备验收。

生产代码验收基线为 `c4bdf3b`，文档与截图由本台账提交补充。

## 批准依据

- [概念稿评审包](concepts/README.md)
- [移动端水彩视觉合同](design-contract.md)
- [图鉴正常状态概念稿](concepts/catalog-loaded-mobile.png)
- [图鉴完全空状态概念稿](concepts/catalog-empty-mobile.png)
- [条目工具页概念稿](concepts/entry-workbench-mobile.png)
- [平板概念稿](concepts/catalog-tablet.png)
- 加载、错误、提炼进行中、方案进行中和待审阅五张完整状态稿

2026-07-14 已再次使用 `view_image` 同时检查批准概念稿和最终 Web/Android 渲染。概念稿冻结视觉关系，不冻结生成模型伪造的系统像素、示例图片或记录数据。

## 实现截图

| 证据 | 路径 | 用途 |
| --- | --- | --- |
| Web 390×844 | [catalog-web-390x844.png](implementation/catalog-web-390x844.png) | 手机首屏、焦点与卡片密度 |
| Web 412×915 | [catalog-web-412x915.png](implementation/catalog-web-412x915.png) | 较宽手机布局 |
| Web 768×1024 | [catalog-web-768x1024.png](implementation/catalog-web-768x1024.png) | 平板最大宽度与横向卡片 |
| Web 1280×800 | [catalog-web-1280x800.png](implementation/catalog-web-1280x800.png) | 桌面宽屏居中 |
| Web 完全空 390×844 | [catalog-empty-web-390x844.png](implementation/catalog-empty-web-390x844.png) | 手机空状态插画强度 |
| Web 完全空 768×1024 | [catalog-empty-web-768x1024.png](implementation/catalog-empty-web-768x1024.png) | 平板空状态尺寸 |
| Web 加载 | [catalog-loading-web-390x844.png](implementation/catalog-loading-web-390x844.png) | 紧凑中性反馈 |
| Web 失败 | [catalog-error-web-390x844.png](implementation/catalog-error-web-390x844.png) | 独立危险语义 |
| Web 提炼进行中 | [catalog-refining-web-390x844.png](implementation/catalog-refining-web-390x844.png) | 进行中状态无水彩干扰 |
| Web 键盘焦点 | [keyboard-focus-web-390x844.png](implementation/keyboard-focus-web-390x844.png) | 浏览器原生可见 focus ring |
| Web 标准色卡 | [image-viewer-color-card-web-390x844.png](implementation/image-viewer-color-card-web-390x844.png) | 全屏媒体中立性 |
| Android 图鉴 | [catalog-android-1080x2400.png](implementation/catalog-android-1080x2400.png) | Android 13 最终首页视觉 |
| Android 内置条目首屏 | [promptdex-built-in-detail-android-top.png](implementation/promptdex-built-in-detail-android-top.png) | 条目名、任务输入与提交栏 |
| Android 内置条目下屏 | [promptdex-built-in-detail-android-lower.png](implementation/promptdex-built-in-detail-android-lower.png) | 图片规格与生成结果区 |

## 首屏文案与信息顺序 diff

生产实现没有新增、删除、重命名或重排现有首屏业务文案：

1. 页面标题仍为“图鉴”；
2. “模板提炼”入口及真实说明保持原顺序；
3. “已生成图鉴条目”位于“未生成图鉴条目”之前；
4. 条目名称、来源/任务标签、状态、说明、时间与进入图标保持现有数据顺序；
5. Tab 仍为“图鉴 / 历史 / 设置”；
6. 没有增加营销文案、统计卡、搜索、侧栏、重试、取消、百分比或预计时间。

概念图中的示例图片、日期和条目数量与截图 fixture 不同，属于已批准的构图数据差异，不是生产文案或信息架构差异。

## 具体保真比较

### 首屏焦点与水彩位置

- 模板提炼入口仍是唯一强水彩焦点；列表项、Tab、header、输入和状态反馈不加载纹理。
- 冷色主 wash 锚定入口左上与图标后方，面积和权重最大。
- 暖色 wash 锚定右上，受控 wrapper 的最终 opacity 为 `0.5`，没有形成第二焦点。
- 两个装饰 wrapper 的 Web computed `pointer-events` 均为 `none`，且位于 `aria-hidden="true"` 容器。
- 完全空状态只使用冷色入口 wash 与独立空状态插画，不显示暖色 wash。

### 颜色、字体与对比度

- 页面底色为 `#faf8f5`；卡片为 `#fffdfb`；媒体画布为 `#f1f2f3`。
- 所有生产文字使用平台系统 sans；没有复制概念图伪系统字形，也没有引入中文手写字体或全局斜体。
- 计算对比度：主文字/卡片 `12.08:1`，次文字/卡片 `5.33:1`，白色主按钮文字/`#4a6fa5` 为 `5.11:1`。
- disabled 按钮使用不透明 `app-ink` 与 `app-action-soft` 合成底，约 `10.41:1`；未照搬概念图的浅色禁用像素。
- `app-ink-subtle` 在卡片上约 `4.12:1`，继续只允许用于大字号或非关键信息；原 15px 空输入说明已改用 `app-ink-muted`。

### 卡片密度、圆角、边框与阴影

- 品牌入口为 22px 圆角；标准卡片为 18px；工具/反馈为 16px；字段、按钮和媒体框分别为 14px、14px、12px。
- 卡片使用 1px `app-stroke`，默认没有明显阴影。
- 手机 gutter 为 20px，主要区块间距保持 18–24px；平板已生成条目采用横向媒体卡，长列表不重复水彩纹理。
- 已生成条目恢复整卡点击命中，图片详情按钮是独立同级按钮；Web DOM 中嵌套 `button` 数为 `0`。点击卡片左上 5×5px padding 可进入 `/promptdex/light-infographic`，图片按钮仍进入图片详情。

### 中性媒体与像素保真

- 输入图、结果图、缩略图、缺失占位和全屏查看器均通过 `MediaFrame` 或其受控 viewport 呈现，背景固定为 `#f1f2f3`。
- 图鉴代表图使用精确 `aspect-video`（16:9），没有沿用概念图的近似比例。
- 标准色卡通过 Playwright 只在运行时替换截图资源，不修改 fixture 或生产数据；全屏截图内部采样保持红 `255,0,0`、绿 `0,255,0`、蓝 `0,0,255`、灰 `128,128,128`，matte 为 `241,242,243`。
- 色卡图片 computed opacity 为 `1`、filter 为 `none`、mix-blend-mode 为 `normal`；未发现主题叠色。
- 全屏查看器的双击缩放与“重置图片缩放”入口仍正常。

### 响应式

| 视口 | 文档 clientWidth | scrollWidth | 品牌入口宽度 | 结论 |
| ---: | ---: | ---: | ---: | --- |
| 390×844 | 390 | 390 | 350 | 20px 双侧 gutter，无横向溢出 |
| 412×915 | 412 | 412 | 372 | 20px 双侧 gutter，无横向溢出 |
| 768×1024 | 768 | 768 | 680 | 内容受 720px 容器与 20px 内边距约束 |
| 1280×800 | 1280 | 1280 | 680 | 宽屏居中，不无限拉伸 |

## 状态资产矩阵

| 状态 | 冷色 wash | 暖色 wash | 空状态插画 | 结论 |
| --- | --- | --- | --- | --- |
| 正常新建/编辑输入 | 有 | 有，50% | 无 | 唯一品牌焦点 |
| 完全空 | 有 | 无 | 有 | 手机 160px、平板 180px |
| 首次加载 | 无 | 无 | 无 | 紧凑中性反馈 |
| 首次失败 | 无 | 无 | 无 | 危险色与文字独立表达 |
| 提炼待处理/进行中 | 无 | 无 | 无 | 状态不依赖水彩或颜色单独表达 |
| 方案待审阅/成功注意项 | 无 | 无 | 无 | 保持工具层实色 |

Web 受控状态只调用现有运行时状态分发，不改生产源码、测试、Mock 或 fixture。资源列表使用解码后的实际 URL 核对，避免把 URL 编码字符串误计为未加载。

## 七项生产纠正规则

| 规则 | 生产处理 | 结果 |
| --- | --- | --- |
| 空状态插画降低存在感 | 手机宽度 160px、平板 180px，且不显示暖色 wash | 通过 |
| 图片详情命中区至少 44×44pt | 图片详情、关闭、重置等真实按钮均使用至少 `h-11/w-11` | 通过 |
| 图鉴媒体精确 16:9 | `MediaFrame.card` 固定 `aspect-video` | 通过 |
| 加载反馈紧凑自适应 | `Surface.feedback` 按内容高度，不冻结概念稿高度 | 通过 |
| disabled 对比度单独验证 | disabled 使用 `app-ink`，约 `10.41:1` | 通过 |
| 示例数据不进入生产 fixture | 没有新增或修改截图 fixture；既有缺图 fixture 保留 | 通过 |
| 系统字形与原生导航优先 | 保留 NativeTabs/Stack 与系统 sans，不复制伪原生像素 | 通过 |

## 无障碍、交互与动效

- `WatercolorBackdrop` 不接受任意 `source`、`style`、`className`、filter 或动态渐变；装饰不进入无障碍树且不拦截触摸。
- `Surface.feedback` 对危险状态使用 assertive live region，其余反馈使用 polite live region。
- `ScreenCanvas` 与 `ScreenScrollView` 均按 `max(32, bottom inset + 20)` 保留底部安全区。
- Web 使用键盘 Tab 后，首个 Tab 控件显示浏览器原生 focus ring；computed outline 为 `auto 1px rgb(68,68,68)`，截图可见。
- 水彩装饰没有动画；生产过渡仅为 150ms 工具控件颜色反馈。全屏图片 spring 只响应用户缩放手势，不是非必要装饰动画。
- 模板提炼入口真实跳转到 `/promptdex/refine`，页面包含两个输入框和“生成提炼方案”按钮。

## 资产预算与来源

三项透明 WebP 合计 224,868 bytes，单张均低于 250KB，总量低于 750KB：

- `catalog-wash-cool.webp`：146,806 bytes；
- `catalog-wash-warm.webp`：18,312 bytes；
- `empty-state-watercolor.webp`：59,750 bytes。

三项均已在纯白与 `#faf8f5` 上检查透明边缘，无黑边、白边或绿边。冷色和空状态由项目自包含 Imagemon CLI 生成；暖色前两次请求超时后，第三次按开发者指示改用内置 `imagegen` Skill，并通过 soft matte、despill 与 1px edge contract 移除绿幕。完整记录见[生产资产 README](production-assets/README.md)。

## 平台与自动化结果

### Web

- 浏览器插件不可用，因此按前端验收技能回退到 Playwright CLI 真实浏览器。
- 四档视口均无横向溢出；页面标题、导航、品牌入口、列表和图片详情交互有效。
- 应用级 console error 为 0。
- 已知 warning 为 React Native Web 的历史 `pointerEvents` 弃用提示和截图模式故意缺失图片的资源提示；重启测试服务器时另有断连通知，不计为应用错误。

### Android

- 定向首页运行：`apps/mobile/.expo/screenshots/android/2026-07-14T17-23-46-484Z/manifest.json`，Android 13、1080×2400、420dpi，`validationErrors=[]`。
- 全量命令前半段：`2026-07-14T17-29-16-341Z`；图鉴、模板提炼和四页 32 个图标已完成，32/32 图标通过。随后内置条目断言要求“light-infographic / 生成图片 / 图片规格”同时出现在一个 UI 层级视口，180 秒后停止。
- 手工上下屏证明确认页面实际正常：首屏包含条目名、任务输入和“生成图片”，滚动后包含“图片规格”和“生成图片”。这解释失败，但不等价于自动全量通过。
- 后续 11 条路由运行：`2026-07-14T17-34-36-922Z`，`validationErrors=[]`，覆盖个人条目、历史、图片详情、设置、默认规格、模型配置和首次设置。
- 合计 17 个自动截图页面分批通过，内置条目由手工上下屏补证；不能表述为“Android 全量单命令通过”。
- 现有 manifest 未记录系统暗色设置，本台账不声称 Android 系统暗色冷启动已经验收。

### iOS 与 Expo 静态配置

- `expo config --type public`：`userInterfaceStyle=light`、`backgroundColor=#faf8f5`。
- `expo config --type introspect`：iOS `UIUserInterfaceStyle=Light`；Android `AppTheme` 继承 `Theme.AppCompat.Light.NoActionBar`；`activityBackground=#faf8f5`。
- 当前主机为 Linux且没有 `xcrun`/Simulator，因此 iOS 浅色、系统暗色冷启动、Dynamic Type、VoiceOver 顺序和透明边缘的运行时验收仍待 macOS/iOS 设备执行。

## 验证命令

最终生产代码阶段已通过：

```text
npm run mobile:prepare
npm run mobile:verify
  44 个测试文件，336 个测试
npm run verify
  57 个测试文件，475 个测试
  Imagemon Skill、Promptdex 9 个模板、三项 Skill 结构校验通过
git diff --check
rg -n -e 'sf-[a-z0-9-]+' -e '--sf-' -e 'platformColor\(' apps/mobile
  无匹配
```

本台账和计划状态提交完成后还会再运行一次仓库级最终验证，以最终 HEAD 结果为准。

## 尚未关闭的外部验收

以下项目保持显式未完成，不作为生产实现失败绕过：

1. Android 全量截图单命令的跨视口文本断言；按照仓库规则没有修改断言、测试或 fixture。
2. iOS 浅色与系统暗色冷启动、Dynamic Type、VoiceOver 和真实设备透明边缘。
3. Android 系统暗色冷启动与放大字体的完整矩阵。
4. 计划 10.7 的七条真实端到端业务链路；当前证据为单元/集成测试、页面路由截图和关键页面交互，不冒充真实模型调用、相册和首次设置全流程。
