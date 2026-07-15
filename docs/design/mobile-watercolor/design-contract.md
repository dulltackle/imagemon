# 移动端水彩视觉合同

## 批准状态

本合同已于 **2026-07-14** 获开发者确认，适用于 `apps/mobile` 在 iOS、Android 和 Web 上的生产视觉实现。批准范围包括九张[完整概念稿与状态稿](concepts/README.md)、本合同冻结的视觉数值、品牌/工具/媒体三层边界、七项生成图纠正规则，以及首批生产资产契约。

概念图冻结的是视觉关系和信息层级，不是需要逐像素复制的 UI、业务 fixture 或生产资产。可见文案、信息顺序、路由、业务状态和交互行为仍以当前生产代码为准。

## 决策边界

ADR 0210 单独决定手机端固定使用浅色；ADR 0211 与本合同只决定固定浅色下采用何种视觉系统，二者不得合并。

水彩视觉属于 Imagemon 应用品牌，不属于 Promptdex Markdown、图鉴条目、提示词模板或图片任务内容。页面区分三类表面：

| 表面 | 范围 | 视觉规则 |
| --- | --- | --- |
| 品牌表面 | 图鉴首页、首次设置顶部、图鉴条目详情顶部、空状态与轻量引导 | 可使用纸张底色和经审查的水彩资产；每屏最多一个强焦点 |
| 工具表面 | 输入、选择、提交、提示词审阅、历史审计、模型配置、加载、错误、成功、警告与进行中 | 使用近白实色、清楚边框和独立状态色，不使用水彩纹理 |
| 媒体表面 | 输入图、结果图、缩略图、图片详情和图片缺失占位 | 固定使用中性 media matte，不继承品牌色或工具状态色 |

图鉴首页的模板提炼入口是首屏唯一强水彩焦点。图鉴条目详情只有顶部介绍区属于品牌表面，后续模型、输入、规格、审阅和提交均属于工具表面。长列表项不得重复加载水彩纹理。

原生 `NativeTabs` 与 `Stack` 继续承担导航，只接入语义颜色；不得自绘导航或把水彩资产放入 Tab bar、header 和返回按钮。

## 已批准概念稿

| 文件 | 画布 | 契约重点 |
| --- | --- | --- |
| `concepts/catalog-loaded-mobile.png` | 390×844 | 首页焦点、已生成与未生成条目、媒体中立性 |
| `concepts/catalog-empty-mobile.png` | 390×844 | 品牌空状态，不新增业务操作 |
| `concepts/entry-workbench-mobile.png` | 390×844 | 顶部品牌区与下方工具区分界 |
| `concepts/catalog-tablet.png` | 768×1024 | 720px 最大宽度和宽屏留白 |
| `concepts/catalog-loading-mobile.png` | 390×844 | 中性加载反馈 |
| `concepts/catalog-error-mobile.png` | 390×844 | 独立危险语义 |
| `concepts/catalog-refining-mobile.png` | 390×844 | 首页提炼进行中入口 |
| `concepts/template-refinement-running-mobile.png` | 390×844 | 中性工具页进行中反馈 |
| `concepts/template-refinement-review-mobile.png` | 390×844 | 中性方案审阅工具层 |

## 颜色 token

以下值已由概念稿确认从起始值冻结为生产值；实现不得自行微调：

| CSS variable | 值 | 用途 |
| --- | --- | --- |
| `--app-canvas` | `#faf8f5` | 页面纸张底色 |
| `--app-surface` | `#fffdfb` | 标准卡片和正文容器 |
| `--app-surface-raised` | `#ffffff` | 表单、弹层和高优先级工具 |
| `--app-ink` | `#3a3430` | 主文字 |
| `--app-ink-muted` | `#6f6964` | 正常字号次文字，目标对比度不低于 4.5:1 |
| `--app-ink-subtle` | `#817b76` | 仅大字号或非关键信息，使用时单独验对比度 |
| `--app-action` | `#4a6fa5` | 主按钮、链接、选中态和导航强调色 |
| `--app-action-pressed` | `#3a5f95` | 主操作按下态 |
| `--app-on-action` | `#ffffff` | 仅用于不透明主操作背景 |
| `--app-action-soft` | `rgba(74,111,165,0.12)` | 图标容器与弱选中态 |
| `--app-stroke` | `rgba(74,111,165,0.18)` | 细边框与分隔线 |
| `--app-wash-peach` | `rgba(232,168,124,0.16)` | 纯装饰蜜桃 wash |
| `--app-wash-teal` | `rgba(133,205,202,0.16)` | 纯装饰青绿 wash |
| `--app-wash-rose` | `rgba(195,141,148,0.14)` | 纯装饰玫瑰 wash |
| `--app-wash-sand` | `rgba(212,163,115,0.14)` | 纯装饰沙色 wash |
| `--app-media-matte` | `#f1f2f3` | 图片与图片缺失占位背景 |
| `--app-field` | `#ffffff` | 可输入区域 |
| `--app-success` | `#287a48` | 成功文字与图标 |
| `--app-success-soft` | `rgba(40,122,72,0.12)` | 成功弱背景 |
| `--app-warning` | `#875c00` | 警告文字与图标 |
| `--app-warning-soft` | `rgba(135,92,0,0.12)` | 警告弱背景 |
| `--app-danger` | `#b3261e` | 危险文字与图标 |
| `--app-danger-soft` | `rgba(179,38,30,0.10)` | 危险弱背景 |

所有 token 都必须映射为对应的 `--color-app-*` Tailwind 颜色，包括 pressed、on-action、ink-subtle 和 wash。新代码只使用 `app-*` 语义名；`sf-*` 只作为迁移期兼容层且不得新增。

禁止 `bg-app-action/80`、`text-app-ink/60` 等透明度修饰符。半透明用途必须使用已冻结的最终色 token；主按钮必须使用不透明 `--app-action`；状态色不得水彩化；`--app-media-matte` 不得指向 wash、纸纹或有色 overlay。

## 字体、几何与布局

- 包括品牌标题在内的所有生产文字使用平台系统 sans；首批不引入自定义字体、中文手写字体、全局 serif 或 italic。
- 迁移范围内的过量 `font-extrabold` 收敛为 `font-semibold` 或 `font-bold`，不做无关的全仓机械替换。
- 手机横向 gutter 固定为 20px；平板与 Web 内容最大宽度固定为 720px并水平居中。
- 紧凑列表 gap 为 10–12px；主要区块 gap 为 18–24px。
- 品牌面板圆角 22px；标准卡片 18px；工具/字段组卡片 16px；输入框和按钮 14px；媒体框 12px；共享 `Badge` 使用 pill。
- 边框为 1px `--app-stroke`。默认卡片无明显阴影；品牌主视觉至多使用一处低透明、大扩散的极弱阴影。
- 所有真实触控命中区至少为 44×44pt，不为手绘感改变命中边界。
- 图鉴代表图使用精确 16:9；其他 `MediaFrame` 比例由业务图片角色决定，但不得由水彩装饰改变。

## 共享组件合同

产品视觉组件位于 `apps/mobile/src/ui/`；`src/tw` 继续只负责 React Native 元素与 CSS 的桥接。

- `ScreenCanvas` / `ScreenScrollView`：统一 `brand | tool` 背景、20px gutter、底部安全区、720px 最大宽度与居中，不改变现有滚动行为。
- `Surface`：只提供 `panel | interactive | brand | feedback | fieldGroup`。业务页面不得自行发明新的边框、圆角和阴影组合。
- `AppButton`：提供 `primary | secondary | danger | ghost` 以及 normal、pressed、disabled、loading 状态；最小 44pt；文字不使用透明度；disabled 可读；loading 不改变按钮宽度。
- `Badge`：提供 `neutral | brand | success | warning | danger`；状态徽章只用实色文字和预定义弱背景，不使用 wash。
- `SectionTitle`：统一字号、字重和间距；允许一处不穿过文字的小型装饰，但不自动增加文案。
- `MediaFrame`：图片和图片缺失占位的唯一共享边界，提供 `thumbnail | card | detail`；固定中性 matte；禁止 wash、纹理、透明叠层和滤镜。
- `WatercolorBackdrop`：只渲染审查过的生产资产，绝对定位、`pointerEvents="none"`、不进入无障碍树；只开放有限位置、尺寸与 opacity variant，不接受任意滤镜或动态渐变。

`Surface.feedback` 的基底始终为实色。只有空状态可以在预留的固定尺寸容器中使用 `WatercolorBackdrop` 的 `emptyState` 受控呈现；加载、错误、成功、警告和进行中反馈不得包含水彩资产。

## 生产资产合同

首版只允许在 `apps/mobile/assets/watercolor/` 新增三项无文字透明 WebP：

| 文件 | 角色 | 定位与裁切 |
| --- | --- | --- |
| `catalog-wash-cool.webp` | 首页模板提炼入口的冷色主 wash | `contain`，锚定品牌入口左上与图标后方，可超出卡片外缘但不穿过文字 |
| `catalog-wash-warm.webp` | 同一品牌焦点的暖色平衡 | `contain`，锚定品牌入口右上或右缘，面积和 opacity 小于冷色 wash，不形成第二焦点 |
| `empty-state-watercolor.webp` | 图鉴空状态插画 | `contain`，在预留容器中居中；手机可见宽度不超过 160px，平板不超过 180px，不裁 UI、不伪装交互 |

资产必须独立生成，不能从概念截图裁切 UI；所有文本、按钮、图标与状态标签保持代码原生。单张不超过 250KB，总新增不超过 750KB，长边原则上不超过 1536px；每屏最多加载 1–2 张装饰位图。

资产使用 `expo-image`，`pointerEvents="none"` 且不进入无障碍树；不得在每个列表项重复加载，不得叠在图片、输入框或反馈文案上。必须在纯白与 `--app-canvas` 上检查透明边缘；加载失败不得改变布局或页面可用性。

## 导航、响应式与动效

- Tab tint、Stack 背景、header 文字和返回按钮接入 `app-*` token；保留原生 blur、返回手势和可访问性。
- 原生启动背景与 `--app-canvas` 一致，避免冷启动闪白。
- Web 只把 hover 作为增强，键盘 focus 必须可见；宽屏内容不无限拉伸，不产生横向滚动。
- pressed 反馈为 120–180ms；面板显隐为 180–240ms；装饰 wash 的可选显隐或轻缩放为 350–500ms。
- 非必要装饰动效必须尊重 reduced motion；禁止实时 blur、逐卡无限动画、依赖 hover 的主要交互和把 500ms 缓动应用到工具控件。

## 已批准的生产纠正规则

1. 空状态插画缩小并降低存在感，模板提炼入口仍是唯一强焦点。
2. 概念图中约 38px 的图片详情按钮在生产中使用至少 44×44pt 的真实命中区。
3. 平板图鉴代表图在生产中使用精确 16:9。
4. 加载反馈使用内容自适应的紧凑面板，不冻结概念图中的偏高高度。
5. disabled 主按钮单独验证文字对比度，不照搬生成图的浅色像素。
6. 概念图内示例图片、日期和记录只用于构图，不成为生产资产或新增 fixture。
7. 字形、字距与原生导航以平台真实系统组件为准，不复制生成图的伪原生像素。

## 非目标与变更控制

本轮不改变路由、信息架构、可见文案顺序、业务状态、任务执行逻辑或持久化；不新增营销文案、统计卡、搜索、侧栏、虚构徽章、重试/取消/百分比/预计时间或新工作流。

本轮不引入 shadcn、新 UI 框架、实时模糊、SVG filter、Canvas shader 或自绘原生导航。StyleKit 只作为设计参考，不是运行时依赖；不直接采用其 light/dark 变量、Web 伪元素、`clip-path`、`backdrop-filter`、复杂 radial gradient、hover 主交互、全局 serif italic、全局 500ms、半透明主按钮或逐卡纹理。若未来复制其实质代码或资产，必须保留 MIT 归属。

若未来改变冻结配色、恢复暗色、引入动态主题或允许设备使用者切换主题，必须另立 ADR，并补齐独立概念合同和 iOS、Android、Web 验收。任何实现不得通过修改测试、断言、Mock、Fixture 或截图阈值绕过失败。
