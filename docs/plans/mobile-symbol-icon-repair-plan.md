# 移动端跨平台系统图标修复计划

本文档描述 `apps/mobile` 在 Expo SDK 54 下修复业务图标空白问题的完整实施方案。正式方案
保留统一的 `SymbolIcon` 门面：iOS 使用 `expo-symbols` 的原生 `SymbolView`，Android 和
Web 使用 Ionicons fallback；所有平台图标名称集中在语义图标目录中管理，不允许业务页面自行
判断平台或直接拼接 `sf:` URI。

本计划按可独立验证、可独立回滚的原子子任务执行。每个子任务完成后必须创建本文档标注的
独立 git commit；前一项未通过验收时，不进入下一项，也不通过修改测试、断言、Mock、Fixture
或截图基线绕过失败。

## 目标

- 修复设置页、图鉴页、模型配置、任务历史、图片详情、首次设置等页面中的空白图标。
- iOS 业务图标使用 `expo-symbols/SymbolView` 渲染真正的 SF Symbols。
- Android 和 Web 通过集中式语义映射使用 Ionicons fallback，不依赖 SF Symbol 名称碰运气。
- 保留 `SymbolIcon` 作为业务层唯一图标组件；约 50 个调用点不直接导入平台图标库。
- 将图标名称从“某个平台的资源名”提升为稳定的应用语义键，解决同一 SF Symbol 同时表示
  “保存”和“下载”时无法一对一映射的问题。
- `className`、`tintColor` 和现有尺寸继续生效，修复不改变按钮布局、颜色 token 或业务行为。
- 缺少语义映射时不得静默显示空白：开发环境告警，所有环境显示明确的缺省图标。
- 补齐 NativeTabs 的 Android 图标来源；iOS 继续使用原生 `sf` 配置。
- 建立类型、静态契约和设备截图三层验证，避免相同问题再次被纯文本截图检查漏掉。
- 每个子任务都有独立中文 Conventional Commit，并在提交前完成该任务列出的验证。

## 非目标

- 不升级 Expo SDK、Expo Router、React Native、NativeWind 或 `expo-image`。
- 不用 SDK 55 的 `expo-image source="sf:..."` 能力反向覆盖 SDK 54。
- 不恢复全应用统一使用 `@expo/vector-icons`；Ionicons 只作为 Android/Web fallback 和
  NativeTabs Android 图标来源。
- 不重做页面布局、主题 token、按钮文案、导航结构或业务流程。
- 不把普通位图从 `expo-image` 迁走；本轮只拆分系统图标渲染职责。
- 不把平台图标名保存到 SQLite、备份、任务快照或其他业务数据中。
- 不因测试失败删除测试、放宽断言、跳过验证或更新基线来掩盖生产代码问题。
- 不为纯技术修复新增领域术语；`CONTEXT.md` 无需更新。
- 不在本轮升级到新版跨平台 Material Symbols；升级策略仅作为后续退出条件记录。

## 当前基线与故障原因

- 移动端应用位于 `apps/mobile`。
- 当前依赖为 `expo@~54.0.0`、`expo-image@~3.0.11`、`expo-router@~6.0.24`、
  `expo-font@~14.0.12`。
- `apps/mobile/src/tw/index.tsx` 中的 `SymbolIcon` 当前执行：

```tsx
return <Image {...props} source={`sf:${name}`} tintColor={tintColor} />;
```

- 这里的 `Image` 最终是 `expo-image`。SDK 54 的 `expo-image@3.0.11` 会把 `sf:photo`
  解析为普通 URI，iOS 端没有 `sf:` loader，因此加载失败。
- 当前 `SymbolIcon` 没有错误占位或可见失败状态，外层灰色或白色容器继续渲染，内部图片为空，
  形成截图中的“空白方块”。
- `sf-symbols-typescript` 只是开发期类型包，不包含运行时渲染器。
- 底部 iOS Tab 图标仍能显示，是因为 `expo-router/unstable-native-tabs` 的 `Icon sf={...}`
  走原生 NativeTabs 通路，没有经过 `SymbolIcon -> expo-image`。
- 当前共有 50 个 `SymbolIcon` JSX 调用点，分布在 10 个 TSX 文件；综合静态值和动态传值
  链路，共使用 31 个唯一 SF Symbol 名称。
- 50 个调用点只使用 `name`、`className`、`tintColor` 三类属性，没有依赖图片加载事件、
  `contentFit` 或其他 `expo-image` 专用能力。
- 回归由提交 `217bd8e` 首次引入。该提交删除业务页面中的 Ionicons，新增以 `expo-image`
  为底座的 `SymbolIcon`。
- 现有 Android 截图脚本只等待关键文案并保存截图，不判断图标区域是否含有可见前景像素，
  因而没有阻止回归。

## 方案选择

### 平台渲染

- iOS：`expo-symbols/SymbolView`。
- Android、Web：`@expo/vector-icons/Ionicons`。
- NativeTabs：iOS 继续使用 `Icon sf`；Android 使用 SDK 54 的
  `androidSrc={<VectorIcon ... />}`。
- 普通图片：继续使用当前 `expo-image` 包装组件，与系统图标彻底分离。

`expo-symbols@~1.0.8` 和 `@expo/vector-icons@^15.0.3` 都与当前移动端实际安装的
Expo 54.0.35 兼容。二者必须成为 `@imagemon/mobile` 的直接依赖，不能依赖 Expo 的
传递依赖恰好存在。

### 使用语义键而不是 SF Symbol 作为公共名称

公共类型命名为 `AppIconName`，其值表达应用语义，例如 `save`、`download`、`warning`，
而不是 `square.and.arrow.down`、`exclamationmark.triangle` 等平台资源名。

采用语义键的直接原因是当前 `square.and.arrow.down` 同时用于：

- 图片和历史页面的“下载到相册”，Android 应回退为 `download-outline`；
- 模型配置编辑器的“保存配置”，Android 应回退为 `save-outline`。

如果按 SF Symbol 名称做一对一映射，两种业务含义只能错误地共享一个 fallback。语义目录允许
`save` 和 `download` 在 iOS 复用同一个 SF Symbol，同时在 Android 使用不同 Ionicons。

### 目录结构

计划新增以下文件，名称可在实现时保持同等职责，但不得重新把平台逻辑放回业务页面：

```text
apps/mobile/src/tw/
  symbol-icon-definitions.ts   # 语义键、iOS/Android 映射、Tab 映射、纯解析函数
  symbol-icon.types.ts         # SymbolIcon 公共 props
  symbol-icon.ios.tsx          # SymbolView 实现
  symbol-icon.tsx              # Android/Web Ionicons 实现
  symbol-icon-fonts.ios.ts     # iOS 不加载 Ionicons 字体
  symbol-icon-fonts.ts         # Android/Web 导出 Ionicons.font
  symbol-icon-definitions.test.ts
  index.tsx                    # 继续统一导出 SymbolIcon/AppIconName
```

React Native/Metro 根据文件扩展名选择平台实现。业务组件继续从 `src/tw` 引入，不直接导入
`expo-symbols` 或 Ionicons。

## 语义图标目录

下表冻结本轮需要的业务图标映射。实现时允许因最低 iOS 版本可用性换成语义等价的旧 SF
Symbol，但必须在对应 commit 说明中记录，且不得只修改单个平台而改变业务语义。

| `AppIconName` | iOS SF Symbol | Android/Web Ionicons | 说明 |
| --- | --- | --- | --- |
| `refresh` | `arrow.clockwise` | `refresh-outline` | 刷新或重新生成 |
| `next` | `arrow.right` | `arrow-forward-outline` | 继续下一步 |
| `expand` | `arrow.up.left.and.arrow.down.right` | `expand-outline` | 展开输入 |
| `connection-test` | `bolt` | `flash-outline` | 测试连接 |
| `confirm` | `checkmark` | `checkmark-outline` | 确认操作 |
| `success` | `checkmark.circle` | `checkmark-circle-outline` | 成功反馈 |
| `checkbox-checked` | `checkmark.square` | `checkbox-outline` | 已选择 |
| `checkbox-empty` | `square` | `square-outline` | 未选择 |
| `chevron-down` | `chevron.down` | `chevron-down` | 向下展开 |
| `chevron-right` | `chevron.right` | `chevron-forward` | 进入详情 |
| `chevron-up` | `chevron.up` | `chevron-up` | 向上收起 |
| `copy` | `doc.on.doc` | `copy-outline` | 复制内容 |
| `document` | `doc.text` | `document-text-outline` | 文档或待审阅方案 |
| `warning` | `exclamationmark.triangle` | `warning-outline` | 警告或失败反馈 |
| `skip` | `forward.end` | `play-skip-forward-outline` | 跳过设置 |
| `settings` | `gearshape` | `settings-outline` | 设置入口 |
| `pending` | `hourglass` | `hourglass-outline` | 加载或处理中 |
| `information` | `info.circle` | `information-circle-outline` | 普通提示 |
| `locked` | `lock` | `lock-closed-outline` | 暂不支持或锁定 |
| `edit` | `pencil` | `create-outline` | 编辑 |
| `photo` | `photo` | `image-outline` | 单张图片 |
| `photos` | `photo.on.rectangle` | `images-outline` | 多张图片或相册 |
| `server` | `server.rack` | `server-outline` | 模型服务配置 |
| `sparkles` | `sparkles` | `sparkles-outline` | 提炼或生成 |
| `download` | `square.and.arrow.down` | `download-outline` | 下载或保存到相册 |
| `save` | `square.and.arrow.down` | `save-outline` | 保存模型配置 |
| `favorite` | `star` | `star-outline` | 设为默认 |
| `text-model` | `text.bubble` | `chatbubble-ellipses-outline` | 文本模型 |
| `delete` | `trash` | `trash-outline` | 删除 |
| `empty-tray` | `tray` | `file-tray-outline` | 空列表 |
| `magic-wand` | `wand.and.stars` | `color-wand-outline` | 图片编辑生成 |
| `close` | `xmark` | `close` | 关闭编辑器 |

NativeTabs 使用独立定义，避免把选中态混入普通业务图标：

| Tab | iOS 默认 | iOS 选中 | Android |
| --- | --- | --- | --- |
| `catalog` | `square.grid.2x2` | `square.grid.2x2.fill` | `grid-outline` |
| `history` | `clock` | `clock.fill` | `time-outline` |
| `settings` | `gearshape` | `gearshape.fill` | `settings-outline` |

## 关键实现约束

### 公共组件契约

`SymbolIcon` 不再继承 `expo-image` 的 `ImageProps`。公共属性至少包含：

```ts
interface SymbolIconProps {
  name: AppIconName;
  className?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  tintColor?: ColorValue;
  testID?: string;
}
```

- `name` 必须是语义目录键，禁止业务页面传 SF Symbol 或 Ionicons 名称。
- `size` 的优先级为：显式 `size`、解析后的数值 `style.width`、数值 `style.height`、默认 24。
- 当前调用点使用的 `h-* w-*` className 通过 `useCssElement` 映射为 `style`，因此不要求为了
  修复同时改写全部尺寸样式。
- 非数值宽高不能被当成 glyph size；遇到百分比或字符串尺寸时回退到显式 `size` 或默认值。
- `tintColor` 原样传给 `SymbolView.tintColor` 或 `Ionicons.color`。
- 图标默认是装饰元素；按钮和可交互容器继续承担 accessibility label。只有独立表达状态的
  图标才显式增加无障碍文案。

### iOS 实现

- 使用 `SymbolView`，设置 `name={definition.ios}`、`resizeMode="scaleAspectFit"`、解析后的
  `size` 和 `tintColor`。
- 样式中保留最终宽高，避免 glyph 尺寸与布局盒不一致。
- 默认 weight 使用 `regular`；需要强调时由公共 props 显式传入，不能在页面直接操作
  `SymbolView`。
- 所有目录中的 SF Symbol 必须在项目最低支持的 iOS 版本上验证。若某名称不可用，提交前
  换成更早可用的语义等价名称，不能接受旧系统继续空白。

### Android/Web 实现

- 使用 `Ionicons`，图标名只来自 `definition.fallback`。
- 通过 `symbol-icon-fonts.ts` 暴露 `Ionicons.font`，在根布局使用 `useFonts` 参与启动门禁。
- iOS 的 `symbol-icon-fonts.ios.ts` 返回空字体表，避免 iOS 为业务图标加载 Ionicons 字体。
- 字体加载失败进入已有启动失败 UI 或专门的明确错误状态，不能继续进入应用并显示空白图标。
- Web 使用同一 fallback；至少验证构建和主要页面，不要求与原生平台像素完全一致。

### 缺失映射

- `getAppIconDefinition` 对合法 `AppIconName` 返回完整的 iOS/fallback 定义。
- 对运行时非法值，开发环境按名称只告警一次，并返回固定的缺省定义。
- 缺省定义在 iOS 和 Android/Web 都必须可见，不能使用透明图片或空 `View`。
- TypeScript 应在正常业务代码中阻止非法名称；运行时保护只负责非类型安全边界。

### 依赖和导入边界

- `expo-symbols` 只能在 `symbol-icon.ios.tsx` 中作为运行时组件导入。
- Ionicons 只能在 Android/Web fallback、字体表和 NativeTabs 布局中导入。
- 集中定义文件可以用 `import type` 引用两套图标名称类型；静态检查必须区分 type-only import
  与运行时 import。
- 业务页面不得导入 `expo-symbols`、`@expo/vector-icons` 或 `sf-symbols-typescript`。
- `sf-symbols-typescript` 在平台组件落地后删除，`SFSymbol` 类型改用 `expo-symbols` 导出的
  类型或由定义对象推导。
- `expo-image` 继续只负责普通图片；`SymbolIcon` 实现中禁止出现 `source="sf:..."`。

### 提交纪律

- 执行前工作区必须干净，或明确隔离开发者已有改动。
- 每个子任务只暂存该任务列出的文件；不得把后续任务提前混入当前 commit。
- 每个 commit 创建前运行该任务的全部验证命令。
- 不使用 `--no-verify`。若确需使用，必须补跑仓库要求的 `npm run build:skill` 和
  `npm run verify`，并确认生成产物已纳入正确提交。
- 本计划要求保留每个子任务的独立 commit，不在实施阶段 squash。

## 可执行子任务与提交边界

### 0. 记录修复计划

Commit 标注：`docs: 记录移动端跨平台图标修复计划`

改动范围：

- 新增 `docs/plans/mobile-symbol-icon-repair-plan.md`。

验收：

- 文档明确根因、正式方案、31 个现有 SF Symbol 的迁移策略和 NativeTabs 平台策略。
- 文档中的每个后续子任务均有唯一 Commit 标注、验证命令和建议提交命令。
- 不修改 `CONTEXT.md` 或 ADR；本次不改变产品领域语言或业务决策。

验证命令：

```bash
git diff --check
```

建议提交命令：

```bash
git add docs/plans/mobile-symbol-icon-repair-plan.md
git commit -m "docs: 记录移动端跨平台图标修复计划"
```

### 1. 添加兼容当前 SDK 的直接依赖

Commit 标注：`build: 添加移动端跨平台图标依赖`

改动范围：

- 修改 `apps/mobile/package.json`。
- 修改根 `package-lock.json`。
- 添加与 Expo 54.0.35 匹配的 `expo-symbols@~1.0.8`。
- 将已经由 Expo 传递安装的 `@expo/vector-icons@^15.0.3` 声明为移动端直接依赖。

实现要求：

- 在 `apps/mobile` 目录使用 Expo 安装命令解析兼容版本：

```bash
cd apps/mobile
npx expo install expo-symbols @expo/vector-icons
```

- 本任务暂不删除 `sf-symbols-typescript`，避免依赖 commit 单独落地时破坏当前类型检查；它在
  平台组件切换任务中随旧实现一起删除。
- 不修改 `app.json`；上述包在当前 Expo Go 中可用，不需要新增 config plugin。
- 不修改 Metro/Babel 配置，除非安装后用实际错误证明 workspace 解析确有缺口。

验收：

- `apps/mobile/package.json` 明确声明两个运行时依赖。
- lockfile 解析到 Expo 54 兼容版本，没有额外 Expo 或 React Native 主版本。
- 当前应用在尚未切换渲染器的情况下仍能 typecheck 和运行既有测试。

验证命令：

```bash
(cd apps/mobile && npx expo install --check)
npm run mobile:typecheck
npm run mobile:test
git diff --check
```

建议提交命令：

```bash
git add apps/mobile/package.json package-lock.json
git commit -m "build: 添加移动端跨平台图标依赖"
```

### 2. 建立集中式语义图标目录

Commit 标注：`feat: 建立移动端语义图标目录`

改动范围：

- 新增 `apps/mobile/src/tw/symbol-icon-definitions.ts`。
- 新增 `apps/mobile/src/tw/symbol-icon.types.ts`，声明平台无关的公共 props；本任务不替换
  当前 `SymbolIcon` 实现。

实现要求：

- 按“语义图标目录”表定义 `APP_ICON_DEFINITIONS` 和 `TAB_ICON_DEFINITIONS`。
- 使用 `as const` 和 `satisfies` 同时约束 SF Symbol 与 Ionicons 名称。
- 导出 `AppIconName = keyof typeof APP_ICON_DEFINITIONS`。
- 提供纯函数：
  - `getAppIconDefinition(name)`；
  - `resolveSymbolIconSize(explicitSize, width, height)`；
  - 缺省定义与按名称去重的开发期告警辅助逻辑。
- `save` 与 `download` 必须是两个不同语义键；测试连接、成功、警告、待处理等状态也使用
  语义键，不把平台资源名泄漏给页面。
- 当前 31 个 SF Symbol 全部能在目录中找到语义归属；NativeTabs 三个入口也有完整定义。

不做：

- 不在本任务修改 50 个现有调用点。
- 不在本任务切换 iOS/Android 渲染组件。
- 不新增仅为让未完成实现通过的宽泛 `string` 类型或类型断言。

验收：

- 映射文件能够被 TypeScript 单独检查。
- Ionicons 名称均存在于当前安装版本的 glyph 类型中。
- `save` 和 `download` 在 Android/Web 分别解析为 `save-outline`、`download-outline`。
- `warning` 使用双方均表达警告含义的可见图标。

验证命令：

```bash
npm run mobile:typecheck
npm run mobile:test
git diff --check
```

建议提交命令：

```bash
git add apps/mobile/src/tw/symbol-icon-definitions.ts \
  apps/mobile/src/tw/symbol-icon.types.ts
git commit -m "feat: 建立移动端语义图标目录"
```

如果未创建 `symbol-icon.types.ts`，提交时只暂存实际存在的定义文件，不创建空文件。

### 3. 使用平台组件替换失效的图片 URI 实现

Commit 标注：`fix: 使用平台组件渲染移动端图标`

改动范围：

- 新增：
  - `apps/mobile/src/tw/symbol-icon.ios.tsx`
  - `apps/mobile/src/tw/symbol-icon.tsx`
  - `apps/mobile/src/tw/symbol-icon-fonts.ios.ts`
  - `apps/mobile/src/tw/symbol-icon-fonts.ts`
- 修改 `apps/mobile/src/tw/index.tsx`，删除旧 ``source={`sf:${name}`}`` 实现，改为统一导出
  平台组件和 `AppIconName`。
- 修改 `apps/mobile/app/_layout.tsx`，把 fallback 字体加载接入启动门禁。
- 将以下 10 个文件中的 50 个调用点迁移为语义键，并把 `SFSymbolName` 类型改为
  `AppIconName`：
  - `apps/mobile/app/(tabs)/(history)/history.tsx`
  - `apps/mobile/app/(tabs)/(settings)/settings.tsx`
  - `apps/mobile/app/history/[id].tsx`
  - `apps/mobile/app/images/[id].tsx`
  - `apps/mobile/app/model-configurations/index.tsx`
  - `apps/mobile/src/first-run/index.tsx`
  - `apps/mobile/src/model-configurations/ModelConfigurationEditor.tsx`
  - `apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx`
  - `apps/mobile/src/promptdex/PromptdexEntryDetailScreen.tsx`
  - `apps/mobile/src/promptdex/TemplateRefinementScreen.tsx`
- 修改 `apps/mobile/package.json` 和根 `package-lock.json`，删除不再需要的
  `sf-symbols-typescript`。

实现要求：

- iOS 文件只使用 `SymbolView`；默认文件只使用 Ionicons。
- 两个平台实现都复用同一 `APP_ICON_DEFINITIONS`、公共 props 和尺寸解析函数。
- 继续通过 `useCssElement` 把 `className` 映射到 `style`。
- 保持现有 16、18、20、22、24、28、30、36、40 等图标视觉尺寸，不改变按钮盒尺寸。
- `square.and.arrow.down` 的调用按上下文分别迁移为 `save` 或 `download`。
- 所有 `exclamationmark.triangle` 调用迁移为 `warning`，Android/Web 使用
  `warning-outline`。
- 字体加载期间显示明确启动状态；加载失败显示错误，不进入可操作页面。
- 生产代码中不再出现 `SFSymbolName` 和 `source="sf:..."` 系统图标实现。
- 普通 `Image` 包装器和真实图片 URI 行为保持不变。

不做：

- 不修改页面布局、按钮结构、文案、颜色 class 或业务状态判断。
- 不在调用点传 `fallbackName`；平台资源名只能存在于集中目录。

验收：

- 50 个调用点全部编译为 `AppIconName`，非法语义键会在 TypeScript 阶段失败。
- iOS `SymbolIcon` 不再依赖 `expo-image`；Android/Web 不依赖 SF Symbol URI。
- `sf-symbols-typescript` 已从直接依赖和源码 import 中消失。
- 启动状态不会因 Ionicons 字体未加载短暂显示空图标。
- 既有移动端单元测试全部通过。

验证命令：

```bash
! rg -n 'SFSymbolName|source=.*sf:' apps/mobile/app apps/mobile/src
npm run mobile:typecheck
npm run mobile:test
(cd apps/mobile && npx expo export --platform ios --output-dir "$(mktemp -d /tmp/imagemon-mobile-export-ios.XXXXXX)")
(cd apps/mobile && npx expo export --platform android --output-dir "$(mktemp -d /tmp/imagemon-mobile-export-android.XXXXXX)")
(cd apps/mobile && npx expo export --platform web --output-dir "$(mktemp -d /tmp/imagemon-mobile-export-web.XXXXXX)")
git diff --check
```

上述 `rg` 预期无输出；若文档或注释需要描述旧实现，应限定搜索到生产源码目录再判断。
三个 export 目录必须位于 `/tmp` 或其他仓库外目录，用于验证平台文件选择、native module 和
当前自定义 Metro 解析；不得把导出产物写入或提交到仓库。

建议提交命令：

```bash
git add apps/mobile/src/tw \
  apps/mobile/app/_layout.tsx \
  apps/mobile/app/'(tabs)'/'(history)'/history.tsx \
  apps/mobile/app/'(tabs)'/'(settings)'/settings.tsx \
  apps/mobile/app/history/[id].tsx \
  apps/mobile/app/images/[id].tsx \
  apps/mobile/app/model-configurations/index.tsx \
  apps/mobile/src/first-run/index.tsx \
  apps/mobile/src/model-configurations/ModelConfigurationEditor.tsx \
  apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx \
  apps/mobile/src/promptdex/PromptdexEntryDetailScreen.tsx \
  apps/mobile/src/promptdex/TemplateRefinementScreen.tsx \
  apps/mobile/package.json package-lock.json
git commit -m "fix: 使用平台组件渲染移动端图标"
```

### 4. 补齐 NativeTabs 的 Android 图标来源

Commit 标注：`fix: 补齐原生标签页平台图标`

改动范围：

- 修改 `apps/mobile/app/(tabs)/_layout.tsx`。
- 必要时调整 `TAB_ICON_DEFINITIONS`，但不得在布局文件重复维护平台名称。

实现要求：

- 从 SDK 54 的 `expo-router/unstable-native-tabs` 导入 `VectorIcon`。
- iOS `sf` 继续使用目录中的默认/选中名称。
- Android `androidSrc` 使用 `VectorIcon family={Ionicons}` 和目录中的 fallback 名称。
- 不使用 SDK 55 的 `NativeTabs.Trigger.Icon` 写法。
- 不改变 tab route、标签文案、tintColor 或 `minimizeBehavior`。

验收：

- iOS Tab 仍显示默认态和选中态 SF Symbols。
- Android 的图鉴、历史、设置三个 Tab 均显示图标。
- 切换 Tab 时 tint 和选中状态正常，不出现重复 Tab 或空白项。

验证命令：

```bash
npm run mobile:typecheck
npm run mobile:test
npm run mobile:screenshots:android -- --only catalog,history-list,settings
git diff --check
```

建议提交命令：

```bash
git add apps/mobile/app/'(tabs)'/_layout.tsx \
  apps/mobile/src/tw/symbol-icon-definitions.ts
git commit -m "fix: 补齐原生标签页平台图标"
```

### 5. 增加图标映射和导入边界契约测试

Commit 标注：`test: 覆盖移动端图标渲染契约`

改动范围：

- 新增 `apps/mobile/src/tw/symbol-icon-definitions.test.ts`。
- 新增 `scripts/check-mobile-symbol-icons.mjs`。
- 修改根 `package.json`，新增 `check:mobile-icons`，并把它接入 `mobile:verify`。

测试要求：

- 单元测试覆盖：
  - 本计划列出的全部 `AppIconName` 均存在；
  - 每项都有非空 iOS 与 Android/Web 名称；
  - `save` 与 `download` 的 fallback 不同且符合预期；
  - `resolveSymbolIconSize` 的显式尺寸、宽、高、默认值和非法字符串分支；
  - 未知运行时名称返回可见缺省定义，并按名称去重告警；
  - 三个 NativeTabs 定义都有 iOS 默认/选中态和 Android 名称。
- 静态检查脚本使用 TypeScript Compiler API 解析 AST，区分 `import type` 和运行时 import，
  不使用可能误报 type-only import 的纯文本匹配。检查内容覆盖：
  - `apps/mobile` 生产代码不再出现旧 ``source={`sf:${name}`}`` 实现；
  - `expo-symbols` 的运行时导入只出现在 iOS 适配器；
  - Ionicons 的业务运行时导入只出现在 fallback、字体表和 NativeTabs 布局；
  - 业务页面不再导入或引用 `SFSymbolName`；
  - `SymbolIcon` 调用点不允许新增 `fallbackName` 或平台判断。
- 检查失败时只能修生产代码、映射或检查器自身真实缺陷，不能删除检查项让错误实现通过。
- 检查器接受可注入的扫描根目录，并提供 `--self-test`：在系统临时目录创建通过/失败 fixture，
  证明 type-only import 允许、非法运行时 import 会失败、旧 `sf:` 实现会失败、调用点
  `fallbackName` 会失败。自测不得临时改坏生产文件。

验收：

- 定向图标测试通过。
- `npm run mobile:verify` 自动包含图标契约检查。
- `--self-test` 在临时目录证明检查器既能接受合法 fixture，也能拒绝每类非法 fixture。

验证命令：

```bash
npm run test --workspace @imagemon/mobile -- symbol-icon-definitions.test.ts
npm run check:mobile-icons -- --self-test
npm run check:mobile-icons
npm run mobile:verify
git diff --check
```

建议提交命令：

```bash
git add apps/mobile/src/tw/symbol-icon-definitions.test.ts \
  scripts/check-mobile-symbol-icons.mjs package.json
git commit -m "test: 覆盖移动端图标渲染契约"
```

### 6. 增加可失败的设备视觉回归检查

Commit 标注：`test: 增加移动端图标视觉回归检查`

改动范围：

- 新增 `apps/mobile/app/screenshot-symbol-icons.tsx`，仅在
  `EXPO_PUBLIC_IMAGEMON_SCREENSHOT_MODE=1` 时展示。
- 修改 `apps/mobile/app/_layout.tsx`，为截图模式注册稳定标题；正常运行时直接重定向离开该
  验收 route。
- 修改 `scripts/mobile-android-screenshots.mjs`。
- 为根开发依赖添加 `pngjs` 并更新 `package-lock.json`，用于读取 ADB 截图像素。

实现要求：

- 从仓库根目录执行 `npm install --save-dev pngjs@^7.0.0`，把 PNG 解析器声明为截图脚本的直接开发
  依赖；不得依赖现有传递依赖。

- 截图验收页从 `APP_ICON_DEFINITIONS` 生成全量矩阵，覆盖 32 个语义键，不手写另一份名称
  列表。
- 使用查询参数或页内分页把矩阵稳定拆成 4 页，每页 8 个图标，确保所有校验盒完整处于首屏；
  页面显示当前页码和总页数，非法页码进入明确错误状态。
- `server`、`sparkles`、`photo`、`chevron-right`、`success`、`warning`、`copy`、
  `magic-wand` 必须包含在矩阵中，但不是唯一验收样本。
- 每个图标放在固定白色、无边框、无文字的独立校验盒中，glyph 使用固定黑色；盒外显示名称，
  避免文字或边框被误判为图标像素。
- 校验盒设置 `accessible` 和 `accessibilityLabel="symbol-check:<name>"`，由 Android 映射为
  `content-desc` 暴露边界，只用于截图模式。
- Android 脚本依次打开 4 个分页并在每页截图后：
  1. 从 UIAutomator XML 获取该页 8 个校验盒的物理像素 bounds；
  2. 用 `pngjs` 读取 PNG；
  3. 只分析盒子内部去掉边缘后的区域；
  4. 统计足够深色且不透明的前景像素；
  5. 任一图标低于固定阈值、任一语义键缺失或重复时退出非零；
  6. 失败时保留 PNG、XML、Metro 日志；
  7. 把全部 32 项的页码、bounds 和前景像素计数写入截图 manifest，便于诊断。
- 阈值只能基于“空盒为 0、正常 glyph 有稳定非零像素”的实测数据设定，不建立整页黄金截图，
  避免字体抗锯齿或系统小版本差异导致无意义基线更新。
- 该检查必须能对空白 glyph 失败，不能只判断 React Native View、testID 或文案存在。

设备验收：

- Android：自动运行验收页，并重新截取 `catalog`、`settings`、`history-list`，确认业务页面和
  NativeTabs 均有图标。
- iOS：在项目最低支持版本的模拟器或真机上逐页检查 4 页全量矩阵，确认 32 个语义键均有
  可见 glyph；然后检查截图中原始三个位置：设置页 `server`、图鉴入口 `sparkles`、图鉴
  卡片按钮 `photo`。
- iOS 还需检查业务页面上的警告、箭头和动态状态图标，防止验收页正确但调用点样式错误。
- Web：以截图模式打开验收 route，确认 fallback 字体完成后再显示页面且控制台无字体错误。
- 如果当前执行环境无法运行 iOS，本任务不得标记完成或创建最终 commit；应在有 iOS 设备的
  环境补齐验收，而不是把“未验证”写成通过。

自动验收命令：

```bash
npm run mobile:screenshots:android -- --only symbol-icons,catalog,history-list,settings
npm run mobile:verify
npm run verify
git diff --check
```

iOS 交互式验收在单独终端执行：

```bash
EXPO_PUBLIC_IMAGEMON_SCREENSHOT_MODE=1 npm run mobile:ios
```

启动完成后打开 `/screenshot-symbol-icons?page=1` 至 `?page=4`，逐页截图并记录设备型号、iOS
版本和结果；再按设备验收列表检查真实业务页面。完成后用 `Ctrl-C` 终止 Expo 进程。该命令是
阻塞式开发服务器，不与后续命令串行粘贴执行。

Web 交互式验收在另一个单独终端执行：

```bash
EXPO_PUBLIC_IMAGEMON_SCREENSHOT_MODE=1 npm run mobile:web -- --port 8082
```

浏览器打开 `/screenshot-symbol-icons?page=1` 至 `?page=4`，确认全部 fallback 可见且控制台无
字体加载错误；完成后用 `Ctrl-C` 终止 Expo 进程。iOS 与 Web 验收结果写入本 commit 的 body，
不把临时截图或导出目录提交进仓库。

建议提交命令：

```bash
git add apps/mobile/app/screenshot-symbol-icons.tsx \
  apps/mobile/app/_layout.tsx \
  scripts/mobile-android-screenshots.mjs \
  package.json package-lock.json
git commit -m "test: 增加移动端图标视觉回归检查"
```

## 严格执行顺序

1. 先提交计划文档。
2. 再添加兼容依赖，保持旧实现暂时可编译。
3. 建立语义目录，但不提前改业务页面。
4. 一次性切换平台组件、字体门禁和 50 个调用点，确保仓库不长期保留双重图标接口。
5. 单独补齐 NativeTabs Android 图标，便于独立回滚导航外观问题。
6. 再加入静态契约和单元测试，锁住导入边界与映射完整性。
7. 最后加入会实际检查 glyph 像素的设备回归验证，并完成 iOS/Android/Web 验收。

任何一步失败都停留在当前步骤修复生产代码。不得跳过当前步骤后在更晚 commit 中“顺手修好”，
否则该 commit 将不再独立可验证和回滚。

## 风险与应对

### `expo-symbols` 仍是 beta

- 固定 Expo 54 兼容版本，不跨 SDK 混装。
- 所有调用隔离在一个 iOS 适配器中；未来 API 变化只修改适配层。
- 升级 Expo 前先查看 `expo-symbols` changelog，并运行本计划新增的设备检查。

### SF Symbol 的系统版本可用性

- 类型存在不代表旧 iOS 一定包含 glyph。
- 在最低支持 iOS 版本验证目录中的实际样本；较新的符号换成旧版本可用的语义近似项。
- 未验证最低系统版本前，不把任务标记完成。

### Ionicons 是字体 fallback

- 根布局必须等待字体加载结果。
- 字体错误必须显式失败，不能渲染空白后继续。
- `@expo/vector-icons` 的使用限制在适配器和 NativeTabs；将来替换不会波及业务页面。

### `@expo/vector-icons` 后续弃用

- 本轮选择它是因为 Expo 54/Expo Go 已包含、现有项目曾使用且 Android/Web 风险最低。
- 当项目升级到支持跨平台 Material Symbols 的新版 Expo 后，用新实现替换默认适配器，
  `AppIconName` 和业务调用点保持不变。
- 在替代实现完成前，不提前删除集中映射或语义键。

### 像素检查的稳定性

- 只检查高对比度校验盒中的“是否存在 glyph 前景像素”，不比较整页截图。
- bounds 来自 UIAutomator，而不是硬编码屏幕坐标。
- 阈值在固定 AVD 上用空盒和正常 glyph 双向校准，并保存计数到 manifest。
- 系统升级后若阈值失败，先检查真实渲染；禁止直接降低阈值或删除样本让测试通过。

### 回滚

- 每个子任务均为独立 commit，优先 `git revert <commit>`，不使用破坏性 reset。
- 回滚平台组件 commit 时，同时回滚语义调用点和旧类型依赖清理，避免半套接口。
- 回滚依赖 commit 前，先确保没有后续适配器仍在 import 对应依赖。
- NativeTabs fallback 可单独回滚，不影响业务 `SymbolIcon`。

## 完成定义

- [ ] `expo-symbols` 和 `@expo/vector-icons` 是移动端直接依赖，版本与 Expo 54 匹配。
- [ ] 普通图片继续由 `expo-image` 渲染，系统图标不再交给 `expo-image`。
- [ ] 业务页面只使用 `AppIconName` 和统一 `SymbolIcon`，没有平台库直连。
- [ ] 50 个现有调用点全部迁移，`SFSymbolName` 和旧 `sf:` URI 实现已删除。
- [ ] `save` 与 `download` 在 Android/Web 使用不同且正确的 fallback。
- [ ] iOS 使用 `SymbolView`，最低支持系统版本上的 32 个语义图标均可见。
- [ ] Android/Web 使用 Ionicons fallback，字体加载受启动门禁保护。
- [ ] NativeTabs 在 iOS 和 Android 都有图标。
- [ ] 非法语义键不会静默空白，开发期有去重告警且运行时有可见缺省图标。
- [ ] 图标目录、尺寸解析、缺省映射和 Tab 定义均有单元测试。
- [ ] `mobile:verify` 包含图标静态契约检查。
- [ ] Android 视觉检查会读取真实 PNG 像素，并能对空白 glyph 退出非零。
- [ ] iOS、Android、Web 均完成计划要求的运行验收。
- [ ] `npm run verify` 通过。
- [ ] `git diff --check` 通过，工作区没有意外生成文件。
- [ ] `git log --oneline` 中能看到以下七个独立 commit，顺序一致：
  - [ ] `docs: 记录移动端跨平台图标修复计划`
  - [ ] `build: 添加移动端跨平台图标依赖`
  - [ ] `feat: 建立移动端语义图标目录`
  - [ ] `fix: 使用平台组件渲染移动端图标`
  - [ ] `fix: 补齐原生标签页平台图标`
  - [ ] `test: 覆盖移动端图标渲染契约`
  - [ ] `test: 增加移动端图标视觉回归检查`

整体设备验收、`npm run verify` 和 commit 顺序核对属于第 6 项子任务的提交前验收，不另设
“无改动、无 commit”的尾项，以满足每个子任务完成时都有明确对应 git commit 的要求。
