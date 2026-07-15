# 移动端水彩视觉系统完整实施方案（2026-07-13）

## 一、计划摘要

- **目标**：以 [StyleKit 水彩画风](https://www.stylekit.top/zh/styles/watercolor-style) 为视觉参考，为 Imagemon 建立一套跨 iOS、Android、Web 的固定浅色视觉系统。
- **状态**：生产实现与当前 Linux 环境可执行的验收已完成；剩余 iOS/Android 外部设备验收、Android 全量截图单命令的既有跨视口断言，以及七条真实端到端业务链路。
- **实施策略**：采用“**水彩品牌层 + 中性工具层**”的适配式引入，不把 StyleKit 当作运行时依赖，不执行 shadcn registry 安装，不照搬 Web 专用 CSS。
- **首个试点**：图鉴首页 `apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx`。
- **固定边界**：水彩只承担品牌氛围、内容发现和轻量引导；图片预览、任务表单、提示词审阅、历史审计、模型配置和状态反馈保持中性、清晰、可验证。
- **前置门槛**：先生成并确认完整概念稿与状态稿，再开始生产代码；获批概念稿是后续实现的视觉契约。
- **基线**：当前使用既有 `watercolor-style` 分支；固定浅色基线已由提交 `df2b16f` 独立完成，概念稿候选已由提交 `d16613a` 独立完成。
- **已批准合同**：[移动端水彩视觉合同](../design/mobile-watercolor/design-contract.md) 与 [ADR 0211](../adr/0211-mobile-adopts-adapted-watercolor-visual-system.md)。
- **验收台账**：[移动端水彩视觉保真验收台账](../design/mobile-watercolor/fidelity-ledger.md)。

原计划估算成本为 **6–9 个开发日**，不含概念稿多轮方向重做；实际实现已按子任务拆为可独立回滚的提交。

---

## 二、决策与约束

### 2.1 已确认决策

1. 手机端仅使用浅色模式，不跟随系统外观，不提供主题开关。
2. 水彩风格属于应用视觉系统，不属于 Promptdex 图鉴条目或生图模板。
3. StyleKit 只作为设计约束和配色参考，Imagemon 维护自己的语义 token、组件和生产资产。
4. 原生 `NativeTabs` 与 `Stack` 保留，不为视觉效果自绘导航。
5. 生成图片及输入图片周围必须使用无色中性画布，不得叠加纸纹、渐变、滤镜或水彩色。
6. 首批不引入中文手写字体、实时模糊、SVG filter、Canvas 着色器或新的 UI 框架。
7. 不改变路由、信息架构、业务状态、任务执行逻辑和持久化结构。
8. 不通过修改既有测试、断言、Mock、Fixture 或截图阈值规避视觉或功能失败。

### 2.2 需要新增的架构决策

实施前新增：

`docs/adr/0211-mobile-adopts-adapted-watercolor-visual-system.md`

内容至少明确：

- 手机端采用固定浅色的适配式水彩视觉系统；
- 水彩品牌层与中性工具层的边界；
- 图片预览必须使用独立的中性 media matte；
- StyleKit 不是运行时依赖；
- 原生导航继续使用平台组件；
- 自定义字体、暗色模式和动态主题均不在本决策范围；
- 若未来改变配色、恢复暗色或让使用者切换主题，必须另立 ADR。

ADR 0210 继续负责“固定浅色”决策，ADR 0211 只负责“浅色模式下采用何种视觉系统”，两者不得合并。

### 2.3 StyleKit 的采用与舍弃

上游参考：

- [水彩风格定义](https://github.com/AnxForever/stylekit/blob/main/lib/styles/watercolor-style.ts)
- [精确 token 映射](https://github.com/AnxForever/stylekit/blob/main/lib/styles/watercolor-style-tokens.ts)
- [组件 recipes](https://github.com/AnxForever/stylekit/blob/main/lib/recipes/watercolor-style.ts)
- [MIT License](https://github.com/AnxForever/stylekit/blob/main/LICENSE)

采用：

- 温暖纸张底色；
- 蓝灰主色；
- 蜜桃、青绿、玫瑰、沙色的低透明度 wash；
- 大面积留白；
- 柔和边缘与克制阴影；
- 少量缓慢的色彩显隐；
- 装饰层与内容层分离。

不直接采用：

- `npx shadcn add ...`；
- StyleKit 同时注入的 light/dark CSS variables；
- `::before`、`clip-path`、`backdrop-filter`、复杂 radial gradient 等 Web 配方；
- 依赖 hover 的主要交互；
- 所有文字都使用衬线斜体；
- 所有控件统一 `duration-500`；
- `#4a6fa5/80` 配白字的按钮；
- 每张卡片都带渐变、纹理和大圆角；
- 上游 showcase 或 cover 图片作为生产资产。

若复制上游实质性代码或资产，必须保留 MIT 版权声明；本方案默认只吸收设计思想并生成 Imagemon 自有资产。

---

## 三、现状盘点

### 3.1 技术基线

- Expo SDK 54、React 19、React Native；
- Expo Router + 原生 `NativeTabs`；
- NativeWind 5 preview + `react-native-css`；
- `apps/mobile/src/tw/index.tsx` 负责把 `className` 映射到 React Native 组件；
- `expo-image` 已存在，可承载本地水彩位图；
- 目前没有 shadcn、`components.json`、ThemeProvider 或独立 Web 视觉层。

### 3.2 当前主题入口

`apps/mobile/src/global.css` 是唯一跨端主题入口：

- 根级只有 12 个 `sf-*` 颜色 token；
- Web 与 Android 使用硬编码浅色；
- iOS 通过 `@media ios` 用 `platformColor()` 覆盖颜色；
- 字体同样通过平台 media 设置 generic family；
- 当前已声明 `color-scheme: light`，并删除暗色媒体查询。

### 3.3 当前样式债务

- `sf-*` 颜色引用约 450 次；
- `rounded-lg` 约 109 次，承担卡片、按钮、输入框、图片和徽章等不同角色；
- 没有共享的 `Screen`、`Card`、`Button`、`Badge`、`MediaFrame`；
- `sf-fill` 同时承担：
  - 图标容器；
  - 徽章背景；
  - 次要按钮背景；
  - 输入图片和生成图片的预览底色；
- 原生 Tab 强调色在 `apps/mobile/app/(tabs)/_layout.tsx` 中硬编码为 `#0F766E`；
- Stack header 仍使用默认系统表面；
- ~~`PromptdexEntryDetailScreen.tsx` 仍有 `bg-blue-50` 主题逃逸点~~（2026-07-14 勘误：已随 UX 第一批修复，代码中已无 `bg-blue-50`）；
- 现有 CSS 已记录 iOS 原生颜色不能安全参与 Tailwind 透明度修饰符，但仍有少量 `sf-*/xx` 使用；
- 仓库当前没有自有 PNG、WebP、SVG 或品牌字体资产；
- 页面没有统一的 Web/平板最大宽度。

### 3.4 直接全局换色不可行的原因

1. 只改根 token 时，iOS `platformColor()` 会继续覆盖品牌色。
2. 把 `sf-fill` 改成有色 wash 会污染图片预览。
3. 内容区改色后，原生 Tab 与 Stack 仍可能保留系统色。
4. 全局放大 `rounded-lg` 会让图片、徽章、输入框和卡片失去层级。
5. StyleKit 的半透明按钮和 muted text 不能自动满足正文对比度。
6. 大文件正处于 UX 结构调整计划中，视觉重构与信息架构重构混做会放大冲突和返工。

### 3.5 与 UX 审计第三批的关系

[UX 审计](2026-07-13-mobile-ux-audit.md)第三批中的视觉类条目由本方案吸收，不再单独执行（2026-07-14 已在审计文档中同步标注）：

| 审计条目 | 本方案落点 |
| --- | --- |
| 2.4 双强调色（Tab teal vs `--sf-blue`） | 统一为 `--app-action`，阶段 1 接入原生导航（8.3 节） |
| 2.5 组件收敛（Badge/FeedbackBox/SectionTitle、徽章圆角、阴影、字重） | 第六节 `src/ui` 组件与 variant，阶段 1/4 落地；字重按 4.4 节只在所迁移组件中收敛 |
| ~~1.6 `bg-blue-50` 主题逃逸点~~ | 2026-07-14 勘误：已随 UX 第一批修复，无需本方案处理；迁移第 9 步仅作兜底检查 |

审计第三批其余的术语、文案与行为类条目（1.9、3.3/3.4/4.3/8.1/8.3、2.6、7.2/7.4、6.2、8.2，完整清单见 [2026-07-14-mobile-ux-remaining.md](2026-07-14-mobile-ux-remaining.md)）与本方案正交，可在本方案任意阶段并行执行；其中 3.4 的差异化占位需落在 `MediaFrame` / media matte 契约之内。

---

## 四、目标视觉契约

### 4.1 主题模型

整个应用只有一个固定浅色主题，但区分三类表面：

1. **品牌表面**
   - 图鉴首页；
   - 首次设置顶部；
   - 图鉴条目详情顶部；
   - 空状态和轻量引导。

2. **工具表面**
   - 输入框、选择器、提交区；
   - 提示词审阅；
   - 历史详情；
   - 模型配置；
   - 错误、成功、警告、进行中状态。

3. **媒体表面**
   - 输入图片；
   - 生成图片；
   - 缩略图；
   - 图片详情；
   - 图片缺失占位。

品牌表面可以使用纸张底色与水彩 wash；工具表面使用近白实色；媒体表面固定使用中性灰，不继承水彩色。

### 4.2 颜色 token

以下为首轮概念稿的起始值。概念稿确认后冻结最终值；生产实现不得自行“微调得更好看”。

| 语义角色 | CSS variable | 起始值 | 使用规则 |
| --- | --- | --- | --- |
| 页面纸张 | `--app-canvas` | `#faf8f5` | 品牌页面底色 |
| 主实色表面 | `--app-surface` | `#fffdfb` | 卡片和正文容器 |
| 抬升表面 | `--app-surface-raised` | `#ffffff` | 表单、弹层和高优先级工具 |
| 主文字 | `--app-ink` | `#3a3430` | 正文和标题 |
| 次文字 | `--app-ink-muted` | `#6f6964` | 正常字号正文，目标对比度 ≥ 4.5:1 |
| 弱文字 | `--app-ink-subtle` | `#817b76` | 仅大字号或非关键信息，需单独验对比度 |
| 主操作 | `--app-action` | `#4a6fa5` | 主按钮、链接、选中态、Tab |
| 按下操作 | `--app-action-pressed` | `#3a5f95` | pressed/active |
| 主操作前景 | `--app-on-action` | `#ffffff` | 仅用于不透明主操作背景 |
| 弱操作底色 | `--app-action-soft` | `rgba(74,111,165,0.12)` | 图标容器、次选中态 |
| 细边框 | `--app-stroke` | `rgba(74,111,165,0.18)` | 面板、输入框、分隔 |
| 蜜桃 wash | `--app-wash-peach` | `rgba(232,168,124,0.16)` | 纯装饰 |
| 青绿 wash | `--app-wash-teal` | `rgba(133,205,202,0.16)` | 纯装饰 |
| 玫瑰 wash | `--app-wash-rose` | `rgba(195,141,148,0.14)` | 纯装饰 |
| 沙色 wash | `--app-wash-sand` | `rgba(212,163,115,0.14)` | 纯装饰 |
| 图片画布 | `--app-media-matte` | `#f1f2f3` | 图片及缺失占位背景 |
| 表单背景 | `--app-field` | `#ffffff` | 所有可输入区域 |
| 成功 | `--app-success` | `#287a48` | 独立语义，纸张底色对比度约 4.99:1 |
| 成功弱底色 | `--app-success-soft` | `rgba(40,122,72,0.12)` | 成功徽章或反馈框背景 |
| 警告 | `--app-warning` | `#875c00` | 独立语义，纸张底色对比度约 5.56:1 |
| 警告弱底色 | `--app-warning-soft` | `rgba(135,92,0,0.12)` | 警告徽章或反馈框背景 |
| 危险 | `--app-danger` | `#b3261e` | 独立语义，纸张底色对比度约 6.17:1 |
| 危险弱底色 | `--app-danger-soft` | `rgba(179,38,30,0.10)` | 错误徽章或反馈框背景 |

强制规则：

- 不使用 `bg-app-action/80`、`text-app-ink/60` 等透明度修饰符；
- 所有半透明用途定义成独立的最终色 token，避免 iOS `color-mix()` 问题；
- 主按钮使用不透明 `--app-action`。StyleKit 示例的 `#4a6fa5/80` 配白字在纸张底色上约为 3.53:1，不满足普通文字 4.5:1；
- `--app-media-matte` 不得指向任何 wash 或纸张纹理；
- 状态色不参与水彩化。

### 4.3 Tailwind 映射

在 `@theme` 内建立：

- `--color-app-canvas`；
- `--color-app-surface`；
- `--color-app-surface-raised`；
- `--color-app-ink`；
- `--color-app-ink-muted`；
- `--color-app-action`；
- `--color-app-action-soft`；
- `--color-app-stroke`；
- `--color-app-media-matte`；
- `--color-app-field`；
- `--color-app-success` / `success-soft`；
- `--color-app-warning` / `warning-soft`；
- `--color-app-danger` / `danger-soft`。

新代码只使用 `app-*` 类名；`sf-*` 仅作为迁移期兼容层，不允许继续增加。

### 4.4 字体

- 正文、按钮、输入框、导航、状态和数据继续使用系统 sans；
- 首批不打包中文手写字体或大型 CJK serif；
- 允许概念稿为品牌标题提出 serif 方案，但必须在 iOS、Android、Web 对照后决定；
- 若 generic `font-serif` 的中文效果跨端不一致，则品牌标题也回退系统 sans，通过字重、行高和留白建立气质；
- 禁止把所有标题改成 italic；
- 将过量 `font-extrabold` 逐步收敛到 `font-semibold` 或 `font-bold`，但只在所迁移组件中处理，不做无关全仓机械替换。

### 4.5 圆角、边框与阴影

| 角色 | 建议 |
| --- | --- |
| 大型品牌面板 | 20–24 px |
| 标准卡片 | 16–20 px |
| 表单与按钮 | 12–16 px |
| 图片框 | 12 px |
| 徽章 | pill 或 8–10 px |
| 细边框 | 1 px、低透明度蓝灰 |
| 默认卡片阴影 | 无阴影或极弱阴影 |
| 品牌主视觉阴影 | 低透明度、扩散范围大、每屏最多一处 |

禁止全局重定义 `rounded-lg`。不同语义由组件 variant 管理。

### 4.6 间距与容器

- 手机横向 gutter：20 px；
- 紧凑列表 gap：10–12 px；
- 主要区块 gap：18–24 px；
- Web/平板内容最大宽度：概念稿阶段在 680–760 px 中确认；
- 宽屏内容保持居中，不把移动卡片无限拉伸；
- 触控目标最小 44×44 pt；
- 不为“手绘不规则感”改变真实命中区域。

### 4.7 动效

- 按钮和列表 pressed：120–180 ms；
- 面板显隐：180–240 ms；
- 装饰 wash 的透明度或轻微缩放：350–500 ms；
- 不把 StyleKit 的 500 ms 缓动应用到所有工具控件；
- 不依赖 hover 才能理解交互；
- Web hover 只作增强；
- 尊重 reduced motion；
- 禁止实时 blur 扩散和逐卡无限动画。

---

## 五、水彩资产方案

### 5.1 概念稿资产

概念稿保存到：

`docs/design/mobile-watercolor/concepts/`

至少生成四张独立、完整、可读的概念图：

1. `catalog-loaded-mobile.png`：390×844，图鉴首页有生成图片和未生成条目；
2. `catalog-empty-mobile.png`：390×844，空状态；
3. `entry-workbench-mobile.png`：390×844，条目详情顶部品牌区 + 下方中性工具区；
4. `catalog-tablet.png`：768×1024，验证最大宽度与留白。

加载、错误、提炼进行中和待审阅状态如果在完整页面中不够清晰，必须分别生成新的状态概念图；禁止把已有大图裁剪放大作为实现依据。

概念稿必须保持：

- 现有导航项、页面信息顺序和业务文案；
- 图片、按钮、输入框、标签等 UI 为可实现的代码原生元素；
- 不发明统计卡、营销文案、徽章、导航或新工作流；
- 不给生成图片增加色罩；
- 图鉴首页首屏只保留一个水彩焦点；
- 工具区域具有清楚、稳定的边界。

概念稿已于 2026-07-14 获开发者确认，批准记录与最终取值见[移动端水彩视觉合同](../design/mobile-watercolor/design-contract.md)。合同记录：

- 已批准概念图路径；
- 允许出现的首屏文案；
- 颜色、字体、圆角、阴影和间距采样；
- 每个装饰资产的角色和裁切方式；
- 任何批准的偏差。

概念确认门禁已经解除；生产实现必须遵守合同中的七项生产纠正规则。

### 5.2 生产资产

生产资产保存到：

`apps/mobile/assets/watercolor/`

首版最多三项：

| 文件 | 作用 | 约束 |
| --- | --- | --- |
| `catalog-wash-cool.webp` | 图鉴首页主视觉冷色 wash | 透明背景，无文字 |
| `catalog-wash-warm.webp` | 局部暖色平衡 | 透明背景，无文字 |
| `empty-state-watercolor.webp` | 空状态插画 | 不包含 UI 文案和图标 |

资产规则：

- 使用概念稿对应的独立资产生成，不从概念截图粗暴抠图；
- 所有文本、按钮、图标和状态标签保持代码原生；
- 单张目标 ≤ 250 KB，总新增目标 ≤ 750 KB；
- 长边原则上 ≤ 1536 px；
- 每屏最多加载 1–2 张装饰位图；
- 使用 `expo-image`；
- 装饰图 `pointerEvents="none"`、不进入无障碍树；
- 不在每张列表卡中重复加载独立纹理；
- 不叠在图片预览或表单输入之上；
- 在纯白和纸张底色上检查透明边缘是否出现脏边。

---

## 六、组件架构

### 6.1 目录

新增：

`apps/mobile/src/ui/`

推荐文件：

- `ScreenCanvas.tsx`
- `Surface.tsx`
- `AppButton.tsx`
- `Badge.tsx`
- `SectionTitle.tsx`
- `MediaFrame.tsx`
- `WatercolorBackdrop.tsx`
- `index.ts`

`src/tw/index.tsx` 继续只负责 React Native 元素与 CSS 的桥接，不承载产品视觉组件。

### 6.2 组件职责

#### ScreenCanvas / ScreenScrollView

- 统一背景；
- 统一 gutter；
- 统一底部安全区；
- Web/平板最大宽度；
- `brand | tool` 两种表面模式；
- 不改变内容滚动行为。

#### Surface

variants：

- `panel`：标准实色卡片；
- `interactive`：可点击列表项；
- `brand`：允许装饰资产，但正文仍落在实色区域；
- `feedback`：加载、错误、空状态；
- `fieldGroup`：表单区块。

不允许业务组件自行拼接新的边框、圆角和阴影组合。

#### AppButton

variants：

- `primary`；
- `secondary`；
- `danger`；
- `ghost`。

states：

- normal；
- pressed；
- disabled；
- loading。

要求：

- 最小 44 pt；
- 文本不使用半透明；
- disabled 仍需可读；
- loading 不改变按钮宽度；
- Android、iOS、Web 行为一致。

#### Badge

- `neutral`；
- `brand`；
- `success`；
- `warning`；
- `danger`。

状态徽章不使用水彩 wash；品牌徽章可以使用预定义弱底色。

#### SectionTitle

- 控制标题字号、字重和间距；
- 可选一处小型水彩底线或色斑；
- 装饰不能穿过文字；
- 不自动增加说明文案。

#### MediaFrame

- 唯一允许承载输入图片、生成图片和缩略图的共享边界；
- 固定使用 `--app-media-matte`；
- 提供 `thumbnail | card | detail` variant；
- 不允许背景 wash、纹理、透明叠层或滤镜；
- 图片缺失占位也使用中性画布。

#### WatercolorBackdrop

- 只渲染生产装饰资产；
- 绝对定位；
- `pointerEvents="none"`；
- 默认不进入无障碍树；
- 提供有限位置、尺寸和 opacity variants；
- 禁止任意业务页面传入未审查的滤镜或动态渐变。

---

## 七、页面范围

### 7.1 水彩强度矩阵

| 页面/区域 | 强度 | 处理 |
| --- | --- | --- |
| 图鉴首页 | 高 | 纸张背景、一个主 wash、区块标题和空状态 |
| 模板提炼入口卡 | 高 | 作为图鉴首页唯一主视觉 |
| 已生成图鉴卡 | 中 | 卡片外围和文字区柔化，图片区中性 |
| 未生成条目 | 中低 | 淡洗色徽章与柔和表面 |
| 首次设置顶部 | 中 | 产品介绍或轻量插画；模型表单中性 |
| 图鉴条目详情顶部 | 中低 | 名称、说明、来源信息可带品牌表面 |
| 图鉴条目任务表单 | 低 | 实色工具表面，无纸纹 |
| 模板提炼正文审阅 | 低 | 实色工具表面 |
| 历史列表/详情 | 低 | 纸张可极弱，记录和状态中性 |
| 图片详情 | 无 | 完全中性媒体表面 |
| 设置/模型配置 | 无 | 专业工具表面 |
| Tab/Stack | 仅配色 | 保留原生组件，接入 token |
| 错误、警告、成功 | 无 | 独立语义色 |

### 7.2 图鉴首页试点

文件：

`apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx`

必须覆盖：

- 页面容器；
- 模板提炼入口；
- 已生成图鉴条目；
- 未生成图鉴条目；
- 其他图片；
- 加载；
- 加载失败；
- 完全空状态；
- 图片文件缺失；
- 提炼状态：
  - 新建；
  - 编辑中；
  - 进行中；
  - 待审阅；
  - 待处理。

试点规则：

- 模板提炼入口是唯一强视觉焦点；
- 已生成卡片的图片区域必须由 `MediaFrame` 承载；
- 页面装饰图不能进入长列表的每个 item；
- 现有文案、顺序、点击行为和路由全部不变；
- 现有 SymbolIcon 语义映射继续使用；
- 主强调色统一，不再同时出现系统蓝和硬编码 teal；
- 试点之外的页面在本阶段不做深度换皮。

### 7.3 后续扩展

试点通过后依次处理：

1. 首次设置顶部品牌区；
2. 图鉴条目详情顶部；
3. 全局空状态；
4. 原生导航表面；
5. 工具页面的 token 迁移；
6. `sf-*` 清理。

`PromptdexEntryDetailScreen.tsx` 和 `TemplateRefinementScreen.tsx` 必须在已有 UX 结构调整稳定后再做大范围组件迁移，避免同一段 JSX 被重复搬动。

---

## 八、迁移策略

### 8.1 原则

- 新旧 token 共存一段时间；
- 新组件只使用 `app-*`；
- 不一次性机械替换 450 处颜色引用；
- 先保护图片，再改变共享色；
- 先试点，再扩大；
- 每一阶段均可通过 revert 回滚，不增加运行时主题开关。

### 8.2 顺序

1. 新增 `app-*` token，不改变 `sf-*` 当前值。
2. 新增 `MediaFrame` 和 `--app-media-matte`。
3. 将所有图片预览、缩略图和图片缺失占位从 `sf-fill` 迁到媒体 token。
4. 新增 `src/ui` 薄组件。
5. 图鉴首页只使用新组件和新 token。
6. 试点验收通过后，临时建立旧 token 别名：
   - `sf-blue → app-action`；
   - `sf-text → app-ink`；
   - `sf-text-2 → app-ink-muted`；
   - `sf-bg-2 → app-canvas`；
   - `sf-bg-3 → app-surface`；
   - `sf-fill → app-action-soft`；
   - `sf-separator → app-stroke`。
7. 移除 iOS 颜色 `platformColor()` 覆盖，仅保留平台字体设置。
8. 逐屏把旧类名迁到 `app-*`。
9. 清理 `bg-blue-50` 等主题逃逸点。
10. 最终移除 `--sf-*` 颜色 token 和兼容别名；SF Symbols 相关 `sf` 属性不受影响。

### 8.3 原生导航

文件：

- `apps/mobile/app/_layout.tsx`；
- `apps/mobile/app/(tabs)/_layout.tsx`；
- 各子 Stack `_layout.tsx`。

处理：

- 用 `useCSSVariable("--app-action")` 驱动 Tab tint；
- Stack header 背景接入实色表面 token；
- header 文字和返回按钮接入 ink/action token；
- 保留原生 blur、返回手势和可访问性；
- 不把水彩资产放进 Tab bar 或 header；
- 页面底色变为纸张色时，将 `apps/mobile/app.json` 的 `backgroundColor` 同步为最终 canvas 色，避免冷启动闪白。

---

## 九、分阶段执行计划

### 阶段 -1：冻结固定浅色基线

**目标**：先完成并提交已经存在的浅色模式决策与实现。

范围：

- ADR 0063 superseded 标记；
- ADR 0210；
- `app.json` 固定 `light`；
- `expo-system-ui` 依赖和配置；
- `global.css` 删除 dark media；
- UX 审计同步。

验证：

```bash
npm run mobile:prepare
npm run mobile:verify
cd apps/mobile
npx expo config --type public --json
npx expo config --type introspect --json
```

配置结果必须包含：

- iOS `UIUserInterfaceStyle = Light`；
- Android `expo_system_ui_user_interface_style = light`；
- Android light AppTheme；
- 浅色原生根背景。

建议提交：

`feat: 固定移动端浅色模式`

### 阶段 0：概念稿与视觉契约

**成本**：0.5–1.5 天，取决于反馈轮次。

工作：

1. 使用 Image Gen 生成第五节规定的四张完整概念图；
2. 每张图均按现有信息架构和真实中文文案生成；
3. 记录允许文案、颜色、字体、容器、图标、资产和动效；
4. 开发者选择并确认方向；
5. 将最终设计合同补充进本计划或独立的 `docs/design/mobile-watercolor/design-contract.md`；
6. 新增 ADR 0211。

门禁：

- 未获确认，不开始组件和页面代码；
- 概念图必须同时展示品牌层和中性工具层；
- 不接受只有顶部 hero 的不完整方案；
- 不接受看不清文字、间距、卡片结构或状态的概念图。

建议提交：

`docs: 记录移动端水彩视觉契约`

### 阶段 1：主题与媒体基础

**成本**：1–1.5 天。

文件范围：

- `apps/mobile/src/global.css`；
- `apps/mobile/src/ui/*`；
- `apps/mobile/assets/watercolor/*`；
- `apps/mobile/app/_layout.tsx`；
- `apps/mobile/app/(tabs)/_layout.tsx`；
- `apps/mobile/app.json`；
- 所有现有图片预览调用点。

工作：

1. 新增并映射 `app-*` token；
2. 定义圆角、阴影和容器规则；
3. 新增 `ScreenCanvas`、`Surface`、`AppButton`、`Badge`、`SectionTitle`、`MediaFrame`、`WatercolorBackdrop`；
4. 生成并优化生产水彩资产；
5. 全仓先迁移媒体画布；
6. 原生导航色接入 token；
7. 保持业务页面视觉基本不变，避免基础提交同时变成大范围换皮。

验收：

- 图片画布已经与 `sf-fill` 解耦；
- 新组件有明确 variant，不允许任意 className 拼装绕过；
- 水彩资产加载失败时，界面仍可用且不影响布局；
- 无新增运行时 UI 库；
- 无业务逻辑变更。

建议提交：

`refactor: 建立移动端视觉语义基础`

### 阶段 2：图鉴首页试点

**成本**：1–1.5 天。

范围：

- `PromptdexCatalogScreen.tsx`；
- 必要的 `src/ui` 小幅修正；
- 图鉴截图与 fidelity ledger。

工作：

1. 先实现首屏；
2. 截图并与已批准 `catalog-loaded-mobile.png` 对照；
3. 修正首屏后再实现下游区块；
4. 覆盖所有状态；
5. 验证真实图片和缺失图片；
6. 验证 Tab、滚动、卡片点击、图片详情入口和模板提炼入口；
7. 生成 Android、iOS、Web 截图；
8. 编写 fidelity ledger，逐项记录偏差和修复。

门禁：

- 与概念稿的文案、顺序、密度、颜色、字体、圆角、阴影和资产处理一致；
- 图片不受任何色罩影响；
- 没有为了水彩效果添加新业务卡片或说明；
- 没有可修复的视觉偏差后才能进入下一阶段。

建议提交：

`feat: 为图鉴首页引入水彩视觉`

### 阶段 3：品牌区扩展

**成本**：1–1.5 天。

范围：

- 首次设置顶部；
- 图鉴条目详情顶部；
- 全局空状态；
- 必要的 `Surface` / `SectionTitle` variants。

不包含：

- 条目详情表单结构调整；
- 模板提炼正文布局重构；
- 历史和模型配置深度视觉改造。

建议提交：

`feat: 扩展移动端水彩品牌表面`

### 阶段 4：工具层迁移与旧 token 清理

**成本**：1.5–2.5 天。

顺序：

1. 设置与模型配置；
2. 历史列表与详情；
3. 图片详情；
4. 模板提炼工具区；
5. 图鉴条目任务表单；
6. 启动和错误状态；
7. Stack 子布局；
8. `sf-*` 兼容层清理。

规则：

- 工具层只迁移语义、间距和共享组件，不增加水彩装饰；
- 状态色独立；
- 任何图片继续使用 `MediaFrame`；
- 大文件迁移应与 UX 结构改造协调，避免交叉提交；
- 不修改测试来迎合新组件实现。

建议拆为两个提交：

- `refactor: 统一移动端工具表面组件`
- `refactor: 移除旧版 SF 颜色 token`

### 阶段 5：跨端验收与收尾

**成本**：1–1.5 天。

工作：

- 全量功能验证；
- Android 截图矩阵；
- iOS 真机或模拟器浅色验收；
- 系统暗色下冷启动，确认应用仍固定浅色；
- Web 窄屏、平板、桌面宽屏；
- 动态字体、长文本、中文换行；
- reduced motion；
- 图片色彩中立性；
- 性能和包体；
- 许可证和资产来源；
- 文档、ADR 和计划状态更新。

---

## 十、验证方案

### 10.1 静态与单元验证

每个生产提交至少运行：

```bash
npm run mobile:prepare
npm run mobile:verify
git diff --check
```

合并前运行：

```bash
npm run verify
```

纪律：

- lint 新增 error 必须修复生产代码；
- 不修改既有测试、断言、Mock、Fixture 或测试辅助逻辑来规避失败；
- 视觉组件缺少 TSX 单测基础时，不为“有测试”而引入脆弱快照；
- 可判定的纯逻辑若新增，放入 `.ts` 并新增测试；
- UI 视觉以真实渲染与概念图对照为主。

### 10.2 Expo 配置验证

```bash
cd apps/mobile
npx expo config --type public --json
npx expo config --type introspect --json
```

检查：

- `userInterfaceStyle` 仍为 `light`；
- iOS `UIUserInterfaceStyle` 仍为 `Light`；
- Android 仍为 light theme；
- 原生启动背景与最终 `app-canvas` 一致；
- `expo-system-ui` 插件正常解析。

### 10.3 Android 截图

试点阶段：

```bash
npm run mobile:screenshots:android -- --only catalog,settings,image-detail,symbol-icons
```

全量阶段：

```bash
npm run mobile:screenshots:android
```

截图前将模拟器系统设为暗色，冷启动应用，确认应用仍保持浅色。

### 10.4 Web 验收

启动：

```bash
npm run mobile:web
```

视口：

- 390×844；
- 412×915；
- 768×1024；
- 1280×800。

检查：

- 内容最大宽度；
- 页面居中；
- Tab/导航可用；
- hover 只是增强；
- 键盘 focus 可见；
- 不出现横向滚动；
- 本地资产路径正确；
- 浏览器不会重新强制暗化；
- 宽屏不把移动卡片无限拉伸。

### 10.5 iOS 验收

- 系统浅色冷启动；
- 系统暗色冷启动；
- 首页、条目详情、图片详情、设置；
- Stack header、返回按钮、Tab；
- Dynamic Type；
- VoiceOver 顺序；
- 图片预览没有色罩；
- generic serif 若被使用，检查中文 fallback；
- 水彩资产透明边缘没有黑边或白边。

### 10.6 概念稿 fidelity 验收

每个实现页面必须同时用 `view_image` 查看：

1. 已批准概念图；
2. 最新真实渲染截图。

fidelity ledger 至少比较：

- 可见文案；
- 页面信息顺序；
- 首屏焦点；
- 背景和主色；
- 标题与正文排版；
- 卡片和列表密度；
- 圆角、边框和阴影；
- 水彩资产位置、裁切和透明度；
- 图片画布；
- 图标样式和颜色；
- 交互状态；
- 响应式布局。

必须做首屏文案 diff。新增、删除、重命名或重排可见文案，必须修复或记录为开发者批准的偏差。

### 10.7 功能路径

至少验证：

1. 图鉴首页 → 内置条目 → 填写输入 → 生成图片 → 打开图片详情；
2. 图鉴首页 → 模板提炼 → 编辑输入 → 生成方案；
3. 图鉴首页 → 已生成代表图 → 图片详情；
4. 历史列表 → 历史详情；
5. 设置 → 模型配置 → 新增/编辑/测试；
6. 首次设置 → 完成配置 → 进入图鉴；
7. 加载失败、图片缺失、任务失败和禁用按钮。

---

## 十一、验收矩阵

### 11.1 图鉴首页状态

| 状态 | 必须验证 |
| --- | --- |
| 加载中 | 水彩背景不干扰进度反馈 |
| 加载失败 | 错误色和文字清楚，无装饰遮挡 |
| 完全空 | 空状态有品牌感但没有虚假内容 |
| 仅未生成条目 | 列表密度正常 |
| 有生成条目 | 代表图颜色保持原样 |
| 有其他图片 | 缩略图和文本对齐 |
| 图片文件缺失 | 中性 media matte 与图标可读 |
| 提炼新建 | 主入口是唯一焦点 |
| 提炼编辑中 | 状态文字清楚 |
| 提炼进行中 | 不依赖颜色单独表达状态 |
| 提炼待审阅 | 可发现但不过度抢夺主内容 |
| 提炼失败 | 危险/警告语义保持稳定 |

### 11.2 无障碍

- 正常正文对比度 ≥ 4.5:1；
- 大号文字对比度 ≥ 3:1；
- 可交互边界可辨；
- 触控目标 ≥ 44×44 pt；
- 状态不只靠颜色表达；
- 装饰资产不进入无障碍树；
- 字体放大后不截断主要按钮和标题；
- reduced motion 时不播放非必要动画；
- 键盘 focus 可见；
- 屏幕阅读顺序与视觉顺序一致。

### 11.3 图片中立性

- 不对图片使用 opacity；
- 不对图片父层使用 blend mode、filter 或彩色 overlay；
- media matte 为无色中性灰；
- 缩略图、代表图、详情图使用同一媒体契约；
- 用已知色卡或标准测试图片人工对照；
- 不为适应新主题修改既有图标像素阈值或截图 Fixture。

### 11.4 性能

- 首屏新增装饰资产总量在预算内；
- 长列表不为每个 item 创建大型纹理；
- 无持续动画；
- 无实时 blur；
- 滚动无明显掉帧；
- Web 首屏资源不重复下载；
- 图片缓存与现有 `expo-image` 行为一致；
- 包体增量有记录。

---

## 十二、风险与缓解

| 风险 | 后果 | 缓解 |
| --- | --- | --- |
| 直接安装 shadcn theme | 引入 Web 组件假设和暗色变量 | 禁止 registry 安装，只提炼设计契约 |
| iOS `platformColor()` 覆盖 | iOS 与 Android 品牌色不一致 | 在迁移阶段移除颜色覆盖，只保留字体平台规则 |
| `sf-fill` 被染色 | 图片判断失真 | 先建立 `MediaFrame` 和独立 media matte |
| 水彩低对比 | 正文、按钮不可读 | 固定高对比 ink/action，wash 只作装饰 |
| 每卡纹理 | 长列表 overdraw、内存和视觉噪声 | 每屏最多 1–2 个复用资产 |
| 自定义 CJK 字体 | 包体和跨端 fallback 风险 | 首批保持系统字体 |
| 所有控件 500 ms | 工具操作迟钝 | 工具控件 120–240 ms，慢动效只给装饰 |
| 大圆角全局替换 | 组件层级丢失 | 通过 UI component variants 管理 |
| 上游 token 不一致 | 实现随来源漂移 | 概念确认后冻结 Imagemon 自有 token |
| 与 UX 大文件重构冲突 | 大量 merge conflict 和返工 | 主题基础、结构改造、页面迁移分提交 |
| 只通过编译宣布完成 | 跨端视觉问题漏检 | 概念图与真实截图强制对照 |
| 暂时保留 `sf-*` | 迁移长期不收尾 | 阶段 4 设为明确 DoD，禁止新增旧 token |

---

## 十三、回滚策略

不增加运行时主题开关。回滚依赖清晰提交边界：

1. 固定浅色基线提交独立保留；
2. 主题基础提交只增加 token、组件和中性 media matte，可单独保留；
3. 图鉴首页试点单独提交，可一键 revert；
4. 品牌扩展和工具层迁移分别提交；
5. `sf-*` 兼容层在全量迁移完成前不删除；
6. 生产资产只由对应页面引用，页面回滚后可安全删除未引用资产；
7. 若试点被否决，保留 `MediaFrame` 与中性图片画布，撤销水彩 token、资产和页面使用。

---

## 十四、提交与 PR 划分

推荐顺序：

1. `feat: 固定移动端浅色模式`
2. `docs: 记录移动端水彩视觉契约`
3. `refactor: 建立移动端视觉语义基础`
4. `feat: 为图鉴首页引入水彩视觉`
5. `feat: 扩展移动端水彩品牌表面`
6. `refactor: 统一移动端工具表面组件`
7. `refactor: 移除旧版 SF 颜色 token`

每个 PR 必须说明：

- 涉及页面；
- 不涉及的页面；
- 概念图路径；
- 实现截图路径；
- 运行过的命令；
- 视觉比较结果；
- 已知偏差；
- 是否改变包体；
- 是否需要重新生成原生包。

---

## 十五、完成定义

只有同时满足以下条件才算完成：

- [x] 固定浅色模式改动已独立提交；
- [x] ADR 0211 已新增；
- [x] 完整概念稿和状态稿已获得开发者确认；
- [x] 最终 token 已冻结并记录；
- [x] 水彩生产资产已独立生成、优化并记录来源；
- [x] `app-*` 语义 token 已覆盖 iOS、Android、Web；
- [x] 图片预览全部使用独立 `MediaFrame` / media matte；
- [x] 原生 Tab 与 Stack 接入新 token；
- [x] 图鉴首页所有状态完成迁移；
- [x] 首次设置和条目详情品牌区完成迁移；
- [x] 工具页面保持中性且共享组件收敛；
- [x] 不再存在 `bg-blue-50` 等主题逃逸；
- [x] 不再存在 `--sf-*` 颜色 token 或 `sf-*` 颜色类引用；
- [x] SF Symbols 的平台映射仍正常；
- [x] `npm run mobile:verify` 通过；
- [x] `npm run verify` 通过；
- [x] Expo public/introspect 配置验证通过；
- [ ] Android 全量截图通过（17 个页面已分批通过，内置条目已手工补证；单命令仍有一条既有跨视口断言失败）；
- [ ] iOS 浅色与系统暗色环境冷启动验收通过（当前 Linux 环境无 `xcrun`/Simulator）；
- [x] Web 四档视口通过；
- [ ] 对比度、Dynamic Type、键盘 focus 和 reduced motion 通过（对比度、Web focus 与装饰动效已验；设备 Dynamic Type 仍待验）；
- [x] 已批准概念图与最终渲染图均使用 `view_image` 检查；
- [x] fidelity ledger 至少覆盖五项具体比较点；
- [x] 首屏文案 diff 无未批准差异；
- [ ] 核心功能路径全部通过（单元/集成测试、路由截图和关键交互已通过；七条真实端到端链路仍待执行）；
- [x] 图片像素显示不受主题叠色影响；
- [x] 没有通过修改测试、断言、Mock 或 Fixture 绕过失败；
- [x] 没有残留临时 QA 资产或未使用生产资源；
- [ ] 没有可修复的视觉偏差（聚焦代码复审无明确问题；外部平台运行时验收未完成，暂不作全局结论）。

---

## 十六、立即下一步

1. 在 macOS/iOS 设备完成浅色、系统暗色冷启动、Dynamic Type、VoiceOver 与透明边缘验收；
2. 在 Android 设备完成系统暗色冷启动与放大字体矩阵；
3. 由开发者单独裁决内置条目跨视口截图合同；本轮保留失败证据，不修改测试、断言或 fixture 绕过；
4. 使用可用测试凭据和真实存储能力执行第 10.7 节七条端到端业务链路；
5. 外部验收完成后更新上述未完成定义，并作最终发布判断。
