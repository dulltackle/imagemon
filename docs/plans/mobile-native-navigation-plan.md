# 移动端原生导航迁移计划

本文档描述 `apps/mobile` 从当前自绘标题和 JS Tabs 迁移到 NativeTabs、嵌套 Stack、自动
inset 和系统标题的可执行方案。目标是先改善导航和安全区基础，不顺手重写配色、卡片样式、
图片组件或深色模式，避免一次性产生难以审阅的大提交。

## 目标

- 使用 `expo-router/unstable-native-tabs` 替换当前 `expo-router` JS Tabs。
- 每个底部标签页拥有自己的 Stack，用系统 header 承载页面标题、返回按钮和顶部安全区。
- 业务页面不再自绘大标题和返回按钮，除非该页面有明确的自定义交互需求。
- 所有 Stack route 的主要滚动容器设置 `contentInsetAdjustmentBehavior="automatic"`。
- 设置页等非滚动根页面改为滚动根页面，以支持小屏、动态字体和底部 tab bar。
- 保留当前 `/`、`/history`、`/settings`、`/promptdex/[name]`、`/images/[id]`、
  `/history/[id]`、`/model-configurations/*` 等公开路径语义。
- 每个子任务完成后单独提交，提交信息使用中文，并在本文档标明对应 commit。

## 非目标

- 不升级 Expo SDK。
- 不迁移到 `expo-image`。
- 不重做深色模式或主题 token。
- 不引入 Link preview、context menu、haptics 或 Reanimated 动画。
- 不修改测试、断言、Mock、Fixture 或测试辅助逻辑来规避失败。
- 不在本轮迁移中重写页面视觉层级、卡片样式或业务文案。

## 当前基线

- 移动端应用路径：`apps/mobile`。
- 当前 Expo 版本：`expo@~54.0.0`。
- 当前 Expo Router 版本：`expo-router@~6.0.24`。
- 当前 tab 布局位于 `apps/mobile/app/(tabs)/_layout.tsx`，使用 JS `Tabs` 和
  `@expo/vector-icons`。
- 根布局 `apps/mobile/app/_layout.tsx` 对整个 root Stack 设置 `headerShown: false`。
- 主要页面在组件内自绘标题和返回按钮，例如图鉴、历史、设置、图片详情、任务详情、
  模型配置和模板提炼。
- 多数 `ScrollView` 缺少 `contentInsetAdjustmentBehavior="automatic"`。
- 本地 `apps/mobile/node_modules/expo-router` 的 NativeTabs 类型是 SDK 54 风格：
  `NativeTabs` 搭配独立导出的 `Icon`、`Label`、`Badge`、`VectorIcon`，不要使用 SDK 55
  文档里的 `NativeTabs.Trigger.Icon` 写法，除非后续升级 SDK 并确认类型变化。

## 目标路由结构

第一阶段使用分组 route 为每个 tab 建立独立 Stack，同时保留公开 URL：

```text
apps/mobile/app/
  _layout.tsx
  first-run.tsx
  (tabs)/
    _layout.tsx                    # NativeTabs
    (catalog)/
      _layout.tsx                  # Stack，标题：图鉴
      index.tsx                    # URL: /
    (history)/
      _layout.tsx                  # Stack，标题：历史
      history.tsx                  # URL: /history
    (settings)/
      _layout.tsx                  # Stack，标题：设置
      settings.tsx                 # URL: /settings
  history/
    [id].tsx
  images/
    [id].tsx
  model-configurations/
    _layout.tsx                    # 后续子任务新增 Stack
    index.tsx
    new.tsx
    [id].tsx
  promptdex/
    refine.tsx
    [name].tsx
```

说明：

- `(catalog)`、`(history)`、`(settings)` 是组织分组，不进入 URL。
- `history.tsx` 和 `settings.tsx` 保留命名文件，避免两个 tab 都只有 `index.tsx` 时让
  `/history`、`/settings` 的意图变弱。
- `model-configurations/_layout.tsx` 单独放到后续提交，降低首个 NativeTabs commit 的路由
  风险。

## 关键实现约束

### NativeTabs API

当前 SDK 54 风格示例：

```tsx
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Icon,
  Label,
  NativeTabs,
  VectorIcon,
} from "expo-router/unstable-native-tabs";

export default function TabsLayout() {
  return (
    <NativeTabs tintColor="#0F766E" minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(catalog)">
        <Icon
          sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }}
          androidSrc={<VectorIcon family={Ionicons} name="grid-outline" />}
        />
        <Label>图鉴</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(history)">
        <Icon
          sf={{ default: "clock", selected: "clock.fill" }}
          androidSrc={<VectorIcon family={Ionicons} name="time-outline" />}
        />
        <Label>历史</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <Icon
          sf={{ default: "gearshape", selected: "gearshape.fill" }}
          androidSrc={<VectorIcon family={Ionicons} name="settings-outline" />}
        />
        <Label>设置</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

如果 TypeScript 报 SF Symbol 名称不在类型集合内，优先换成类型允许的近义系统图标，不退回 JS
Tabs。

### Stack 标题

每个 tab 组新增 `_layout.tsx`，示例：

```tsx
import Stack from "expo-router/stack";

export default function CatalogStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen name="index" options={{ title: "图鉴" }} />
    </Stack>
  );
}
```

重复的 Stack 配置可以沉淀到 `apps/mobile/src/navigation/stack-options.ts`，不要把业务组件或
工具函数放进 `app/` 目录。

### 自动 inset

每个 route 页面主滚动容器应显式设置：

```tsx
<ScrollView
  contentInsetAdjustmentBehavior="automatic"
  contentContainerStyle={styles.content}
  style={styles.screen}
>
```

键盘页面可以暂时保留 `KeyboardAvoidingView` 外层，但内部 `ScrollView` 仍要补
`contentInsetAdjustmentBehavior="automatic"`。如果后续发现系统 header 与键盘 wrapper
冲突，再单独拆迁移，不和 NativeTabs commit 混在一起。

## 可执行子任务与提交边界

### 0. 记录计划文档

Commit 标注：`docs: 记录移动端原生导航计划`

改动范围：

- 新增本文档。

验收：

- 文档明确 NativeTabs、嵌套 Stack、自动 inset 和系统标题的目标。
- 文档列出每个后续子任务对应 commit。

建议命令：

```bash
git add docs/plans/mobile-native-navigation-plan.md
git commit -m "docs: 记录移动端原生导航计划"
```

### 1. 迁移 NativeTabs 与 tab route 壳

Commit 标注：`refactor: 迁移移动端原生标签页`

改动范围：

- 修改 `apps/mobile/app/(tabs)/_layout.tsx`，用 `NativeTabs` 替换 JS `Tabs`。
- 新增 `apps/mobile/app/(tabs)/(catalog)/_layout.tsx`。
- 新增 `apps/mobile/app/(tabs)/(history)/_layout.tsx`。
- 新增 `apps/mobile/app/(tabs)/(settings)/_layout.tsx`。
- 移动路由文件：
  - `apps/mobile/app/(tabs)/index.tsx` -> `apps/mobile/app/(tabs)/(catalog)/index.tsx`
  - `apps/mobile/app/(tabs)/history.tsx` -> `apps/mobile/app/(tabs)/(history)/history.tsx`
  - `apps/mobile/app/(tabs)/settings.tsx` -> `apps/mobile/app/(tabs)/(settings)/settings.tsx`
- 如抽取共享 Stack 配置，新增 `apps/mobile/src/navigation/stack-options.ts`。

不做：

- 不删除页面内自绘标题和返回按钮。
- 不改详情页、模型配置页或模板提炼页。
- 不改业务导航调用。

验收：

- `/`、`/history`、`/settings` 可以分别打开。
- 三个 tab 可切换，且不会出现空白 tab。
- `npm run mobile:typecheck` 通过。

建议命令：

```bash
npm run mobile:typecheck
git add apps/mobile/app
git add apps/mobile/src/navigation 2>/dev/null || true
git commit -m "refactor: 迁移移动端原生标签页"
```

### 2. 迁移 tab 根页面系统标题与自动 inset

Commit 标注：`refactor: 使用系统标题展示标签页`

改动范围：

- `PromptdexCatalogScreen`：
  - 删除页面内 `图鉴` 自绘标题区。
  - 主 `ScrollView` 增加 `contentInsetAdjustmentBehavior="automatic"`。
- `HistoryScreen`：
  - 删除页面内 `历史` 自绘标题区。
  - 主 `ScrollView` 增加 `contentInsetAdjustmentBehavior="automatic"`。
- `SettingsScreen`：
  - 根 `View` 改为 `ScrollView`。
  - 删除页面内 `设置` 自绘标题区。
  - 增加 `contentInsetAdjustmentBehavior="automatic"` 和底部 padding。
- 保留页面卡片、列表、颜色和业务文案。

验收：

- 三个 tab 的标题由系统 header 显示。
- 三个 tab 的首屏内容不被 header 或 tab bar 遮挡。
- 设置页在小屏和大字体下仍可滚动。
- `npm run mobile:typecheck` 通过。

建议命令：

```bash
npm run mobile:typecheck
git add apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx \
  apps/mobile/app/'(tabs)'/'(history)'/history.tsx \
  apps/mobile/app/'(tabs)'/'(settings)'/settings.tsx
git commit -m "refactor: 使用系统标题展示标签页"
```

### 3. 迁移图片、历史与图鉴详情页系统标题

Commit 标注：`refactor: 使用系统标题展示详情页`

改动范围：

- 修改 `apps/mobile/app/_layout.tsx`：
  - root Stack 不再全局 `headerShown: false`。
  - `(tabs)` 单独设置 `headerShown: false`。
  - `history/[id]` 标题设为 `任务详情`。
  - `images/[id]` 标题设为 `图片详情`。
  - `promptdex/[name]` 标题可以先设为 `图鉴条目`，页面内长名称继续展示在内容区或后续用
    `Stack.Screen` 动态设置。
  - `promptdex/refine` 标题设为 `模板提炼`。
- `apps/mobile/app/history/[id].tsx`：
  - 删除自绘返回按钮和 `任务详情` 标题。
  - 主 `ScrollView` 增加 `contentInsetAdjustmentBehavior="automatic"`。
- `apps/mobile/app/images/[id].tsx`：
  - 删除自绘返回按钮和 `图片详情` 标题。
  - 主 `ScrollView` 增加 `contentInsetAdjustmentBehavior="automatic"`。
- `apps/mobile/src/promptdex/PromptdexEntryDetailScreen.tsx`：
  - 删除自绘返回按钮。
  - 避免用超长条目名称替代系统标题；系统标题保持稳定，正文区域可继续显示条目名。
  - 主 `ScrollView` 增加 `contentInsetAdjustmentBehavior="automatic"`。
- `apps/mobile/src/promptdex/TemplateRefinementScreen.tsx`：
  - 删除自绘返回按钮和标题区。
  - 内部 `ScrollView` 增加 `contentInsetAdjustmentBehavior="automatic"`。

不做：

- 不把 `PromptdexEntryDetailScreen` 内部 `Modal` 改成 formSheet；这是下一轮 sheet 任务。
- 不改图片预览组件。

验收：

- 从列表进入详情页时，系统返回按钮可用。
- 详情页内容不被 header 遮挡。
- `promptdex/[name]` 长名称不会挤压系统 header。
- `npm run mobile:typecheck` 通过。

建议命令：

```bash
npm run mobile:typecheck
git add apps/mobile/app/_layout.tsx \
  apps/mobile/app/history/[id].tsx \
  apps/mobile/app/images/[id].tsx \
  apps/mobile/src/promptdex/PromptdexEntryDetailScreen.tsx \
  apps/mobile/src/promptdex/TemplateRefinementScreen.tsx
git commit -m "refactor: 使用系统标题展示详情页"
```

### 4. 迁移模型配置流程到独立 Stack

Commit 标注：`refactor: 使用系统栈管理模型配置`

改动范围：

- 新增 `apps/mobile/app/model-configurations/_layout.tsx`。
- 在该 Stack 中配置：
  - `index` 标题：`模型配置`。
  - `new` 标题：`新建模型配置`。
  - `[id]` 标题：`模型配置详情`。
- 修改 root Stack 中 `model-configurations` 的配置，避免重复 header。
- `apps/mobile/app/model-configurations/index.tsx`：
  - 删除自绘返回按钮和标题。
  - 主 `ScrollView` 增加 `contentInsetAdjustmentBehavior="automatic"`。
- `apps/mobile/src/model-configurations/ModelConfigurationEditor.tsx`：
  - 删除自绘返回按钮和标题。
  - 主 `ScrollView` 增加 `contentInsetAdjustmentBehavior="automatic"`。

验收：

- 从设置页进入模型配置列表，系统返回按钮返回设置页。
- 新建和详情页标题由系统 header 显示。
- 保存、测试、删除、设为默认流程不变。
- `npm run mobile:typecheck` 和 `npm run mobile:test` 通过。

建议命令：

```bash
npm run mobile:typecheck
npm run mobile:test
git add apps/mobile/app/model-configurations \
  apps/mobile/src/model-configurations/ModelConfigurationEditor.tsx \
  apps/mobile/app/_layout.tsx
git commit -m "refactor: 使用系统栈管理模型配置"
```

### 5. 迁移首次设置页标题与 inset

Commit 标注：`refactor: 使用系统标题展示首次设置`

改动范围：

- root Stack 中 `first-run` 标题设为 `首次设置`。
- `apps/mobile/src/first-run/index.tsx`：
  - 删除页面内 `首次设置` 和 `模型配置` 自绘标题区，或只保留必要的说明文案。
  - 内部 `ScrollView` 增加 `contentInsetAdjustmentBehavior="automatic"`。
  - 保持 `KeyboardAvoidingView` 行为不变。

验收：

- 首次启动重定向仍进入 `/first-run`。
- 完成或跳过后仍 `router.replace("/")`。
- 键盘弹出时字段和底部按钮仍可操作。
- `npm run mobile:typecheck` 和 `npm run mobile:test` 通过。

建议命令：

```bash
npm run mobile:typecheck
npm run mobile:test
git add apps/mobile/app/_layout.tsx apps/mobile/src/first-run/index.tsx
git commit -m "refactor: 使用系统标题展示首次设置"
```

### 6. 最终路由与设备冒烟验证

Commit 标注：如无代码变更，不提交；如补充验证脚本或文档，使用
`docs: 补充原生导航验证记录`

验证命令：

```bash
npm run mobile:verify
npm run mobile:start
```

Expo Go 冒烟路径：

- 首次启动未完成设置时，进入 `/first-run`。
- 完成设置后，底部 tab 显示 `图鉴`、`历史`、`设置`。
- `/`、`/history`、`/settings` 可直接访问。
- 图鉴列表进入图鉴条目详情，再返回。
- 图鉴条目执行生成后进入图片详情，再返回。
- 历史列表进入任务详情，再返回。
- 设置页进入模型配置列表、新建、详情，再返回。
- iOS 和 Android 至少各验证一次；如只能验证一个平台，在提交说明中明确未覆盖的平台。

## 风险与回滚

- NativeTabs 是 `unstable-native-tabs`，若遇到平台差异，优先回滚最近一个 commit，而不是在同一
  commit 内回退到 JS Tabs。
- 路由移动可能影响 typed routes。每个路由迁移 commit 后必须运行 `npm run mobile:typecheck`。
- 系统 header 与页面内自绘标题短期可能共存。只允许在迁移壳 commit 中共存；后续系统标题
  commit 必须删除对应自绘标题。
- 如果某个页面因为键盘或 modal 暂时不能完全按“ScrollView 是第一个子节点”改造，应在对应
  commit 说明中记录原因，并保持 `contentInsetAdjustmentBehavior="automatic"` 已设置。

## 完成定义

- `apps/mobile/app/(tabs)/_layout.tsx` 使用 NativeTabs。
- 三个 tab 均有独立 Stack。
- 所有本轮覆盖的 route 标题由 Stack 系统 header 提供。
- 本轮覆盖的主 `ScrollView` 都设置 `contentInsetAdjustmentBehavior="automatic"`。
- 页面内不再保留与系统 header 重复的标题和返回按钮。
- 每个子任务都有独立 git commit，且 commit 内容只包含该子任务列出的文件。
- `npm run mobile:verify` 通过，Expo Go 冒烟路径无阻塞问题。
