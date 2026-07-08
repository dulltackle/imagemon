# 移动端 Tailwind v4 接入方案

本文档描述在 `apps/mobile` Expo 应用中接入 Tailwind CSS v4、NativeWind v5 和
`react-native-css` 的可执行方案。目标是先打通稳定的样式基础设施，再按页面逐步迁移现有
`StyleSheet`，避免一次性重写移动端 UI。

## 目标

- 在 Expo Router 应用中启用 Tailwind CSS v4 的 CSS-first 配置。
- 使用 NativeWind v5 Metro transformer 处理 Tailwind 样式。
- 使用 `react-native-css` 包装 React Native 组件，明确支持 `className`。
- 保留当前 workspace、Metro polyfill、Hermes Babel 降级配置和现有页面行为。
- 提供可验证、可回滚、可分提交执行的迁移路径。

## 当前项目基线

- Expo 应用目录：`apps/mobile`。
- 入口：`apps/mobile/package.json` 的 `main` 为 `expo-router/entry`。
- TypeScript alias：`apps/mobile/tsconfig.json` 中 `@/*` 指向 `./src/*`，因此 Tailwind
  包装组件建议放在 `apps/mobile/src/tw`，业务代码从 `@/tw` 引入。
- 现有 `apps/mobile/metro.config.js` 已做 workspace node_modules 固定解析、`wasm`
  asset 扩展和 `DOMException` polyfill 注入，接入 NativeWind 时必须保留这些逻辑。
- 现有 `apps/mobile/babel.config.js` 不是 NativeWind 配置，而是为 Expo/Hermes 做保守语法降级；
  接入 Tailwind 时不要删除它，也不要新增 `nativewind/babel` preset。
- 当前 UI 大量使用 `StyleSheet.create` 和 `react-native` 原生组件，Tailwind 迁移应渐进进行。
- 仓库使用 npm workspaces 和根 `package-lock.json`；lightningcss 固定版本应使用 npm
  `overrides`，而不是只添加 Yarn 专用的 `resolutions`。

## 非目标

- 不在第一步重写所有页面样式。
- 不为了 Tailwind 接入修改测试、断言、Mock、Fixture 或测试辅助逻辑。
- 不移除现有 Babel/Hermes 兼容配置。
- 不在基础接入阶段强制引入动画体系或替换所有图片组件。
- 不改变移动端业务流程、路由结构、数据存储或模型调用行为。

## 方案选择

采用 Tailwind v4 + NativeWind v5 + `react-native-css`：

- Tailwind v4 使用 `postcss.config.mjs` 和 CSS `@import` / `@theme`，不再需要
  `tailwind.config.js` 作为主配置入口。
- NativeWind v5 只接入 Metro transformer，不接入 Babel preset。
- `react-native-css` 要求组件显式包装后才能消费 `className`，因此不启用全局
  `className` polyfill。
- 迁移期间允许 `className` 与现有 `style` 并存；新页面和低风险组件优先用 `className`。

## 执行顺序

### 1. 安装依赖

在 `apps/mobile` 目录执行 Expo 安装命令，让依赖写入 `@imagemon/mobile`：

```bash
cd apps/mobile
npx expo install tailwindcss@^4 nativewind@5.0.0-preview.2 react-native-css@0.0.0-nightly.5ce6396 @tailwindcss/postcss tailwind-merge clsx
```

如果后续要按 Tailwind 类名迁移图片 `object-cover`、`object-contain` 等能力，再安装图片包装依赖：

```bash
cd apps/mobile
npx expo install expo-image
```

如果后续需要 Tailwind 包装 Reanimated 动画组件，再单独安装：

```bash
cd apps/mobile
npx expo install react-native-reanimated
```

根 `package.json` 增加 lightningcss 固定版本。因为当前仓库使用 npm，应使用：

```json
{
  "overrides": {
    "lightningcss": "1.30.1"
  }
}
```

如果未来切换到 Yarn，再补充等价的 `resolutions`。

### 2. 接入 Metro transformer

修改 `apps/mobile/metro.config.js`，保留现有 workspace 解析、polyfill 和 asset 配置，只在导出时包一层
`withNativewind`：

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// 保留当前 workspaceRoot、nodeModulesPaths、extraNodeModules、wasm、DOMException polyfill 等配置。

module.exports = withNativewind(config, {
  inlineVariables: false,
  globalClassNamePolyfill: false,
});
```

关键要求：

- 不删除 `config.resolver.disableHierarchicalLookup = true`。
- 不删除 `config.resolver.nodeModulesPaths` 和 `extraNodeModules`。
- 不删除 `config.serializer.getPolyfills` 中的 `DOMException` polyfill 注入。
- `inlineVariables` 必须为 `false`，否则平台颜色变量后续会受影响。
- `globalClassNamePolyfill` 必须为 `false`，因为本项目采用显式包装组件。

### 3. 添加 PostCSS 配置

新增 `apps/mobile/postcss.config.mjs`：

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

不需要安装或配置 `autoprefixer`；Expo 使用 lightningcss。

### 4. 添加全局 CSS

新增 `apps/mobile/src/global.css`：

```css
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/preflight.css" layer(base);
@import "tailwindcss/utilities.css";

@media android {
  :root {
    --font-mono: monospace;
    --font-rounded: normal;
    --font-serif: serif;
    --font-sans: normal;
  }
}

@media ios {
  :root {
    --font-mono: ui-monospace;
    --font-serif: ui-serif;
    --font-sans: system-ui;
    --font-rounded: ui-rounded;
  }
}
```

后续如果要沉淀应用主题色，可以在同一文件中通过 `@layer theme { @theme { ... } }`
注册 `--color-*`、`--text-*--line-height` 等 Tailwind v4 变量。

### 5. 在应用入口导入全局 CSS

在 `apps/mobile/app/_layout.tsx` 顶部添加：

```tsx
import "../src/global.css";
```

该导入应放在其他本地业务导入之前，保证路由加载时全局 CSS 已注册。

### 6. 保留 Babel 配置

保留 `apps/mobile/babel.config.js` 当前内容。不要新增以下 NativeWind 旧配置：

```js
"nativewind/babel"
```

也不要把 `babel-preset-expo` 改成 `["babel-preset-expo", { jsxImportSource: "nativewind" }]`。

当前 Babel 文件里的 Hermes 降级说明仍然有效，Tailwind v4 / NativeWind v5 不依赖 Babel preset。

### 7. 新增 CSS 组件包装

新增目录：

```text
apps/mobile/src/tw/
```

基础文件 `apps/mobile/src/tw/index.tsx` 至少导出当前项目高频使用的组件：

- `View`
- `Text`
- `ScrollView`
- `Pressable`
- `TextInput`
- `Link`
- `useCSSVariable`

包装实现使用 `react-native-css` 的 `useCssElement`，并把 `className` 映射到 `style`，把
`contentContainerClassName` 映射到 `contentContainerStyle`。

图片迁移有两种选择：

- 第一阶段保留 `react-native` 的 `Image` + `StyleSheet`，不迁移图片相关样式。
- 需要 Tailwind 的 `object-cover`、`object-contain`、`object-position` 时，新增
  `apps/mobile/src/tw/image.tsx`，用 `expo-image` 包装并把 `objectFit` / `objectPosition`
  映射到 `contentFit` / `contentPosition`。

动画迁移只有在安装 `react-native-reanimated` 后再新增 `apps/mobile/src/tw/animated.tsx`。

### 8. 低风险冒烟迁移

先选择一个低风险页面或共享组件验证链路，不要直接迁移复杂页面。建议优先级：

1. `apps/mobile/src/shared/PlaceholderScreen.tsx`
2. `apps/mobile/app/(tabs)/settings.tsx`
3. `apps/mobile/app/_layout.tsx` 中的 `StateScreen`

冒烟迁移要求：

- 只把该文件的 `View` / `Text` / `Pressable` 改为从 `@/tw` 引入。
- 使用少量稳定类名，例如 `flex-1`、`items-center`、`justify-center`、`bg-slate-50`、
  `text-slate-900`、`text-base`。
- 复杂动态样式、禁用态、平台差异和图片样式暂时保留 `StyleSheet`。
- 冒烟页面在 Web、iOS 或 Android 至少一个运行环境中确认 Tailwind 类名生效。

### 9. 分批迁移页面

冒烟通过后按页面分批迁移：

1. 静态简单页面：设置页、占位页、启动状态页。
2. 表单页面：首次运行、模型配置编辑页。
3. 列表页面：历史、图鉴首页。
4. 复杂详情页：图鉴详情、历史详情、图片详情。

每批迁移原则：

- 每次只迁移一个页面或一个共享组件。
- 保留业务逻辑不动，只改组件来源和样式表达。
- 对动态样式先用 `clsx` 组合类名；冲突类名需要合并时再引入 `tailwind-merge`。
- 对平台专用样式，优先继续使用 `StyleSheet`，确认 Tailwind 媒体查询方案稳定后再收敛。
- 不为了迁移样式改测试文件；测试失败时只修生产代码。

## 建议提交边界

### Commit 01：接入 Tailwind 基础设施

范围：

- `package.json`
- `package-lock.json`
- `apps/mobile/package.json`
- `apps/mobile/metro.config.js`
- `apps/mobile/postcss.config.mjs`
- `apps/mobile/src/global.css`
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/src/tw/index.tsx`

验证：

```bash
npm run mobile:typecheck
npm run mobile:test
```

提交消息：

```bash
git commit -m "feat: 接入移动端 Tailwind 基础设施"
```

### Commit 02：完成一个冒烟页面迁移

范围：

- `apps/mobile/src/shared/PlaceholderScreen.tsx` 或另一个低风险文件。

验证：

```bash
npm run mobile:typecheck
npm run mobile:test
npm run mobile:web
```

提交消息：

```bash
git commit -m "feat: 用 Tailwind 迁移移动端冒烟页面"
```

### Commit 03 以后：按页面继续迁移

每个提交只包含一个页面或一组高度相关的共享组件，并在提交前运行：

```bash
npm run mobile:typecheck
npm run mobile:test
```

复杂页面额外做手工验收：

```bash
npm run mobile:web
```

必要时再运行：

```bash
npm run mobile:ios
npm run mobile:android
```

## 验证清单

基础设施验证：

- `npm run mobile:typecheck` 通过。
- `npm run mobile:test` 通过。
- `npm run mobile:web` 能启动并渲染冒烟页面。
- Metro 启动日志中没有 `nativewind/metro`、PostCSS 或 CSS import 报错。
- `apps/mobile/app/_layout.tsx` 导入 `../src/global.css` 后没有模块解析错误。

样式验证：

- 冒烟页面的背景色、布局、字号和文本颜色确实来自 Tailwind 类名。
- 使用未包装的 `react-native` 组件时，`className` 不应被期待生效。
- `ScrollView` 的内容容器样式通过 `contentContainerClassName` 生效。
- 混用 `className` 和 `style` 时，关键动态样式仍然符合预期。

平台验证：

- Web 至少完成一次冒烟。
- iOS 或 Android 至少完成一次真机、模拟器或 Expo Go 冒烟。
- 如果修改了图片包装，必须验证本地文件 URI 图片和网络 URI 图片都能显示。
- 如果引入 `platformColor()` 或系统颜色变量，必须验证 iOS 与 Web fallback。

缓存处理：

```bash
cd apps/mobile
npx expo start -c
```

当 Tailwind 类名没有更新、PostCSS 配置刚新增、Metro 配置刚修改时，优先清 Metro 缓存再判断问题。

## 回滚方案

如果基础设施接入后阻塞启动，可按以下顺序回滚：

1. 从 `apps/mobile/app/_layout.tsx` 删除 `../src/global.css` 导入。
2. 将 `apps/mobile/metro.config.js` 的导出恢复为 `module.exports = config`。
3. 暂停使用 `@/tw` 包装组件，把冒烟页面改回 `react-native` 原生组件和 `StyleSheet`。
4. 移除 `apps/mobile/postcss.config.mjs`、`apps/mobile/src/global.css`、`apps/mobile/src/tw`。
5. 依赖层回滚 `apps/mobile/package.json`、根 `package.json` 和 `package-lock.json`。

回滚不应修改测试文件。

## 主要风险与处理

- NativeWind v5 当前是 preview 版本：先做低风险冒烟，不一次性迁移全站。
- `react-native-css` 只对包装组件生效：业务代码必须从 `@/tw` 引入组件，不能直接给
  `react-native` 组件加 `className`。
- 现有 Metro 配置承担 workspace 解析职责：接入 `withNativewind` 时必须包裹现有 config，
  不能重写成全新模板。
- npm 不消费 Yarn `resolutions`：当前仓库固定 lightningcss 应使用 `overrides`。
- 图片样式语义与 React Native `Image` 不完全一致：图片 Tailwind 化应作为单独提交处理。
- 动态状态样式容易膨胀：优先用小函数或 `clsx` 组合类名，不把复杂业务判断塞进长字符串。
