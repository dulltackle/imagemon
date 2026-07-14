# 移动端 UX 第二批实施方案：全局可见的体验与承诺（2026-07-13）

对应盘点报告 `docs/plans/2026-07-13-mobile-ux-audit.md` 的「第二批」七项：**2.3 / 3.2 / 7.1 / 6.1 / 4.1 / 2.1 + 2.2 / 5.1**。

- **实施基线**：`improving-ux` @ `fc5922d`；第一批方案已全部落地，应用默认规格、重新填写和条目任务表单重构不在本批重复实施。
- **目标**：先完成四个低风险、全局可见的小修，再交付图片全屏查看；最后用一套统一的模型调用状态/业务调用提示基础设施承接跨页面调用与资产删除。
- **预计成本**：约 **7–10 个开发日**，建议拆成 10 个可独立验证的提交，不把大项压成一次不可审查的改动。
- **测试约束**：移动端 Vitest 只收 `src/**/*.test.ts`，没有组件测试。本批继续把日期、复制状态、缩放边界、提示聚合和删除规则下沉到纯 `.ts` 模块；`.tsx` 的导航、手势、Safe Area 和原生 Tab 角标通过 Expo Go 实机走查与截图验收。

---

## 〇、实施决策与范围

### 决策 1：日期统一为本地时间 `YYYY-MM-DD HH:mm`

所有面向设备使用者的任务和图片时间统一显示本地时间，例如 `2026-01-01 19:04`：

- 固定包含年份，避免首页/列表与详情页含义不一致；
- 固定 24 小时制和 ASCII 数字，不依赖 Hermes 的 `Intl` / ICU 区域格式；
- 月、日、时、分始终补零；
- 无效时间返回「时间未知」，不把 `Invalid Date` 暴露到界面；
- 本批不引入“刚刚 / 3 分钟前”等相对时间，也不显示秒和时区。

### 决策 2：图片缩放使用独立全屏路由

图片详情仍负责规格、关联历史和导出；点击原图进入独立 `image-viewer/[id]` 全屏路由。查看器只接收图片结果 id，再从仓储与文件存储读取资源，不把本地 URI 放进路由参数。

采用 `react-native-gesture-handler` + 已有 `react-native-reanimated` 实现 Android/iOS 一致的双指缩放、拖移和双击缩放。全屏查看器是手势画布，不嵌在详情页 `ScrollView` 中，避免纵向滚动和 pinch/pan 争抢手势。

### 决策 3：全局模型调用状态与业务调用提示是两层状态

| 层 | 生命周期 | 覆盖范围 | 是否持久化 |
| --- | --- | --- | --- |
| 全局模型调用状态 | 从取得全局锁到释放锁 | 图片任务、模板提炼、测试连接、未来的拉取模型列表 | 否；进程重启即释放 |
| 业务调用提示 | 业务调用完成、失败或结果不确定后，到进入对应详情/处理页 | 图片任务、模板提炼 | 是；本机跨重启保留 |

两层状态不得混用：诊断类调用只显示全局状态，不生成待查看提示；业务调用结束后全局状态消失，再由业务调用提示承担结果可发现性。全局状态不显示 token、费用、百分比或预计时间，也不引入调用队列、系统通知、自动跳转。

### 决策 4：业务调用提示按“底层对象”存储，不存计数

新增本机表 `business_call_attentions`，每个底层对象最多一条提示：

```text
subject_type: image_task | template_refinement
subject_id:   任务历史 id | template_refinement
kind:         succeeded | failed | uncertain
created_at:   ISO 时间
PRIMARY KEY (subject_type, subject_id)
```

- 图片任务提示以任务历史 id 为身份；一次任务的多张图片共享同一条提示。
- 模板提炼首版只有一个草稿，以固定 id `template_refinement` 为身份。
- 表中不存未读数量；Tab 只显示非数字标记，列表项显示「待查看 / 待处理」。
- v7 → v8 迁移只建空表，**不把升级前已有历史补标为未查看**。
- 该表明确排除在未来 ZIP 备份清单之外；恢复也不得为导入对象写入该表。

选择独立表而非给任务历史/提炼草稿加 `unread` 字段，是为了让“资产状态”和“当前设备上的可发现性状态”保持分离，并能严格落实 ADR 0162–0165。

### 决策 5：三类资产删除均为硬删除，但互不级联

- 删除个人图鉴条目：不删除任务历史和图片结果；内置条目没有删除入口。
- 删除任务历史：不删除图片结果；SQLite 外键把图片结果的 `task_history_id` 置空，编辑任务内部附件随历史清理。
- 删除图片结果：删除应用内记录和私有原图文件；不删除任务历史，也不影响已经导出到相册/文件系统的副本。

本批不做回收站、撤销、批量删除、归档或自动清理。所有删除入口都在对象详情页底部，执行前用系统确认框说明准确范围。

### 明确不做

- 不实现第三批视觉收敛、搜索、ZIP 备份/恢复、图片分享或文件系统导出。
- 不实现模型列表拉取 UI；只让全局调用类型与返回目标的数据结构为其留出合法分支。
- 不借本批实现测试连接取消（审计 7.3 仍留在 roadmap）；全局状态入口只返回调用页面，不改变页面当前已有的取消能力。
- 不发送本地通知、不在调用完成后弹窗打断、不自动切页。
- 不修改既有测试、断言、Mock 或 Fixture 来绕过失败；所有行为变化通过生产代码和新增用例完成。

---

## 一、2.3【P1】中文日期时间统一

### 现状

以下五个界面各自复制 `formatDateTime`，且有的含年、有的不含年；Hermes 即使传 `"zh-CN"` 仍可能显示 `01/01, 7:04 PM`：

- `src/promptdex/PromptdexCatalogScreen.tsx`
- `src/promptdex/PromptdexEntryDetailScreen.tsx`
- `app/(tabs)/(history)/history.tsx`
- `app/history/[id].tsx`
- `app/images/[id].tsx`

### 改动

新增 `apps/mobile/src/formatters/date-time.ts` 与 `date-time.test.ts`：

```ts
export function formatLocalDateTime(value: string | Date): string;
```

实现只使用 `Date#getFullYear/getMonth/getDate/getHours/getMinutes` 和本地 `padStart`，不调用 `toLocaleString`。五个界面统一导入该函数并删除本地实现，时间文本继续使用 `tabular-nums`。

单测至少覆盖：

1. 本地时间字符串 `2026-01-02T03:04:00` → `2026-01-02 03:04`；
2. 月、日、时、分补零；
3. 跨年日期保留年份；
4. 无效字符串 → `时间未知`；
5. 函数不依赖 `Intl.DateTimeFormat`。

### 验收

- 图鉴首页、条目详情、历史列表、历史详情和图片详情的同一时间显示完全一致；
- Android 设备为 12 小时制或英文区域时，应用内仍显示 `YYYY-MM-DD HH:mm`；
- 不出现逗号、AM/PM、斜杠日期或省略年份。

### 成本

小（约 0.5 天）。

---

## 二、3.2【P1】任务历史支持完整提示词复制

### 现状

`app/history/[id].tsx` 的「完整提示词」只有可选择文本，没有显式复制动作。仓库已有 Promptdex Markdown 复制的防重复点击、loading 和页面内反馈状态机，但命名与文案绑定在 Promptdex Markdown 上。

### 改动

**(a) 抽取通用复制控制状态**

新增 `src/clipboard/copy-control.ts` + `copy-control.test.ts`，承接现有 800ms 防抖、进行态和成功/失败反馈：

```ts
export interface ClipboardCopyMessages {
  success: string;
  failure: string;
}

export function createClipboardCopyControlState(): ClipboardCopyControlState;
export function startClipboardCopy(...): ClipboardCopyControlState;
export function finishClipboardCopy(
  state: ClipboardCopyControlState,
  result: ClipboardCopyResult,
  messages: ClipboardCopyMessages,
): ClipboardCopyControlState;
export function releaseClipboardCopy(...): ClipboardCopyControlState;
```

`src/promptdex/markdown-copy-control.ts` 保留为领域文案薄封装，既有测试语义与公开函数不变；历史详情直接复用通用状态机，不复制一份近似实现。

**(b) 历史详情接入**

- 「完整提示词」标题行改为左右布局，右侧增加图标 +「复制」按钮；
- 调用 `Clipboard.setStringAsync(snapshot.fullPrompt)`，复制内容只能是 `snapshot.fullPrompt`，不得拼入模型配置、图片规格、文件路径或其他任务字段；
- 复制中禁用重复点击并显示 ActivityIndicator；
- 成功提示「完整提示词已复制。」，失败提示「无法复制到剪贴板，请稍后重试。」；
- 反馈放在完整提示词卡片内，离开页面不持久化；正文继续保留 `selectable`。

### 验收

1. 完成、失败和状态未知的 Promptdex 任务历史均可复制；
2. 粘贴结果逐字等于历史快照的 `fullPrompt`；
3. 连续快速点击只触发一次复制；
4. 剪贴板调用失败后按钮恢复可用，页面显示非持久错误；
5. manual 快照若当前页面没有完整提示词区，不新增虚假入口。

### 成本

小（约 0.5 天）。

---

## 三、7.1【P1】模型配置「保存」语义与按钮主次

### 现状

`src/model-configurations/ModelConfigurationEditor.tsx` 把普通保存称作「保存草稿」，成功提示为「已保存草稿。」；主按钮是保存，通往就绪状态的「保存并测试」反而使用次级样式。领域中不存在模型配置草稿。

### 改动

只调整文案和视觉主次，不改变仓储、就绪判定或默认配置行为：

1. `handleSave` 成功提示改为「已保存。」；
2. 操作区第一项改为主按钮「保存并测试」，测试中显示「测试中」；
3. 第二项改为次级按钮「保存」，保存中显示「保存中」；
4. 「设为默认」继续为次级，「删除配置」继续为危险操作；
5. 全仓搜索并清除面向设备使用者的「保存草稿 / 已保存草稿」模型配置文案，不触碰领域中的「提炼草稿」。

按钮顺序固定为：

```text
[保存并测试]   主操作
[保存]         次操作（允许未就绪保存）
[设为默认]     仅就绪且非当前默认时出现
[删除配置]     仅已保存配置出现
```

### 验收

- 新建和编辑图片/文本模型配置的主次一致；
- 点「保存」仍允许保存未就绪配置，且不会自动测试或设为默认；
- 点「保存并测试」仍先保存再测试，通过后变为就绪，但不会自动设为默认；
- 页面不再出现“模型配置草稿”概念。

### 成本

小（约 0.25 天）。

---

## 四、6.1【P1】首次设置补充上下文与常驻完成入口

### 现状

`src/first-run/index.tsx` 首屏直接进入 Base URL、模型名、API Key；设备使用者不知道应用为什么需要配置，也不知道跳过的后果。两个模型区块较长，「完成 / 跳过」位于页面最底部。

### 改动

**(a) 顶部功能说明卡**

在第一个模型区块前增加紧凑说明，不新增营销式欢迎页：

> Imagemon 通过你提供的模型配置执行图片任务和模板提炼；API Key 只保存在当前设备的安全存储中。你可以先跳过，之后随时在「设置 → 模型配置」中完成配置。

说明卡使用现有语义色和信息图标，正文可选择；不声称应用会上传、同步或代管 API Key。

**(b) 完成/跳过移到吸底操作栏**

沿用第一批条目详情的 Safe Area 方案：

- `ScrollView` 只放说明和两个模型区块，底部留足操作栏高度；
- `完成设置` 为主按钮，`暂时跳过` 为次按钮，固定在滚动区下方；
- 键盘出现时由现有 `KeyboardAvoidingView` 处理，操作栏不得遮挡当前输入框；
- 测试连接进行中两个按钮保持禁用，既有未保存修改确认逻辑不变。

### 验收

- 首屏无需滚动即可看到“为什么需要配置”和“可以稍后配置”；
- 任意滚动位置都能看到完成/跳过入口；
- 跳过后进入应用，图鉴可浏览；执行图片任务或模板提炼时仍由现有缺少模型配置提示拦截；
- API Key 说明与 SecureStore 实现一致。

### 成本

小（约 0.5 天，含键盘实机走查）。

---

## 五、4.1【P1】图片全屏缩放查看

### 现状

`app/images/[id].tsx` 把图片限制在 `maxHeight: 520` 内，图片本身不可点击，也不支持 pinch、拖移或双击放大。

### 改动

**(a) 依赖和根容器**

- 使用 `npx expo install react-native-gesture-handler` 安装与 Expo SDK 54 匹配的版本；
- `app/_layout.tsx` 最外层增加 `GestureHandlerRootView`（`flex: 1`），继续保留现有 `SafeAreaProvider`；
- 首先使用 Expo Go 验证，不创建自定义开发构建；只有依赖实际要求自定义原生构建时才升级验证路径。

**(b) 缩放几何纯逻辑**

新增 `src/image-tasks/image-viewer-geometry.ts` + 单测：

```ts
export const IMAGE_VIEWER_MIN_SCALE = 1;
export const IMAGE_VIEWER_DOUBLE_TAP_SCALE = 2.5;
export const IMAGE_VIEWER_MAX_SCALE = 5;

export function clampImageViewerScale(scale: number): number;
export function getImageViewerTranslationBounds(input: {
  viewportWidth: number;
  viewportHeight: number;
  fittedImageWidth: number;
  fittedImageHeight: number;
  scale: number;
}): { maxX: number; maxY: number };
export function clampImageViewerTranslation(...): { x: number; y: number };
```

单测覆盖最小/最大缩放、横竖图在不同视口的拖移边界、缩回 1 倍时归零、零尺寸输入安全回退。

**(c) 新增全屏路由**

- 新增 `app/image-viewer/[id].tsx`；根 Stack 注册为 `presentation: "fullScreenModal"`、`headerShown: false`、深色背景；
- 只按 id 读取 `ImageResult`，再通过 `ImageResultFileStorage.resolveFileUri` 获取图片；记录不存在显示「图片结果不存在」，文件缺失显示「图片文件缺失」并保留关闭入口；
- 使用容器 `onLayout` 获取视口，不使用 `Dimensions.get()`；旋转或窗口尺寸变化时重新计算并复位到 1 倍；
- 手势组合：pinch 缩放 1–5 倍；放大后 pan；双击在 1 倍与 2.5 倍之间切换；手势结束时用 Reanimated 回弹到合法边界；
- 左上角提供不小于 44×44 的关闭按钮，放大后显示「重置」按钮；Android 系统返回键正常关闭；
- 查看器不承载导出、分享、删除或历史跳转，避免全屏画布承担资产管理。

**(d) 图片详情入口**

- 图片可用时用 `Pressable` 包裹原图，点击 `router.push('/image-viewer/<id>')`；
- 增加 `accessibilityLabel="全屏查看图片"` 与一行轻提示「轻点全屏查看，可双指缩放」；
- 图片文件缺失时不渲染可点击入口；导出按钮的禁用逻辑保持不变。

### 验收

1. 方图、横图、竖图都以完整可见的 1 倍状态打开；
2. 双指可连续放大到 5 倍，拖移不会把图片完全移出视口；
3. 双击在 1 倍和 2.5 倍间切换，重置恢复居中；
4. 关闭后回到原图片详情及原滚动位置；
5. Android 返回键、iOS 下拉/返回手势、旋转和深浅色都不出现白屏或手势死锁；
6. 缺失文件不会进入空白黑屏。

### 成本

中（约 1–1.5 天，Android/iOS 各走查一次）。

---

## 六、2.1【P1】全局模型调用状态

### 现状与关键风险

`src/model-calls/index.tsx` 的 `ActiveModelCall` 只有 `id/type/startedAt`，`getModelCallReturnHref(type)` 只能返回粗粒度列表页；根布局没有状态 UI。业务调用的 Promise 由发起页面持有，页面出栈后调用会继续，但重新进入同一路由的组件实例无法仅凭本地 `isSubmitting/phase` 恢复 loading。

因此本项不能只加一个视觉胶囊，还必须补齐“精确返回目标 + 新页面实例重建等待态”。

### 改动

**(a) 扩展模型调用描述**

`beginModelCall(type)` 改为接收结构化输入：

```ts
export type ModelCallType =
  | "modelConfigurationTest"
  | "modelListFetch"
  | "imageGeneration"
  | "imageEdit"
  | "templateRefinement";

export interface BeginModelCallInput {
  type: ModelCallType;
  returnHref: string;
  ownerKey: string;
  context?: {
    historyId?: string;
    promptdexEntryName?: string;
    modelConfigurationId?: string;
  };
}

beginModelCall(input: BeginModelCallInput): BeginModelCallResult;
updateModelCall(id: string, patch: Partial<...>): void;
```

- `returnHref` 是发起时的精确页面：条目详情、提炼页、首次设置或对应模型配置详情；
- 新建模型配置先以 `/model-configurations/new?...` 为返回地址，保存得到 id 后用 `updateModelCall` 改为详情页；
- 图片任务先以发起条目为返回地址；生成/编辑服务新增 `onHistoryCreated(history)` 生命周期回调，并保证在 running history 落库后、真正发出模型请求前调用。页面在回调中补 `historyId`，同时把返回地址改为 `/history/<id>`，让全局入口返回可持久重建的图片任务等待页；
- `ownerKey` 用于新组件实例判断“当前调用是否属于我”，不能只比较调用类型；
- 删除仅按 type 推断目标的 `getModelCallReturnHref`，避免两个模型配置详情或两个条目之间串页。

纯测试覆盖：四类现有调用 + 预留的 `modelListFetch` 文案；锁占用时返回原调用；错误 id 不能更新/结束别人的调用；精确返回地址不被 type helper 覆盖。图片任务 service 测试另加断言：`onHistoryCreated` 恰好调用一次、发生在 model client 之前，回调收到的 id 与最终结果/失败历史一致。

**(b) 新增全局状态胶囊**

新增 `src/model-calls/GlobalModelCallStatus.tsx`，在 `app/_layout.tsx` 的根 Stack 外层、`ModelCallLockProvider` 内渲染：

- 文案固定为「图片任务进行中 / 模板提炼进行中 / 测试连接进行中 / 拉取模型列表进行中」；
- 左侧 ActivityIndicator，右侧「返回」和箭头；整个胶囊可点击；
- 点击使用 `router.navigate(activeCall.returnHref)`，仅响应设备使用者主动操作；
- 位于安全区内：Tab 根页面抬高到原生 Tab 上方，根 Stack 详情页位于底部安全区上方；用 `useSegments` 判断是否处于 `(tabs)`，不硬编码所有页面 padding；
- 胶囊为临时浮层，不改变各页面数据状态；设置 `accessibilityRole="button"` 和完整状态标签。

**(c) 返回页面重建等待态**

- `PromptdexEntryDetailScreen`：running history 创建前，当前 `activeCall.ownerKey` 命中条目时，即使本地 `isSubmitting=false` 也显示任务进行中、禁用重复提交；创建后全局返回目标切到历史详情。调用结束后重新加载条目图片和相关历史。
- `app/history/[id].tsx`：activeCall 的 `historyId` 命中当前 id 时显示等待态；调用结束后重新查询 history 和关联图片，使 running → completed/failed 的变化无需离开页面即可出现。
- `TemplateRefinementScreen`：owner 命中时直接显示 generating；调用结束后重新读取持久化提炼草稿，进入 review/failed，而不是依赖已经卸载组件的 `setState`。
- `ModelConfigurationEditor` / `FirstRunSetupScreen`：owner 命中时字段与操作只读并显示测试中；调用结束后重新读取配置/设置。测试取消能力保持现状，本批不新增 AbortController UI。

### 验收

1. 任一模型调用开始后，所有路由均能看到正确调用类型；
2. 从业务等待页返回并浏览其他 Tab，调用继续且胶囊仍在；
3. 点胶囊回到**发起该调用的具体页面**，不是列表页或另一个同类型页面；
4. 新页面实例能显示 loading，不能重复发起调用；
5. 调用结束后胶囊消失，不自动跳转；
6. 进程重启后不恢复虚假的 activeCall，遗留业务对象交给下一节的 uncertain 提示处理。

### 成本

中（约 1–1.5 天）。

---

## 七、2.2【P1】业务调用提示（角标）

### 7.1 数据层与 schema v8

新增 `src/business-call-attentions/`：

```text
index.ts
repository.ts
repository.test.ts
presentation.ts
presentation.test.ts
```

仓储能力：

```ts
interface BusinessCallAttentionRepository {
  list(): Promise<BusinessCallAttention[]>;
  markImageTask(historyId: string, kind: "succeeded" | "failed" | "uncertain"): Promise<void>;
  markTemplateRefinement(kind: "succeeded" | "failed" | "uncertain"): Promise<void>;
  clearImageTask(historyId: string): Promise<void>;
  clearTemplateRefinement(): Promise<void>;
  subscribe(listener: () => void): () => void;
}
```

- memory/sqlite 两套 store 与现有仓储风格一致；
- 写入用 upsert，同一对象的新状态覆盖旧状态；
- clear 幂等；
- 仓储变更后通知订阅者，Tab 角标无需等到页面重新聚焦；
- `AppRuntime` 暴露仓储，新增 Provider 将列表聚合为只读 snapshot/Map，页面不得各自重复查全表。

`src/storage/index.ts`：

- `CURRENT_SCHEMA_VERSION` 7 → 8；
- 新安装直接创建 `business_call_attentions`；
- v7 → v8 只建表并写 migration 8；
- `storage/index.test.ts` 新增 v7 迁移与全新 v8 schema 用例，不改已有断言来规避失败。

### 7.2 写入与中断恢复

提示必须在业务对象最终状态写入时产生，不能由页面看到成功后再补写，否则页面出栈或进程中断会漏标：

- `ImageTaskRepository.markCompleted`：同一数据库事务内写 `succeeded`；
- `ImageTaskRepository.markFailed`：同一事务内写 `failed`；
- 启动时 `markRunningHistoriesUnknown`：把遗留 running 转 unknown，并为每个 id 写 `uncertain`；
- `TemplateRefinementDraftRepository.saveProposal`：同一事务内写 `succeeded`；
- `saveFailure`：写 `failed`；
- 启动时若草稿状态仍为 `generating` 且没有 activeCall，保留草稿并写 `uncertain`；进入提炼页后把它解释为「上次提炼在结果确认前中断，可修改输入后重新生成」，不得继续显示永久 spinner；
- 新一轮图片任务/模板提炼开始前清理同一目标的旧提示；诊断类模型调用不接入该仓储。

SQLite 事务通过向图片任务仓储和提炼草稿仓储注入同一个 attention store 实现；提示写入放在对象状态更新之后、事务提交之前。memory store 的用例也要验证状态更新失败时不留下孤立提示。

### 7.3 展示矩阵

| 状态 | 全局胶囊 | 图鉴 Tab / 首页 | 历史 Tab / 列表 | 图片/任务详情 | 清除时机 |
| --- | --- | --- | --- | --- | --- |
| 图片任务进行中 | 显示 | 发起条目显示「进行中」；图片入口不显示 | Tab 非数字标记；running 行保持状态 | 等待页显示 loading | 调用结束 |
| 模板提炼进行中 | 显示 | Tab 标记 + 提炼入口「进行中」 | 不显示 | 提炼页 loading | 调用结束 |
| 图片任务成功待查看 | 不显示 | Tab 标记；对应条目/其他图片项显示「待查看」 | Tab 标记；对应历史项显示「待查看」 | 打开任一关联图片详情或该任务历史详情 | 清除该 task id，两边同时消失 |
| 图片任务失败/未知待处理 | 不显示 | 不进入图片入口 | Tab 标记；对应历史项显示「待处理」 | 打开任务历史详情 | 清除突出提示，历史状态不变 |
| 提炼方案待确认 | 不显示 | Tab 标记；提炼入口显示「待确认」 | 不显示 | 打开提炼处理页 | 清除提示，草稿仍保留 |
| 提炼失败/结果不确定 | 不显示 | Tab 标记；提炼入口显示「待处理」 | 不显示 | 打开提炼处理页 | 清除提示，草稿/错误仍保留 |
| 测试连接/拉取模型列表 | 显示 | 不显示业务提示 | 不显示 | 只显示当前页结果 | 释放全局锁 |

具体落点：

- `app/(tabs)/_layout.tsx` 导入 Expo Router SDK 54 的 `Badge`，以 `!` 或等价非数字标记呈现；禁止显示数量。
- `PromptdexCatalogScreen`：提炼入口展示模板提示；已生成条目按该条目下任一未查看成功任务聚合；「其他图片」按关联 task id 标记。
- `PromptdexEntryDetailScreen`：横向图片缩略条按 task id 标记具体图片；进入条目详情本身不清除。
- `history.tsx`：历史项按 id 显示待查看/待处理；进入列表不清除。
- 一级 Tab 只表示“存在需要注意的对象”，进入 Tab 不清除。

如同一图鉴条目有多次成功任务，首页条目卡只显示一个布尔标记；进入条目详情后，每个任务关联图片显示自己的标记。一次任务有多张图片时，共享同一个 task id，打开其中任一张即清除整次任务提示（ADR 0180）。

### 7.4 清除与对象删除

- `app/history/[id].tsx` 成功读取具体历史后清除该 task id；missing/error 状态不清除。
- `app/images/[id].tsx` 成功读取图片及其 `taskHistoryId` 后，只清除该任务的 `succeeded` 提示；没有历史关联时不操作。
- `TemplateRefinementScreen` 成功读取处理页后清除模板提示；不因仅进入图鉴首页而清除。
- 最终状态写入时统一先产生提示，以覆盖页面已经出栈的情况；如果原等待页仍处于 focus 且已经成功渲染本次成功/失败结果，等待页随后立即清除该对象提示，避免设备使用者明明看到了结果仍在 Tab 上得到“待查看”。页面只 mounted 但不处于 focus 时不得代替设备使用者清除。
- 丢弃提炼草稿、确认写入提炼方案、删除任务历史或删除对应图片结果时同步清理相关提示。
- 清除失败不得阻断详情内容展示，但需记录非敏感 warning，并在下次进入时重试。

### 验收

1. 成功/失败调用在发起页面出栈后完成，相关 Tab 和具体列表项仍能定位结果；
2. 提示跨应用重启保留，active loading 不跨重启保留；
3. 只进列表不清除，进具体详情/处理页才清除；
4. 图片详情和历史详情任一侧查看后，成功提示在两边同步消失；
5. 图片失败/未知绝不出现在图片入口，模板提炼绝不出现在历史入口；
6. 所有提示均无计数；诊断类调用不产生提示；
7. v7 升级与未来恢复导入不制造历史“未读”；删除底层对象不留下死角标。

### 成本

大（约 2–3 天，含 schema、仓储、页面聚合与中断恢复）。

---

## 八、5.1【P1】个人图鉴条目、任务历史、图片结果删除

本项依赖第七节的 attention 清理能力；先完成数据层，再接三个详情页，避免 UI 先出现但留下死角标或孤立文件。

### 8.1 个人图鉴条目

数据层已有 `PersonalPromptdexEntryRepository.delete(name)` 及硬删除测试，只补 UI：

- `PromptdexEntryDetailScreen` 仅在 `entry.sourceType === "personal"` 时于页面内容底部显示「删除个人图鉴条目」危险按钮；内置条目不渲染；
- 确认文案：
  - 标题「删除个人图鉴条目」；
  - 正文「删除后该条目将从图鉴移除；已有任务历史和图片结果会保留。该名称之后可以重新导入或提炼。」；
- 确认后调用 repository.delete，成功 `router.replace("/")`；失败停留原页并显示页面内错误；
- 不因当前存在无关业务调用而禁用。图片任务已在调用前保存快照，删除条目不改变进行中的任务语义。

### 8.2 任务历史

**数据层**

扩展 `ImageTaskRepository` / `ImageTaskStore`：

```ts
deleteHistory(id: string): Promise<{
  history: ImageTaskHistory;
  detachedImageResultIds: string[];
}>;
```

规则：

- `status === "running"` 时抛 `invalid_state`，不得删除当前调用的写入目标；
- SQLite 在事务中删除 history，依靠现有 `ON DELETE SET NULL` 保留图片结果；memory store 必须显式把关联结果 `taskHistoryId` 置 null；
- 同一事务清除该 task id 的业务提示；
- 返回被解除关联的图片 id，便于测试和页面刷新，不代表删除图片。

新增 `src/image-tasks/deletion.ts` 服务，先从快照收集 `inputAttachments`，幂等删除内部附件，再删除历史记录。选择“附件先删、数据库后删”是为了避免数据库已无记录但私有目录长期残留；若数据库随后失败，历史仍可见但附件显示缺失，设备使用者可再次删除。任何情况下都不触碰图片结果文件。

**UI**

- 历史详情底部增加「删除任务历史」；running 时按钮禁用并说明「图片任务进行中，完成后才能删除这条任务历史。」；
- 确认正文：
  - 普通生成任务：「删除后任务快照和完整提示词将从本机移除；关联图片结果会保留。」
  - 编辑任务追加：「这条历史保存的内部输入附件也会删除；原相册文件不受影响。」
- 成功后 `router.replace("/history")`；被保留的图片在图鉴匹配失效时进入「其他图片」。

单测覆盖：完成/失败/未知可删；running 拒绝；图片结果保留且外键置空；编辑附件删除；附件已缺失时幂等成功；attention 清理；历史不存在返回 not_found。

### 8.3 图片结果

**文件与仓储**

`ImageResultFileStorage` 新增：

```ts
deleteFile(filePath: string): Promise<void>;
```

- Expo 实现只允许删除 `image-results/<safe-name>` 下文件；文件已缺失视为成功；
- memory 实现从 files Map 删除；继续复用安全路径校验，绝不接受绝对 URI 或目录穿越路径。

`ImageTaskRepository` 新增：

```ts
deleteImageResult(id: string): Promise<ImageResult>;
```

删除服务执行顺序固定为：

1. 读取图片结果；
2. 幂等删除私有原图文件；
3. 事务删除 SQLite 记录；
4. 若该结果有关联 task id，清除该任务的成功待查看提示；失败/未知提示不受影响。

采用“文件先删、记录后删”：若数据库删除失败，应用仍保留一条可见但文件缺失的记录，符合 ADR 0116/0117，设备使用者可再次删除；反向顺序会产生不可发现的孤立文件。

**UI**

- 图片详情底部增加「删除图片结果」危险按钮，即使图片文件已经缺失仍可用；
- 确认正文「删除后应用内原图和图片结果记录将移除；关联任务历史以及已保存到相册或其他位置的副本不受影响。」；
- 成功后 `router.replace("/")`；失败保留当前页并显示错误。

单测覆盖：记录+文件同时删除；文件已缺失；非法路径拒绝；数据库删除失败后的记录仍可重试；历史保留；多结果任务只删指定一张；对应 success attention 清除。

### 8.4 删除验收矩阵

| 操作 | 个人条目 | 任务历史 | 图片结果 | 内部附件 | 外部副本 |
| --- | --- | --- | --- | --- | --- |
| 删除个人条目 | 删除目标 | 保留 | 保留 | 保留 | 保留 |
| 删除任务历史 | 保留 | 删除目标 | 保留并解除关联 | 随历史清理 | 保留 |
| 删除图片结果 | 保留 | 保留 | 删除目标 | 保留 | 保留 |

### 成本

中（约 1.5–2 天，含文件失败路径和三处 UI）。

---

## 九、执行顺序与提交切分

| # | 建议提交 | 内容 | 依赖 |
| --- | --- | --- | --- |
| C1 | `fix(mobile): 统一中文日期时间格式` | 2.3，共享 formatter + 五处替换 | 无 |
| C2 | `feat(mobile): 支持复制历史完整提示词` | 3.2，通用复制状态 + 历史详情 | 无 |
| C3 | `fix(mobile): 对齐模型配置保存操作层级` | 7.1，术语与按钮主次 | 无 |
| C4 | `feat(mobile): 补充首次设置引导与常驻操作` | 6.1，说明卡 + 吸底栏 | 无 |
| C5 | `feat(mobile): 新增图片全屏缩放查看器` | 4.1，依赖、路由、手势和几何测试 | 无 |
| C6 | `feat(mobile): 展示全局模型调用状态` | 2.1，精确返回目标、状态胶囊、等待态重建 | 无 |
| C7 | `feat(mobile): 持久化业务调用提示` | 2.2 数据层、schema v8、业务结果写入和中断恢复 | C6（复用 owner/context） |
| C8 | `feat(mobile): 在入口和列表展示业务调用提示` | 2.2 Tab/列表/条目角标与清除规则 | C7 |
| C9 | `feat(mobile): 实现三类资产删除数据层` | 5.1 仓储、文件删除、内部附件与提示清理 | C7 |
| C10 | `feat(mobile): 新增三类资产删除入口` | 5.1 三处详情 UI、确认与导航刷新 | C9 |

C1–C4 可以作为一个“小修簇”连续交付；C5 单独提交，便于隔离原生手势依赖；C6–C8 是完整状态体系，不与删除 UI 混改；C9/C10 最后接入，确保删除从第一天起就遵守提示清理和非级联规则。

---

## 十、验证与完成定义

### 自动验证

每个提交执行：

```bash
npm run mobile:verify
```

本批新增单测至少覆盖：

- 日期手工格式化和无效值；
- 通用剪贴板复制状态与防重复；
- 图片查看器 scale/translation 边界；
- ModelCall owner、精确返回目标和错误 id 隔离；
- schema v8 新装/迁移；
- attention upsert、聚合、跨对象清除和无计数展示规则；
- running → unknown、提炼 generating → uncertain 的启动恢复；
- 三类删除的非级联矩阵、文件失败路径和死角标清理。

### Expo Go 实机走查

优先用 Expo Go，Android 模拟器 `imagemon-avd` 跑完整流程；图片手势、NativeTabs Badge 和 Safe Area 再在一台 iOS 设备/模拟器复核：

1. 切换系统为英文 + 12 小时制，五处日期仍为 `YYYY-MM-DD HH:mm`；
2. 历史详情复制完整提示词，粘贴比对逐字一致；
3. 新建模型配置：主按钮是保存并测试，次按钮保存未就绪配置；
4. 首次设置首屏能看到说明与跳过，键盘不遮挡吸底操作；
5. 真实图片进入全屏，完成 pinch/pan/double-tap/reset/返回；
6. 发起图片任务后返回图鉴：全局胶囊存在，running history 创建后点它回到对应任务等待/历史详情；成功后胶囊消失，图鉴和历史出现待查看；
7. 只进入历史列表不清除；打开历史详情后图鉴和历史两侧同时清除；
8. 制造失败任务：只在历史入口/行显示待处理，图片入口无标记；
9. 发起模板提炼后离开：只在图鉴/提炼入口显示；杀进程重启后变为结果不确定待处理，不显示永久进行中；
10. 测试模型连接：只显示全局胶囊，结束后不产生业务提示；
11. 分别删除个人条目、历史、图片，按 8.4 矩阵核对剩余资产；缺失图片文件仍可删除记录；running 历史不可删除。

更新 `scripts/mobile-android-screenshots.mjs` 的页面期望文案（「保存」「图片规格」等），并为 catalog/history 的提示态提供显式 screenshot seed。截图继续写入 `apps/mobile/.expo/screenshots/android/`，不入库。

### 批次完成定义

同时满足以下条件才算第二批完成：

- C1–C10 均已落地，`npm run mobile:verify` 全绿；
- Android 全流程通过，图片手势和原生 Tab 角标完成 iOS 复核；
- 任一模型调用离开页面后仍可发现进行态并返回正确页面；
- 任一业务调用结束后，无论发起页面是否还在栈中，都能通过正确入口定位结果；
- 提示跨重启、按详情清除、不显示计数、不进入诊断调用；
- 三类删除无级联误删、无不可达死角标，文件缺失与部分失败路径可解释且可重试；
- 没有通过删除、跳过、放宽或篡改既有测试来获得绿灯。

---

## 十一、主要风险与回退边界

| 风险 | 防线 | 回退边界 |
| --- | --- | --- |
| 发起页面卸载后，新实例不知道调用状态 | ActiveModelCall 保存 owner/returnHref/context；页面从全局状态和持久对象重建 | 可先保留胶囊但不发布，直到三类页面重建均通过 |
| attention 写入与业务对象状态分叉 | 同一 SQLite 事务写最终状态和提示；memory 用例覆盖失败 | C7 独立提交，可整体回退 schema/UI，不影响 C1–C6 |
| NativeTabs Badge 动态更新异常 | 使用 SDK 54 官方 `Badge` 子元素，仅传非数字标记；Provider 单一订阅 | C8 可回退列表标记，数据层仍安全保留 |
| pinch 与详情页滚动冲突 | 独立 fullScreenModal 路由 + GestureHandlerRootView | C5 单独提交，可移除入口和依赖而不动图片详情数据层 |
| 文件与 SQLite 无法跨介质原子删除 | 文件先删；数据库失败时保留“文件缺失”记录供重试 | 删除服务和 UI 分两提交，C10 不先于 C9 |
| 删除当前图片任务写入目标 | running 历史在仓储层硬拒绝，不只依赖按钮禁用 | 仓储测试作为合入门槛 |
