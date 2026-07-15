# 图鉴首页滚动与条目按压反馈修复方案（2026-07-14）

- **来源**：图鉴首页上下滑动时，手指落在条目上会频繁出现条目被“激活”的视觉反馈，干扰连续浏览。
- **基线**：`watercolor-style` @ `cd7db6de`。
- **状态**：图鉴已实施并由开发者确认 iOS 真机问题消失；历史与设置已接入同一修复，完整跨端与业务/可访问性验收待完成。
- **修复结论**：保留整卡点击与真实按压反馈，在公共 `Pressable` 桥接层提供跨端一致的按压反馈延迟，由图鉴首页所有可作为滚动起点的按压区域显式启用 `100ms`；Web 额外由延迟后的 RNW `pressed` 状态驱动视觉反馈，避免浏览器 CSS `:active` 绕过延迟。
- **原预计成本**：生产代码与单测约 0.5 天；Android 手势回归检查与跨端验收约 0.5 天；iOS 需在 macOS 模拟器或真机补验。
- **测试纪律**：只新增覆盖新语义的测试和检查，不修改既有测试、断言、Mock、Fixture、截图阈值或测试辅助行为来规避失败。

---

## 实施结果（2026-07-14）

### 独立提交

| 子任务 | 提交 |
| --- | --- |
| 新增跨端延迟属性映射与单测 | `faa6d88 fix: 新增跨端按压延迟映射` |
| 扩展公共 Pressable / Surface 桥接 | `d0cb31e fix: 扩展按压反馈延迟桥接能力` |
| 图鉴首页五类滚动起点接入 `100ms` | `2c2534 fix: 延迟图鉴滚动区域按压反馈` |
| 阻止 Web CSS `:active` 立即闪现 | `76bf43d fix: 阻止 Web 滚动闪现按压态` |
| 统一 Web 鼠标与真实触摸的延迟反馈 | `5223481 fix: 统一 Web 触摸按压反馈` |

### 后续真机反馈（2026-07-14）

- `f4867c9 fix: 延迟历史列表按压反馈`：抽取共享滚动反馈策略，并接入历史记录整卡。
- `ef00319 fix: 延迟设置卡片按压反馈`：接入设置页两张导航整卡。
- 开发者在 iOS 真机确认“图鉴”Tab 的滚动误显 pressed 问题已经消失。
- 同次真机检查发现“历史”Tab 的历史记录整卡，以及“设置”Tab 的“模型配置”“应用默认规格”整卡存在相同问题；三处继续显式使用现有 `pressFeedbackDelayMs` 能力。
- 原图鉴文件内的局部常量已提升为 `apps/mobile/src/ui/scroll-press-feedback.ts` 中唯一的 `SCROLL_PRESS_FEEDBACK_DELAY_MS`，图鉴、历史、设置共同使用；没有给 `Surface`、`ScreenScrollView` 或底部原生 Tab 触发器设置全局默认延迟。

### 已完成验证

- 基线 `mobile:verify` 为 `44` 个测试文件、`336` 项测试；实施后为 `47` 个测试文件、`352` 项测试，新增的 `16` 项测试全部用于平台属性、Web 过渡延迟和 Web `active:` 类接管语义，没有修改既有测试、Mock 或 Fixture。
- Android 13 / API 33 模拟器（`1080×2400`、`420dpi`）完成修复前后 A/B 录屏；A/B 基线使用 `045be2e`，它相对顶部记录的生产基线只新增本文档。基线快滑能看到卡片短暂变色，修复候选同类快滑未见变色；模拟器录屏为可变帧率，只作为定性证据，精确 `70ms` 边界由 Web 实际时钟采样承担。
- Android fixture 可见对象的快速上滑共 `30/30`、快速下滑共 `30/30` 均滚动且未导航；模板入口与代表图按钮双向快滑共 `20/20` 通过。卡片短按与静止按住各 `5/5`、代表图按钮与模板入口点击各 `5/5` 均进入正确目的地且一次返回回到首页。最新提交重新加载后又完成一次 `80ms` 快滑和一次条目点击回归。
- Chromium 在 `390×844` 与 `768×900` 两种视口完成 CDP 触摸输入采样（非真机）：卡片、代表图按钮、模板入口在实际约 `70ms` 保持基线，约 `260ms` 显示 pressed，释放后约 `350ms` 恢复。fixture 可见的卡片、代表图按钮、未生成卡片双向快滑及模板入口上滑均产生实际 `scrollTop` 位移、背景保持基线且 URL 留在 `/`。
- Web 慢按后拖在两种视口均先显示反馈，随后滚动 `124.8px`，约 `351–352ms` 恢复且不导航；短触、长触、鼠标点击、Enter、Space、代表图按钮和模板入口均只新增一条 history 记录。
- Web DOM 嵌套 button 为 `0`，`pressFeedbackDelayMs` / `pressFeedbackStyle` 泄漏属性为 `0`，相关 console warning / error 为 `0`。

### 外部待验

- 当前 Linux 环境没有 `xcrun`，未执行 iOS Simulator 或真机验收。
- 当前没有真实 Android / iOS 触屏设备；Android 的“静止超过 `100ms` 后再拖动”仍需真手指复核，现有 ADB 工具不能可靠表达该分段手势。
- screenshot fixture 没有“其他图片”，未修改 Fixture 迎合验收；该区域仍需使用包含真实数据的设备检查。
- disabled Surface 的独立手势、完整 accessibility 语义及各平台 `44×44pt` 命中区仍需在外部完整矩阵中复核；本轮只确认 Web 代表图按钮为 `44×44`、DOM 无嵌套 button，Android 静态布局未回归。
- Android 录屏的帧率与时间戳不足以独立证明精确 `70ms` 边界，因此不把模拟器录屏写成精确时序通过。

---

## 一、问题定义与已确认根因

### 1.1 这里的“激活”不是业务状态

本问题中的“激活状态”是卡片的 **pressed 视觉态**，对应 CSS 类 `active:bg-*`；它与首页上的“进行中”“待查看”等业务徽标无关。业务徽标继续由模型调用锁与 attention 数据决定，本修复不得改变这些数据或展示条件。

涉及的当前代码：

- `apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx:387`：已生成条目使用整卡 `Surface variant="interactive"`；
- `apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx:443`：代表图详情是整卡之外的独立 Pressable；
- `apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx:483`：未生成条目使用相同交互 Surface；
- `apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx:554`：其他图片同样是交互 Surface；
- `apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx:631`：模板提炼入口是可点击的 brand Surface；
- `apps/mobile/src/ui/Surface.tsx:56`：交互 Surface 带 `active:bg-app-action-soft` 和 `150ms` 颜色过渡；
- `apps/mobile/src/ui/ScreenCanvas.tsx:46`：首页内容位于公共滚动容器内。

### 1.2 实际事件链

当前事件顺序如下：

1. 手指在整卡范围内落下；
2. React Native `Pressable` 默认没有 press-in 延迟，立即发出 `onPressIn`；
3. 原生端的 `active:` 由 Pressability 状态驱动；Web 端则会把 `active:` 编译为浏览器 CSS `:active`，pointer down 后立即匹配；
4. 手指继续移动后，`ScrollView` 才识别纵向 pan 并终止子级 press；Web 的 CSS `:active` 还会独立于 RNW 的 press-in 延迟生效；
5. press 虽被取消且不会导航，但原生最短反馈时间与现有 `150ms` 颜色过渡令这次短暂变色仍清晰可见。

诊断时已在 Android 13 模拟器用触摸输入、在 Web 移动视口用 pointer 按下复现“按下后、滚动判定前先变色”。完整纵向触摸滑动能够滚动并留在首页，说明主要故障是 **滚动意图被错误显示成按压意图**，而不是业务状态被写错。

`f177a62` 将已生成条目恢复为整卡命中，扩大了手指落在 Pressable 上的概率，因此放大了问题；但整卡命中本身符合现有保真台账与可访问性要求，不能通过回退该提交修复。

### 1.3 必须区分的两个边界

- **已被 ScrollView 识别的滑动**：不得变为 pressed、不得导航，列表必须滚动。这是本次必须修复的行为。
- **位移仍小于平台 touch slop 的手势**：平台会把它视为 tap，仍可能导航。不能承诺“只要有任何像素位移就绝不点击”；若产品要求自定义位移阈值，应进入第九节的手势识别升级方案。

---

## 二、目标、约束与非目标

### 2.1 目标

1. 快速向上或向下滑动时，条目不出现错误 pressed 背景、不导航、不残留反馈。
2. 正常 tap 仍只导航一次；静止按住仍能看到明确的 pressed 反馈。
3. 已生成条目继续整卡可点，代表图详情按钮继续作为独立同级按钮工作。
4. Android、iOS、Web 触屏语义一致；Web 鼠标与键盘 Enter/Space 不退化。
5. “进行中”“待查看”等真实业务状态完全不受影响。

### 2.2 必须守住的既有合同

- `docs/design/mobile-watercolor/design-contract.md:81`：真实触控区至少 `44×44pt`；
- `docs/design/mobile-watercolor/design-contract.md:84`：交互表面由共享 `Surface` 提供；
- `docs/design/mobile-watercolor/design-contract.md:117`：保留 `120–180ms` 的 pressed 反馈时长；
- `docs/design/mobile-watercolor/fidelity-ledger.md:78`：已生成条目整卡可点，代表图按钮是独立同级按钮，Web 不得产生嵌套 button；
- `apps/mobile/src/tw` 继续只承担 React Native 元素与 CSS 的桥接，不在业务页直接分叉原生/Web 底层属性。

### 2.3 非目标

- 不改变路由、图鉴数据、模型调用锁、attention、存储或 Fixture；
- 不缩小整卡点击区，不移除代表图按钮，不回退 `f177a62`；
- 不给 `AppButton` 或全应用所有 Pressable 强加延迟；
- 不改配色、卡片布局、水彩资产或 `150ms` 颜色过渡；
- 不引入 RNTL、Detox、Maestro 或新的手势库来完成首轮修复；
- 不修改版本号，不创建发布标签或 GitHub Release。

---

## 三、方案决策

### 3.1 采用显式的 `100ms` press-in 延迟

在公共 Pressable 包装层定义稳定的应用 API `pressFeedbackDelayMs`，内部按运行平台映射：

| 运行平台 | 底层属性 | 当前依赖实际读取方式 |
| --- | --- | --- |
| Android / iOS | `unstable_pressDelay` | React Native `0.81.5` 将其传给 Pressability 的 `delayPressIn` |
| Web | `delayPressIn` | React Native Web `0.21.2` 的 Pressable 直接读取该属性 |

不能只传 `unstable_pressDelay={100}`：它在原生端有效，但当前 React Native Web 不读取该名称，Web 会继续立即进入 active。

选择 `100ms` 的依据：

- 足以让常见快速滑动在反馈出现前被 ScrollView 识别并取消；
- 不超过 `150ms`，避免正常长按显得迟钝；
- 保留现有颜色过渡，反馈一旦成立仍符合设计合同；
- 首轮验收允许在 `80–120ms` 范围内依据实机结果调整，但默认值和合入候选值均为 `100ms`。任何调整必须同时更新常量、单测和本文，不得散落 magic number。

预期事件链变为：

```text
手指落下
  ├─ 100ms 内形成纵向滑动 → ScrollView 终止 press → pending onPressIn 被取消
  └─ 静止达到 100ms       → onPressIn → 显示真实 pressed 反馈
```

延迟的是 `onPressIn` 及其视觉反馈，不是最终 `onPress`。短按在抬起时仍正常导航；键盘激活路径也不等待触摸延迟。

实施中确认了一个 Web 专属边界：RNW 的 `delayPressIn` 只延迟 JavaScript `pressed` 状态，无法延迟浏览器原生 CSS `:active`。因此 Web 且显式启用延迟时还会：

1. 从基础 `className` 移除由延迟逻辑接管的顶层 `active:*` 类，阻止 pointer down 立即变色；
2. 给基础颜色过渡设置同值 `transitionDelay`，避免鼠标路径提前开始过渡；
3. 在 RNW 延迟后的 `pressed` 为 `true` 时应用显式 `pressFeedbackStyle`，并把进入 pressed 的过渡延迟重置为 `0ms`；
4. 释放或滚动取消后清除 `pressed` 样式，保留原有 `150ms` 退场过渡并在 `350ms` 合同内恢复。

原生仍保留原来的 `active:*` 类与 `unstable_pressDelay`，不走 Web 专属视觉桥接。

### 3.2 采用“公共能力 + 首页显式启用”，不设全局默认

公共层只提供可选能力，默认 `undefined` 时完全保持旧行为。首页显式传入 `100ms`，原因是：

- 问题只发生在可滚动内容中的大面积按压区；
- 普通独立按钮需要即时反馈，不应受到连带影响；
- 将范围写在调用点，后续审查其他滚动列表时可以逐页决定，而不是静默改变全应用交互。

图鉴首页须一次覆盖所有可作为滑动起点的按压区域，不能只修已生成条目：

1. 已生成条目整卡；
2. 已生成条目的代表图详情按钮；
3. 未生成条目整卡；
4. 其他图片整卡；
5. 模板提炼 brand 入口。

---

## 四、生产代码改动

### 4.1 新增纯平台映射模块与单测

新增：

- `apps/mobile/src/tw/press-feedback.ts`
- `apps/mobile/src/tw/press-feedback.test.ts`

建议接口：

```ts
export interface PressFeedbackDelayProps {
  delayPressIn?: number;
  unstable_pressDelay?: number;
}

export function getPressFeedbackDelayProps(
  runtimeOS: string | undefined,
  delayMs: number | undefined,
): PressFeedbackDelayProps {
  if (delayMs === undefined) {
    return {};
  }

  return runtimeOS === "web"
    ? { delayPressIn: delayMs }
    : { unstable_pressDelay: delayMs };
}
```

单测必须覆盖：

1. 未传延迟时返回空对象；
2. Web 的 `100` 只生成 `delayPressIn`；
3. Android 和 iOS 的 `100` 只生成 `unstable_pressDelay`；
4. `0` 不会被错误地按 falsy 值吞掉；
5. 返回对象不同时包含两套底层属性。

这个测试只证明平台映射，不声称模拟了 ScrollView 与 Pressability 的 responder 竞争。

### 4.2 扩展公共 `Pressable` 桥接层

修改 `apps/mobile/src/tw/index.tsx:103`：

```tsx
export type PressableProps = ComponentProps<typeof RNPressable> & {
  className?: string;
  pressFeedbackDelayMs?: number;
  pressFeedbackStyle?: ComponentProps<typeof RNPressable>["style"];
};
```

包装组件内必须：

1. 从 `props` 解构并消费 `pressFeedbackDelayMs` 与 `pressFeedbackStyle`；
2. 调用 `getPressFeedbackDelayProps(process.env.EXPO_OS, pressFeedbackDelayMs)`；
3. 将结果传给底层 RN/RNW Pressable；
4. 不把自定义属性继续透传给原生 View 或 Web DOM；
5. 仅在 RN 与 RNW 类型边界处做最小类型收窄/断言，不在业务层使用 `as any`。

`className -> style` 的 `useCssElement` 映射继续保留。原生仍使用现有 `active:` 类；Web 且显式启用延迟时，公共层移除浏览器会立即匹配的 `active:*`，并由内部 RNW Pressable 的 `state.pressed` 条件应用显式 `pressFeedbackStyle`。该状态留在公共桥接组件内，不在业务页面维护。

### 4.3 扩展 `Surface` 的交互分支

修改 `apps/mobile/src/ui/Surface.tsx`：

- `InteractiveSurfaceProps` 增加 `pressFeedbackDelayMs?: number`；
- `InteractiveBrandSurfaceProps` 增加同一可选属性；
- 两个交互分支解构后传给公共 `<Pressable>`；
- 静态 panel、静态 brand、feedback、fieldGroup 的类型与渲染不变；
- `disabled`、accessibility role/state、`onPress` 与边框曲线不变；
- 保留 `active:bg-app-action-soft`、brand 的 `active:bg-app-surface-raised` 以及 `duration-150`。
- interactive 与 brand 分支分别提供等价的 Web `pressFeedbackStyle`，确保 Web 延迟路径完整复刻原生 active 背景。

不要在 `Surface` 内设置 `100ms` 默认值。它只是共享能力，是否位于滚动容器由业务调用点决定。

### 4.4 图鉴首页接入

初次实施在 `apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx` 使用文件级常量。后续 iOS 真机反馈证明该策略还适用于历史与设置 Tab，因此将唯一常量提升到 `apps/mobile/src/ui/scroll-press-feedback.ts`：

```ts
export const SCROLL_PRESS_FEEDBACK_DELAY_MS = 100;
```

图鉴第三节列出的五类交互区域、历史记录整卡和设置页两张导航整卡均显式传入：

```tsx
pressFeedbackDelayMs={SCROLL_PRESS_FEEDBACK_DELAY_MS}
```

特别注意：

- 代表图按钮是 Surface 外的独立 `Pressable`，必须单独传入；
- 不把图片按钮移回整卡内部，避免 Web 嵌套 button；
- 不将延迟传给页面内的非交互 Surface；
- 不用 `onScrollBeginDrag` / `onMomentumScroll*` 建立页面级 `isScrolling` state。

---

## 五、Android 可重复手势验收

静态截图无法证明瞬态 press/scroll 竞争已修复。本轮不在截图脚本内拼装 `DOWN/MOVE/UP`：Android 的多次 `input motionevent` 命令不会可靠共享同一个 `downTime`，可能生成无效触摸流并导致假通过。使用单次 `input touchscreen swipe ... <duration>` 保持一条连续手势，配合系统触点标记和录屏逐帧复核。

### 5.1 准备确定性页面

```bash
command -v adb >/dev/null 2>&1
command -v ffmpeg >/dev/null 2>&1

IMAGEMON_ANDROID_KEEP_EMULATOR=1 \
IMAGEMON_ANDROID_SCREENSHOT_DIR=/tmp/imagemon-catalog-press-feedback \
npm run mobile:screenshots:android -- --only catalog

adb devices
export DEVICE='<上一步列出的 emulator serial>'
```

通过 accessibility label 获取卡片 bounds，禁止把某一台模拟器的坐标写入方案或生产代码：

```bash
adb -s "$DEVICE" shell uiautomator dump /sdcard/catalog.xml
adb -s "$DEVICE" pull /sdcard/catalog.xml \
  /tmp/imagemon-catalog-press-feedback/catalog.xml
rg '打开图鉴条目 light-infographic' \
  /tmp/imagemon-catalog-press-feedback/catalog.xml
```

从输出的 `bounds="[left,top][right,bottom]"` 选择不与代表图按钮重叠的卡片内部点，设为 `X` / `Y`。再记录并开启触点标记；验收结束必须恢复原值：

```bash
export X='<卡片内部 x>'
export Y='<卡片内部 y>'
export SHOW_TOUCHES_BEFORE="$(adb -s "$DEVICE" shell settings get system show_touches | tr -d '\r')"
export DENSITY_DPI="$(adb -s "$DEVICE" shell wm density | tail -n 1 | awk '{print $NF}')"
export SWIPE_DISTANCE_PX="$((240 * DENSITY_DPI / 160))"
export UP_END_Y="$((Y - SWIPE_DISTANCE_PX))"
export DOWN_END_Y="$((Y + SWIPE_DISTANCE_PX))"
adb -s "$DEVICE" shell settings put system show_touches 1
```

### 5.2 快速滑动录屏

先启动录屏，再用一个异步 swipe 命令生成连续触摸流。坐标终点须保证最终位移至少 `80dp`；物理像素换算以 `adb shell wm density` 为准。

```bash
adb -s "$DEVICE" shell screenrecord \
  --bit-rate 20000000 \
  --time-limit 6 \
  /sdcard/catalog-fast-swipe.mp4 &
sleep 1

adb -s "$DEVICE" shell input touchscreen swipe \
  "$X" "$Y" "$X" "$UP_END_Y" 250

wait
adb -s "$DEVICE" pull /sdcard/catalog-fast-swipe.mp4 \
  /tmp/imagemon-catalog-press-feedback/catalog-fast-swipe.mp4

mkdir -p /tmp/imagemon-catalog-press-feedback/fast-swipe-frames
ffmpeg -y \
  -i /tmp/imagemon-catalog-press-feedback/catalog-fast-swipe.mp4 \
  -vf fps=30 \
  /tmp/imagemon-catalog-press-feedback/fast-swipe-frames/%04d.png
```

以触点圆第一次出现的帧为 touch-down：

- 从该帧到接下来的 `100ms` 内，卡片背景不得出现 pressed 色；
- 内容最终位移至少 `80dp`，页面仍为首页；
- 整段视频不得出现 pressed 残留或详情页跳转；
- 视频有 H.264 压缩，若做像素比较，应比较 ROI 中位色并使用 RGB 容差，不能要求逐像素完全相等。

`30fps` 的时间分辨率约为 `33ms/帧`：记录触点首次出现的帧号，以其后第 2 帧作为约 `66ms` 检查点、第 8 帧附近作为约 `260ms` 检查点，并允许至多一帧采样误差；若掉帧令时序无法判断，该轮作废，不能据此声称精确验证了 `70ms`。

向下滑动把命令终点换为 `"$DOWN_END_Y"`。它不能在列表顶部执行，否则边界会把位移夹为 `0` 并造成假失败。每轮向下滑之前先把列表滚到中间位置；每轮结束后重新进入首页、恢复目标滚动位置并重新读取 bounds，不能复用已经移动的坐标。`UP_END_Y` / `DOWN_END_Y` 还必须位于屏幕边界内，否则重新选择 `Y`。

### 5.3 静止按住与点击

用起终点相同的单次 swipe 生成静止按住；录屏方式同上：

```bash
adb -s "$DEVICE" shell input touchscreen swipe \
  "$X" "$Y" "$X" "$Y" 600
```

逐帧检查：

- touch-down 后 `70ms` 内仍是正常背景；
- 约 `100ms` 后开始进入颜色过渡；
- `260ms` 时 pressed 清晰可见，证明真实反馈没有被删除；
- 抬起后只导航一次，一个返回动作回到首页。

`input swipe` 不能表达“先静止超过 `100ms` 再拖动”的分段手势，这一项必须用真实手指补验，不能用多条 `motionevent` 命令伪造。

### 5.4 重复、清理与证据

- 已生成卡片图片区、文字区和未生成卡片分别执行快速上滑、快速下滑各 `10` 次，结果必须是 `0/10` 错误 pressed、`0/10` 导航；
- 短按、静止按住后抬起各 `5` 次，必须 `5/5` 正确且只导航一次；
- 代表图按钮单独验证目的地，不得触发外层条目；
- 模板提炼入口执行相同的真实触屏抽验；
- 当前 screenshot fixture 没有“其他图片”，因此不修改 Fixture 来迎合本检查；该区域使用真实数据人工验收，并在结果中明确记录；
- 录屏、拆帧、UI dump、设备与系统版本保存在临时目录或 PR 证据中，不提交仓库。

最后恢复系统设置并关闭脚本启动的模拟器：

```bash
case "$SHOW_TOUCHES_BEFORE" in
  null|'') adb -s "$DEVICE" shell settings delete system show_touches ;;
  *) adb -s "$DEVICE" shell settings put system show_touches \
       "$SHOW_TOUCHES_BEFORE" ;;
esac

case "$DEVICE" in
  emulator-*) adb -s "$DEVICE" emu kill ;;
esac
```

如果录屏帧率不足、触点圆不可辨认或坐标未产生真实滚动，该轮只能记为“无效”，不得记为通过。首轮实施时先在修复前基线上执行一次，确认该方法确实能捕获现有误按压；不能捕获基线故障的方法不得成为合入证据。

---

## 六、统一验收合同

### 6.1 手势行为

| 场景 | 手势参数 | 预期 |
| --- | --- | --- |
| 快速滑动 | `40ms` 内开始移动，`100ms` 前 ≥`24dp`，最终 ≥`80dp` | 从未出现整卡 pressed；列表滚动；不导航 |
| 静止按住 | 位移 `<3dp` | `70ms` 未 pressed；约 `100ms` 开始过渡；`260ms` 时 pressed 清晰可见 |
| 短按 | 约 `60ms` 后原位抬起 | 正确导航一次 |
| 长按后抬起 | 约 `140ms` 后原位抬起 | 正确导航一次 |
| 慢按后再拖 | 静止超过 `100ms` 后开始拖动 | 允许先 pressed；滚动后 `350ms` 内清除；不导航 |
| 代表图按钮 | 点击“打开代表图详情” | 只进入图片详情，不触发外层导航 |
| 平台阈值内微移 | 总位移小于 touch slop | 可按平台 tap 语义导航，不作为失败 |

### 6.2 覆盖对象与重复次数

快速向上、快速向下分别覆盖：

- 已生成卡片图片区；
- 已生成卡片文字区；
- 未生成卡片；
- 其他图片；
- 模板提炼入口；
- 代表图按钮区域。

Android 对确定性 fixture 可覆盖的已生成卡片图片区、文字区和未生成卡片各连续执行 `10` 次快滑，必须 `0/10` 错误 pressed、`0/10` 导航；模板提炼、代表图按钮和真实数据下的“其他图片”各至少执行 `5` 次。iOS 对上述可见对象各至少执行 `5` 次快滑；短按与静止按住后抬起各执行 `5` 次，必须全部正确且只导航一次。Web 至少对手机与宽屏横向卡片布局各执行一轮同样的行为检查。

### 6.3 业务与可访问性

- “进行中”“待查看”等徽标内容、颜色和出现条件不变；
- disabled Surface 不进入 pressed、不触发导航；
- Web DOM 中仍无嵌套 button；
- 鼠标单击、Enter、Space 均只激活一次；
- accessibility label、role 与 state 不变；
- 触控区继续至少 `44×44pt`。

---

## 七、跨端执行步骤

### 7.1 自动检查

开发中先跑定向测试：

```bash
npm run test --workspace @imagemon/mobile -- \
  src/tw/press-feedback.test.ts \
  src/promptdex/home.test.ts
```

生产代码完成后：

```bash
npm run mobile:prepare
npm run mobile:verify
git diff --check
npm run mobile:screenshots:android -- --only catalog
```

合并前：

```bash
npm run verify
```

任何失败只修生产代码或新增检查自身的真实缺陷，不删除测试、不跳过测试、不替换 Mock/Fixture、不放宽既有断言。

### 7.2 Android

1. 先按第五节完成模拟器录屏、拆帧和基线故障捕获校准，保留关键帧与结果作为合并证据；
2. 在模拟器上人工执行第六节矩阵，确认录屏没有漏掉主观明显的余色；
3. 至少补一次真实 Android 触屏设备快滑，确认 ADB swipe 结果与真实手指一致，并补做“静止超过 `100ms` 后再拖动”；
4. 静态截图只用于确认布局、图片按钮层级和业务徽标未回归，不能替代手势检查。

### 7.3 Web

以确定性 screenshot 数据启动：

```bash
npm run mobile:prepare
EXPO_PUBLIC_IMAGEMON_SCREENSHOT_MODE=1 \
npm run web --workspace @imagemon/mobile -- \
  --localhost --port 8087
```

另开终端，用 Playwright CLI 建立真实移动触摸上下文：

```bash
command -v npx >/dev/null 2>&1
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"

"$PWCLI" --session catalog-scroll \
  open http://127.0.0.1:8087 --mobile --headed
"$PWCLI" --session catalog-scroll resize 390 844
"$PWCLI" --session catalog-scroll snapshot
```

使用 Chromium CDP `Input.dispatchTouchEvent`，不要用普通 DOM `dispatchEvent` 冒充滚动。下列命令用 CDP 检查真实触摸上/下滑、短按和代表图按钮，用 `page.mouse` 精确检查 Web press-in 的 `70ms` / `260ms` 反馈时序，并补鼠标与键盘激活；滚动断言读取 RN Web 内层 ScrollView 的 `scrollTop`，不能读取通常保持为 `0` 的 `window.scrollY`：

```bash
"$PWCLI" --session catalog-scroll run-code "async (page) => {
const HOME = 'http://127.0.0.1:8087/';
const cdp = await page.context().newCDPSession(page);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const path = () => page.evaluate(() => location.pathname);
const cards = () =>
  page.getByRole('button', { name: /^打开图鉴条目 / });
const scrollTop = (card) =>
  card.evaluate((element) => {
    let node = element.parentElement;
    while (node && node.scrollHeight <= node.clientHeight + 1) {
      node = node.parentElement;
    }
    if (!node) throw new Error('未找到 RN Web 内层 ScrollView');
    return node.scrollTop;
  });
const background = (card) =>
  card.evaluate((element) => getComputedStyle(element).backgroundColor);
const touch = (type, point) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: point
      ? [{ id: 1, x: point.x, y: point.y, radiusX: 8, radiusY: 8, force: 1 }]
      : [],
  });
async function openVisibleCard(direction) {
  await page.goto(HOME);
  const first = cards().first();
  await first.waitFor();
  if (direction === 'down') {
    await first.evaluate((element) => {
      let node = element.parentElement;
      while (node && node.scrollHeight <= node.clientHeight + 1) {
        node = node.parentElement;
      }
      if (!node) throw new Error('未找到 RN Web 内层 ScrollView');
      const max = node.scrollHeight - node.clientHeight;
      node.scrollTop = Math.min(Math.max(240, max / 2), max - 1);
    });
    await page.waitForTimeout(100);
  }
  const viewport = page.viewportSize();
  const dy = direction === 'up' ? -180 : 180;
  for (let index = 0; index < await cards().count(); index += 1) {
    const card = cards().nth(index);
    const box = await card.boundingBox();
    if (!box) continue;
    const point = {
      x: box.x + box.width * 0.3,
      y: box.y + box.height * 0.5,
    };
    const endY = point.y + dy;
    if (point.y > 50 && point.y < viewport.height - 50 &&
        endY > 50 && endY < viewport.height - 50) {
      return { card, point, dy };
    }
  }
  throw new Error('当前滚动位置没有满足手势边界的可见卡片');
}
async function checkSwipe(direction) {
  const { card, point, dy } = await openVisibleCard(direction);
  const baseline = await background(card);
  const before = await scrollTop(card);
  let ended = false;
  try {
    await touch('touchStart', point);
    await page.waitForTimeout(40);
    await touch('touchMove', { x: point.x, y: point.y + dy * 0.27 });
    await page.waitForTimeout(30);
    const earlyDuringSwipe = await background(card);
    await page.waitForTimeout(10);
    await touch('touchMove', { x: point.x, y: point.y + dy * 0.7 });
    await page.waitForTimeout(120);
    const during = await background(card);
    await touch('touchMove', { x: point.x, y: point.y + dy });
    await touch('touchEnd');
    ended = true;
    await page.waitForTimeout(350);
    const after = await scrollTop(card);
    const currentPath = await path();
    assert(earlyDuringSwipe === baseline, direction + ' 70ms 内出现 pressed');
    assert(during === baseline, direction + ' 快滑出现 pressed 或余色');
    assert(currentPath === '/', direction + ' 快滑错误导航到 ' + currentPath);
    assert(
      direction === 'up' ? after - before >= 80 : before - after >= 80,
      direction + ' 快滑没有让内层 ScrollView 移动 80px',
    );
  } finally {
    if (!ended) await touch('touchEnd').catch(() => {});
  }
}
async function pressTarget(locator, duration) {
  await locator.waitFor();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert(box, '目标没有可见 bounds');
  const point = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 };
  await touch('touchStart', point);
  await page.waitForTimeout(duration);
  await touch('touchEnd');
}

await checkSwipe('up');
await checkSwipe('down');

await page.goto(HOME);
let card = cards().first();
await card.waitFor();
await card.scrollIntoViewIfNeeded();
let baseline = await background(card);
let box = await card.boundingBox();
let point = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 };
await page.mouse.move(point.x, point.y);
await page.mouse.down();
await page.waitForTimeout(70);
const early = await background(card);
await page.waitForTimeout(190);
const held = await background(card);
await page.mouse.up();
await page.waitForTimeout(400);
assert(early === baseline, '70ms 内错误进入 pressed');
assert(held !== baseline, '260ms 静止按住仍没有 pressed 反馈');
assert(await path() === '/promptdex/light-infographic', '长按后目的地错误');

await page.goto(HOME);
await pressTarget(cards().first(), 60);
await page.waitForTimeout(400);
assert(await path() === '/promptdex/light-infographic', '短按目的地错误');

await page.goto(HOME);
await pressTarget(page.getByRole('button', { name: '打开代表图详情' }), 60);
await page.waitForTimeout(400);
assert((await path()).startsWith('/images/'), '代表图按钮目的地错误');

await page.goto(HOME);
await cards().first().click();
await page.waitForTimeout(400);
assert(await path() === '/promptdex/light-infographic', '鼠标点击目的地错误');

for (const key of ['Enter', 'Space']) {
  await page.goto(HOME);
  card = cards().first();
  await card.focus();
  await page.keyboard.press(key);
  await page.waitForTimeout(400);
  assert(await path() === '/promptdex/light-infographic', key + ' 激活目的地错误');
}
}
"
```

方案编写时已在修复前基线对 `390×844` 命令做过自检：CDP 上滑令内层 `scrollTop` 从 `0` 变为 `165`，下滑从 `649` 变为 `484`，两次均留在 `/`；鼠标按下 `70ms` 时背景已从 `rgb(255, 253, 251)` 变为过渡中的 `rgba(216, 222, 232, 0.39)`。因此修复前会在“`70ms` 内错误进入 pressed”处失败，证明核心断言不是恒真。该结果只证明验收命令能捕获基线故障，不代表修复已完成。

完成手机宽度后，再执行：

```bash
"$PWCLI" --session catalog-scroll resize 768 900
```

在 `768×900` 下重新运行同一 `run-code` 块，覆盖 `windowWidth >= 700` 的横向卡片布局。最后检查 console 并关闭会话：

```bash
"$PWCLI" --session catalog-scroll console warning
"$PWCLI" --session catalog-scroll console error
"$PWCLI" --session catalog-scroll screenshot
"$PWCLI" --session catalog-scroll close
```

两种视口都必须满足：URL、内层 `scrollTop`、背景色、图片按钮、鼠标、Enter、Space 的断言全部通过；console 不得出现 `pressFeedbackDelayMs` 未知 DOM 属性警告或相关 runtime error。Playwright 临时状态与截图测试后清理，不提交仓库。

### 7.4 iOS

当前 Linux 环境没有 `xcrun`，iOS 不得写成“已验证”。在 macOS 启动应用：

```bash
EXPO_PUBLIC_IMAGEMON_SCREENSHOT_MODE=1 npm run mobile:ios
```

若目标是 **Simulator**，另开终端录制：

```bash
xcrun simctl io booted recordVideo --codec=h264 \
  /tmp/imagemon-ios-catalog-scroll-press-feedback.mov
```

`simctl recordVideo` 只支持 Simulator；真机须使用 Xcode 的 Devices and Simulators 截屏/录屏能力，或通过 QuickTime Player 的“新建影片录制”选择已连接 iPhone，不能把上述 `simctl` 命令用于真机。

在模拟器或真机逐项执行第六节合同，至少覆盖已生成卡片图片区、文字区、未生成卡片、代表图按钮、快速 flick、短按、静止按住和慢按后拖。测试向下滑动前先离开列表顶部。结束后保留设备、系统版本、录制方式与结果；若条件允许，再用 iPad 覆盖横向卡片布局。“其他图片”同样使用含真实数据的设备人工验收，不为此修改 screenshot Fixture。

---

## 八、不采用的方案

| 方案 | 不采用原因 |
| --- | --- |
| 全平台删除 `active:` 或删除真实反馈 | 虽能消除闪烁，但真实 tap 也失去反馈，违反设计合同；实际仅在 Web 延迟路径接管类名，并用 RNW `pressed` 显式恢复同等反馈 |
| 缩小卡片点击区或回退 `f177a62` | 违反整卡命中保真要求，并降低可访问性 |
| 只缩短 `duration-150` | 只能让错误反馈更短，无法阻止滚动意图进入 pressed |
| `onScrollBeginDrag` 后清 pressed | 事件晚于首次 `onPressIn`，第一帧闪烁已发生；还会导致整页卡片重渲染 |
| 页面维护 `isScrolling` / `isPressed` | 引入高频跨卡片状态与竞态，公共 Pressability 已能在 responder 被抢占时取消 pending press |
| 只传 `unstable_pressDelay` | Web 不读取该属性，形成平台行为分裂 |
| 修改 `pressRetentionOffset` | 它控制元素边界外的保留区域，无法区分发生在大卡片内部的纵向滑动 |
| 首轮直接换 Gesture Handler | 需要重做 Web 键盘、无障碍、嵌套按钮与手势竞争，成本和回归面明显更大 |

---

## 九、风险、回退与升级条件

### 9.1 主要风险与控制

| 风险 | 控制措施 |
| --- | --- |
| 原生/Web 属性名称不一致 | 公共桥接层统一适配，纯函数单测锁定映射 |
| 自定义 prop 泄漏到 DOM | 包装层先解构消费；Web console 验收未知属性警告 |
| 正常 tap 反馈显得迟钝 | 默认仅首页启用 `100ms`；验证短按与静止按住，不向普通按钮扩散 |
| 代表图按钮触发外层导航 | 保持同级结构，单独验证目标路由与单次返回 |
| 慢按后拖仍有短暂反馈 | `100ms` 后才开始拖动时允许先反馈；滚动接管后必须在 `350ms` 内清除且不导航 |
| Android 像素检查假通过 | 同时要求内容实际滚动、URL/页面不变，并做人工与真机抽验 |

### 9.2 回退边界

若修复导致正常点击或跨端构建回归，只回退以下新增语义：

- `pressFeedbackDelayMs` 公共适配；
- `Surface` 透传；
- 首页调用点；
- 对应新增单测。

不得借回退缩小整卡命中、删除代表图按钮、修改业务状态或放宽既有测试。

### 9.3 升级到显式手势识别的条件

若完成上述修复后，仍满足以下任一条件，再单独评估 Gesture Handler 的 tap/scroll 竞争：

- 已被平台识别为滚动的手势仍偶发导航；
- 产品明确要求位移超过自定义阈值即判定 tap 失败；
- 卡片未来需要横滑、长按等复合手势。

升级方案应以 `Gesture.Tap().maxDistance(10)` 为起点评估，但必须另外保留 Web Enter/Space、accessibility action、代表图按钮优先级和整卡命中。不要通过把延迟继续提高到明显迟钝的数值来替代手势建模。

---

## 十、实施顺序、提交切分与完成定义

### 10.1 实施顺序

1. 在当前基线先执行定向测试和 `mobile:verify`，记录原始结果；
2. 新增平台映射纯模块与单测；
3. 扩展公共 Pressable 和 Surface；
4. 首页五类按压区域统一接入 `100ms`；
5. 修复 Web CSS `:active` 绕过 RNW delay 的视觉路径；
6. 用延迟后的 RNW `pressed` 统一 Web 鼠标与真实触摸反馈；
7. 运行定向测试、`mobile:verify`、Android A/B 录屏、重复手势、静态截图与 Web 双视口验收；
8. 据实更新本文状态与完成清单，再运行根 `verify`；真机与 iOS 项在具备外部设备后补验。

### 10.2 建议提交切分

实际按可独立验证的子任务拆为五个 `fix` 提交，提交号见本节开头的“独立提交”表；验收记录使用单独的 `docs: 记录图鉴滚动修复验收结果` 提交。未完成的外部验收不预先勾选。

### 10.3 完成定义

- [x] `pressFeedbackDelayMs` 未传时保持旧行为，传入后原生/Web 使用正确底层属性；
- [x] 自定义 prop 不泄漏到 DOM 或原生 View；
- [x] 首页五类按压区域全部使用同一 `100ms` 常量；
- [ ] 快速上下滑动不出现错误 pressed、不导航、无残留，列表确实滚动；
- [ ] 短按、长按、慢按后拖均符合第六节合同；
- [ ] 已生成整卡、代表图按钮、其他图片和模板提炼入口目的地正确且只激活一次；
- [ ] 业务徽标、disabled、键盘、无障碍和 `44×44pt` 命中区无回归；
- [x] 新增映射单测通过，既有移动端测试未被删除、跳过或放宽；
- [x] `npm run mobile:verify`、`git diff --check`、Android 静态截图通过；
- [ ] Android 连续 swipe 录屏可捕获修复前故障，修复后逐帧检查与真实触屏抽验通过；
- [x] 本轮已覆盖对象的 Web 手机/宽屏触摸、鼠标、Enter、Space 与 console 检查通过；
- [ ] iOS 模拟器或真机验收有设备版本与录屏证据；
- [x] `npm run verify` 通过（`60` 个测试文件、`491` 项测试）；
- [x] 工作树中没有 Metro、Playwright、ADB、截图或录屏临时产物。

在 iOS 外部验收未完成前，不得把本计划状态改为“全部完成”。
