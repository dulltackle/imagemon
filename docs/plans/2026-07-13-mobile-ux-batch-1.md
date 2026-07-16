# 移动端 UX 第一批修复方案：闭环上的断点与硬伤（2026-07-13）

对应盘点报告 `docs/plans/2026-07-13-mobile-ux-audit.md` 的「第一批」六项：**1.1 / 1.2 / 3.1 / 1.4 / 1.5 / 1.3**。

- **基线**：`main` @ v0.10.0（当前分支 `improving-ux`）。
- **总体判断**：六项里 1.1 是独立热修；1.2 与 3.1 各自需要一层新的**可测试纯逻辑 + 存储/仓储改动**；1.3 / 1.4 / 1.5 集中落在同一个文件 `src/promptdex/PromptdexEntryDetailScreen.tsx` 的表单区，应合并成一次结构性重构，避免同一段 JSX 被反复搬动。
- **测试约束**：`apps/mobile/vitest.config.ts` 只收 `src/**/*.test.ts`（不含 `.tsx`），仓库**没有组件测试**，基线也**没有 ESLint**（本批 C2 补上）。因此本方案的纪律是：**凡是可判定的规则一律下沉到纯 `.ts` 模块并配单测**，`.tsx` 只做渲染；UI 行为靠 `scripts/mobile-android-screenshots.mjs` 实机走查验收。

---

## 〇、决策记录（2026-07-13 已确认）

### 决策 1：应用默认规格 —— 数据层四维齐备，**可编辑只放开尺寸**

ADR 0038 规定应用默认规格含**尺寸、质量、格式、数量**四维。当前后三维是硬编码常量（`src/image-tasks/generation.ts:40` 的 `DEFAULT_IMAGE_SPEC = { quality: "auto", format: "png", n: 1 }`）且被下游锁死：

| 维度 | 现状 | 本版处置 |
| --- | --- | --- |
| 尺寸 size | 已可选（3 档） | **可编辑**：设置页可改，表单预填并可按次改写 |
| 质量 quality | 类型即字面量 `"auto"`（`types.ts:38`、`model-client.ts:30`） | 持久化占位，值恒为 `auto`，设置页只读 |
| 格式 format | `ImageResultFormat = "png"`，SQLite `image_results` 带 `CHECK (format IN ('png'))`，文件存储按 `.png` 落盘 | 持久化占位，值恒为 `png`，设置页只读 |
| 数量 n | 一次任务只写一条 `image_results` | 持久化占位，值恒为 `1`，设置页只读 |

**结论**：`app_settings` 落四列（为 ZIP 备份、ADR 0091 的「是否采用备份默认规格」预留结构），但类型层把后三维写成**字面量**（`quality: "auto"; format: "png"; count: 1`）——当前版本对这三维确实只支持一个取值，类型如实反映能力，不做「存了却用不上」的装饰性字段。因此 `generation.ts` / `model-client.ts` / `ImageTaskImageSpecSnapshot` **一律不动**，原计划的「质量维度打通执行链」（原 C4）整条取消。将来放开某一维时，只需改 `default-spec.ts` 里的一个联合类型 + 对应的下游。

### 决策 2：批准修改 `repository.test.ts` 的测试替身（最简方案）

`AppSettings` 加上必填的 `defaultImageSpec` 后，`src/model-configurations/repository.test.ts:31` 里 `MemoryModelConfigurationStore` 的 settings 字面量会类型检查失败。这属于**契约变更导致的测试同步更新**，已获授权。

**改动严格限定为一行**：给该字面量补 `defaultImageSpec: APPLICATION_DEFAULT_IMAGE_SPEC`。不动任何断言、Mock 行为或用例。新增的 `updateDefaultImageSpec` 行为一律用**新增用例**覆盖。

### 决策 3：引入 ESLint + `eslint-plugin-react-hooks`

1.1 的崩溃是**静态可查**的一类错误（条件调用 Hooks），而仓库既无 lint 层也无组件测试——修掉这一处之后没有任何机制阻止它再犯。作为 C1' 提交落地：

- `apps/mobile/eslint.config.mjs`（flat config，**只装 react-hooks 这一条线**，不引 `js.configs.recommended`，避免一上来就产生一堆与本批无关的告警）：

```js
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
```

- devDependencies：`eslint`、`eslint-plugin-react-hooks`、`@typescript-eslint/parser`；
- `apps/mobile/package.json` 加 `"lint": "eslint ."`，根 `package.json` 加 `"mobile:lint"`，并把它接进 `mobile:verify`；
- `exhaustive-deps` 先设 `warn`：既有代码大概率有存量违规，本批不做存量清理，先让 `rules-of-hooks`（error）挡住真正会崩的那一类。**先跑一遍 lint 确认 error 数为 0（1.1 修完后应当为 0），再接进 `mobile:verify`**，否则会把整个 verify 链路一起弄红。

---

## 一、1.1【P0】首次生成成功后条件 Hooks 崩溃

### 现状
`PromptdexEntryDetailScreen.tsx:1068-1086`：`EntryImagesSection` 先 `if (images.length === 0) return null;`（1075 行），之后才调用三个 `useCSSVariable`（1084-1086 行）。条目从「无图」到「首次生成成功」时，`mergeEntryImages`（1366 行）让 `images` 从 0 变 1，**同一组件实例**的 Hooks 数量由 0 变 3，React 直接抛错——正好发生在使用者第一次成功的那一刻。

### 改动
`apps/mobile/src/promptdex/PromptdexEntryDetailScreen.tsx`，把 `EntryImagesSection` 的函数体顺序改为：**先 Hooks → 再 early return → 最后派生值**。

```tsx
function EntryImagesSection({ images, onOpenImage }: {...}) {
  const accentColor = useCSSVariable("--sf-blue");
  const mutedColor = useCSSVariable("--sf-text-2");
  const textColor = useCSSVariable("--sf-text");

  if (images.length === 0) {
    return null;
  }

  const representative = images[0];
  const aspectRatio = ...;
  ...
}
```

同文件顺带自查：`PromptdexMarkdownAccordion`(1187)、`InputDeclarationSection`(1253) 无 early return，安全；`app/history/[id].tsx` 的 `PromptdexEditInputAttachmentSection`(479) / `AttachmentPreview`(546) 也无条件 Hooks，安全。

### 验收
1. `EXPO_PUBLIC_IMAGEMON_SCREENSHOT_MODE` 关闭，配置一个真实图片模型；
2. 进入**从未生成过图片**的内置条目 → 填写必填输入 → 生成；
3. 成功后页面**不崩溃**，生成图片区从无到有出现，代表图为新图。

（这是本批唯一必须靠实机复现验证的项——没有组件测试兜底，别只靠 typecheck 就宣布修好。）

### 成本
小（≤0.5h）。**独立提交，可先行合入。**

---

## 二、1.2【P0】应用默认规格链路（ADR 0037 / 0038）

### 现状
- 表单尺寸初始值硬编码：`PromptdexEntryDetailScreen.tsx:93` `useState<ImageTaskSize>("1024x1024")`；
- 存储层完全没有「应用默认规格」：`app_settings` 只有两个默认模型配置 id + 首次设置时间（`src/storage/index.ts:149-160`），全仓 `grep 应用默认规格` 只在 ADR 文本里命中；
- 设置页只有「模型配置」一个入口（`app/(tabs)/(settings)/settings.tsx:64-94`）。

### 目标链路
`应用默认规格（设置页可改，持久化）` → `进入任务表单时预填` → `本次任务可改（不回写默认）` → `任务快照保存最终执行规格`。

### 改动清单

**(a) 新增纯模块 `src/image-tasks/default-spec.ts` + `default-spec.test.ts`**

只依赖 `./types`（叶子文件，不引入 barrel，避免与 `model-configurations` 形成循环依赖——`generation.ts` 已经反向依赖 `model-configurations`）。

```ts
export interface ApplicationDefaultImageSpec {
  size: ImageTaskSize;
  quality: "auto"; // 当前版本只支持这一个取值（决策 1）
  format: "png";
  count: 1;
}

export const APPLICATION_DEFAULT_IMAGE_SPEC: ApplicationDefaultImageSpec = {
  size: "1024x1024", quality: "auto", format: "png", count: 1,
};

/** 读时容错：任何不被当前版本支持的持久化值都回落到默认值，绝不抛错。 */
export function parseApplicationDefaultImageSpec(raw: {
  size: unknown; quality: unknown; format: unknown; count: unknown;
}): ApplicationDefaultImageSpec;

export function getImageTaskSizeLabel(s: ImageTaskSize): string; // 方图 / 横图 / 竖图，从屏幕文件的 SIZE_LABELS 搬过来
```

只有 `size` 是「取值集合 > 1」的维度，因此 `parse` 对它做白名单校验（`IMAGE_TASK_AVAILABLE_SIZES`），另外三维只要不等于当前唯一合法值就回落。

`parseApplicationDefaultImageSpec` 的容错语义是刻意的：ADR 0091/0092 已确立「不被当前版本支持的规格不得阻断」，读时回落比写时 CHECK 约束更符合这条边界，因此**新列不加 CHECK**。

单测覆盖：合法值原样返回；非法 size/quality/format/count 分别回落；`null`/`undefined` 回落；四维全非法回落到常量。**特别覆盖「备份/旧库里存着 `quality: "high"`」这种未来值 → 回落到 `auto` 且不抛错**（ADR 0091/0092 的读时容错语义）。

**(b) 存储 schema v7**（`src/storage/index.ts`）

- `CURRENT_SCHEMA_VERSION` **6 → 7**，新增 `const SCHEMA_VERSION_WITH_TEMPLATE_REFINEMENT_DRAFTS = 6;`（现在这个值是靠 `CURRENT_SCHEMA_VERSION` 隐式代表的），把现有的 `createSchemaV6` 更名 `createSchemaV7`，其中 `app_settings` 建表语句补四列；
- 新增 `migrateSchemaV6ToV7`：

```sql
ALTER TABLE app_settings ADD COLUMN default_image_size TEXT NOT NULL DEFAULT '1024x1024';
ALTER TABLE app_settings ADD COLUMN default_image_quality TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE app_settings ADD COLUMN default_image_format TEXT NOT NULL DEFAULT 'png';
ALTER TABLE app_settings ADD COLUMN default_image_count INTEGER NOT NULL DEFAULT 1;
```

  （SQLite 的 `ADD COLUMN` 支持 NOT NULL + 常量默认值，无需重建表。）
- 在 `initializeSchema` 的迁移链尾部接上 `if (!appliedVersions.has(CURRENT_SCHEMA_VERSION)) { await migrateSchemaV6ToV7(...) }`，其余结构不动（`createSchemaV7` 仍在迁移后跑一遍，全是 `IF NOT EXISTS`，幂等）。
- `src/storage/index.test.ts` 用的是 `FakeApplicationDatabase` 断言 SQL 文本，**新增**一条「将 v6 schema 迁移到含应用默认规格列的 v7」用例即可，不改既有用例。

**(c) `AppSettings` 与仓储**（`src/model-configurations/types.ts`、`repository.ts`）

- `AppSettings` 增 `defaultImageSpec: ApplicationDefaultImageSpec;`（type-only 深路径 import `../image-tasks/default-spec`）；
- `AppSettingsRow` 增四列；`mapSettingsRow` 用 `parseApplicationDefaultImageSpec` 组装；`updateSettings` 的 UPDATE 语句写四列；
- `createMemoryModelConfigurationStore` 的初始 settings 补 `defaultImageSpec: APPLICATION_DEFAULT_IMAGE_SPEC`；
- `ModelConfigurationRepository` 新增：
  ```ts
  updateDefaultImageSpec(spec: ApplicationDefaultImageSpec): Promise<AppSettings>;
  ```
  实现走 `store.withTransaction`，与 `setDefault` 同构（读 settings → 写回 → 返回新 settings）。
- 按决策 2：`repository.test.ts:31` 测试替身补一行 `defaultImageSpec: APPLICATION_DEFAULT_IMAGE_SPEC`（仅此一行）。`updateDefaultImageSpec` 的行为用**新增用例**覆盖：写入后 `getSettings()` 返回新尺寸；SQLite store 读到非法列值时经 parse 回落（Fake db 覆盖）。

**(d) 设置页入口 + 编辑页**

- `app/(tabs)/(settings)/settings.tsx`：在「模型配置」行下方复制同款 `Pressable` 行，图标 `photo`（`symbol-icon-definitions.ts` 已有），标题「应用默认规格」，副标题 `尺寸 · 质量` 摘要，`onPress={() => router.push("/default-image-spec")}`。
- 新增路由 `app/default-image-spec.tsx`（与 `model-configurations` 一样挂根 Stack，而非 settings tab 内的 Stack——避免 tab 内嵌套导致返回栈割裂）：
  - **尺寸**（唯一可编辑维度）：复用条目详情里的三档选择器控件样式（**注意：顺带修掉 1.6 的 `bg-blue-50` 硬编码，新控件直接用 `bg-sf-fill`/`border-sf-blue`**，别把这处硬编码复制到第二个文件去）；
  - 质量 / 格式 / 数量：只读行，文案「自动（当前版本固定）」「PNG（当前版本固定）」「1 张（当前版本固定）」——如实告知这三维不可调，而不是把它们藏起来；
  - 保存：`await repository.updateDefaultImageSpec({ ...APPLICATION_DEFAULT_IMAGE_SPEC, size })` → `replaceSettings(next)`（`src/app-state/index.tsx:151` 已有 `replaceSettings`），成功后 `router.back()`。
- `app/_layout.tsx` 的 Stack 加 `<Stack.Screen name="default-image-spec" options={{ title: "应用默认规格" }} />`。

**(e) 执行链不动**

按决策 1，`generation.ts` / `model-client.ts` / `ImageTaskImageSpecSnapshot` **零改动**：任务快照里的 `quality/format/n` 继续由 `DEFAULT_IMAGE_SPEC`（`generation.ts:40`）提供，与应用默认规格中那三维的取值恒等。表单只把 `size` 传下去，签名不变。

**(f) 表单预填**（在第五节的表单重构里一起落）

`PromptdexEntryDetailScreen.tsx:93` 的硬编码改为读应用默认规格：
```tsx
const [size, setSize] = useState<ImageTaskSize>(
  () => runtime.settings.defaultImageSpec.size,
);
```
并在条目加载 effect（119-192 行）里随条目切换 `setSize(runtime.settings.defaultImageSpec.size)`——**每次进入表单都回到应用默认规格**；本次任务改尺寸不回写默认（ADR 0037/0038 的语义）。表单里的区块标题从「尺寸」改为「图片规格」，下方补一行灰字「质量 自动 · 格式 PNG · 数量 1」，让本次任务的完整执行规格在提交前可见（ADR 0038「执行前可以修改本次任务规格」的另一半：不可改的部分也要能看见）。

### 明确不做（并说明理由）
**ADR 0039 的「图片规格 × 模型能力兼容校验」不在本批。** 0039 的触发条件是「选择或**切换**图片模型配置后」，而当前表单**不提供模型切换**（只读展示默认图片模型配置，`renderModelConfiguration()` 609 行）。校验的前提是 ADR 0216 的「本地图片模型能力档案」先落地（`@imagemon/core` 里有 `IMAGE_MODEL_CAPABILITIES`，但移动端未接）。这两件事一起做才有意义，单列 roadmap。

### 成本
中（1.5–2 天，含 e 项）。

---

## 三、3.1【P1】失败 / 状态未知任务的「重新填写」（ADR 0026 / 0187）

### 现状
`app/history/[id].tsx` 对失败任务只展示「失败摘要」区块（168-188 行），没有任何回到条目表单的动作。使用者只能自己回图鉴里找条目、重抄输入。

### 领域约束（直接来自 ADR）
- **0026 / 0187**：失败与状态未知**同一套规则**——仅当「当前图鉴条目仍存在」且「历史任务快照可被当前版本解析出可匹配输入」时提供入口；打开**新的任务表单**、把历史输入作为**可编辑预填建议**；确认后创建**全新任务历史**，原记录不变。
- **0012**：绝不拿任务快照里的完整提示词直接再调模型。
- **0187**：重新填写**不附带特殊警示**（不提「可能已计费」）。

### 改动清单

**(a) 新增纯模块 `src/image-tasks/refill.ts` + `refill.test.ts`**

```ts
export type TaskRefillIneligibleReason =
  | "status_not_refillable"   // 非 failed / unknown
  | "not_promptdex_task"      // manual 快照
  | "entry_missing"           // 当前合并图鉴里已无同名条目
  | "entry_incompatible";     // taskType 变了，或快照输入与当前输入声明无交集

export interface TaskRefillPlan {
  entryName: string;
  prefillInputs: Record<string, string>;   // 仅保留当前模板仍声明的文本输入
  droppedInputNames: string[];             // 快照里有、当前模板已删除的输入
  missingRequiredInputNames: string[];     // 当前必填、快照里没有的输入
  requiresEditImage: boolean;              // edit 条目：需要重新选择输入图片
}

export type TaskRefillResolution =
  | { status: "eligible"; plan: TaskRefillPlan }
  | { status: "ineligible"; reason: TaskRefillIneligibleReason };

export function resolveTaskRefill(input: {
  history: ImageTaskHistory;
  entry: { template: PromptdexTemplate; sourceType: PromptdexEntrySourceType } | null;
}): TaskRefillResolution;
```

判定规则（把「可匹配输入」定死，别留模糊地带）：
1. `history.status` ∈ `{failed, unknown}`，否则 `status_not_refillable`；
2. `snapshot.source === "promptdex"`，否则 `not_promptdex_task`；
3. `entry === null`（按 `snapshot.promptdexEntry.name` 在**合并图鉴**里查，名称全局唯一 → 按名匹配足够），否则 `entry_missing`；
4. `entry.template.taskType !== snapshot.promptdexEntry.taskType` → `entry_incompatible`；
5. 当前模板的文本输入名集合（`getTextPromptdexInputs`）与 `snapshot.taskInputs` 的键集合**交集为空** → `entry_incompatible`（快照完全对不上当前输入声明 = 不可解析）；
6. 其余为 eligible：`prefillInputs` 只取交集部分，`droppedInputNames` / `missingRequiredInputNames` 供 UI 说明；edit 条目 `requiresEditImage = true`。

单测覆盖：六条规则各一例；输入声明增删各一例（dropped / missingRequired）；`completed` 任务不给入口；manual 快照不给入口；edit 条目返回 `requiresEditImage`。

**(b) 历史详情接入**（`app/history/[id].tsx`）

- 加载 effect（64-94 行）里追加：若 `history.snapshot.source === "promptdex"`，`await runtime.promptdexCatalogService.get(snapshot.promptdexEntry.name)`，把结果一起塞进 `state`；
- 渲染：`resolveTaskRefill({ history, entry })` 为 eligible 时，在失败摘要区块**下方**给主按钮「重新填写」（沿用 `bg-sf-blue` 主按钮样式），`onPress`：
  ```ts
  router.push({
    pathname: "/promptdex/[name]",
    params: { name: plan.entryName, refillFromHistory: history.id },
  });
  ```
- ineligible 时**不渲染按钮**；`entry_missing` / `entry_incompatible` 额外给一行灰色说明（「当前图鉴条目已不存在，无法重新填写。」/「当前图鉴条目的输入声明已变更，无法从这条历史预填。」）——ADR 只要求不给入口，但静默消失会让人以为是 bug。
- **不加任何计费/重复警示**（ADR 0187 明写）。

**(c) 条目详情消费预填**（在第五节的表单重构里一起落）

- 读 `useLocalSearchParams<{ name?: string; refillFromHistory?: string }>()`；
- 在条目加载 effect 内、`setTaskInputs` 之前：若有 `refillFromHistory`，`await runtime.imageTaskRepository.getHistory(id)` → **用刚加载的当前条目重跑一次 `resolveTaskRefill`**（消费时点再校验一次，防止用户在历史页停留期间条目被改动）→ eligible 则用 `plan.prefillInputs` 填 `taskInputs`，并 `setNotice("已按历史任务预填输入，可修改后重新执行。")`；ineligible 则正常空表单 + 一行说明；
- **规格不跟历史走**：`taskSpec` 仍取应用默认规格（ADR 0038「表单默认使用应用默认规格」；0026 只承诺预填**输入**）。这是有意的，别顺手把 `snapshot.imageSpec` 填进去。
- **edit 条目的输入图片本版不预填**：内部附件允许缺失（ADR 0017），且 `ImageTaskInternalAttachmentSnapshot` 的 `width/height/byteSize` 可为 `null`，而 `PickedEditInputImage` 要求非空——重建代价与失败面都不划算。UI 提示「请重新选择输入图片」，列为已知限制。

### 成本
中（1–1.5 天）。

---

## 四、1.4【P1】任务输入编辑：两步变一步

### 现状
`PromptdexEntryDetailScreen.tsx:978-1063`。Modal 打开后是**只读预览态**，必须再点右上「编辑」（1015-1030 行）才出现 `TextInput`；`keyboardDidHide` 监听（230-242 行）会把状态又打回预览态。移动端多一次点击、零收益。

### 改动
删掉 `isEditingInputText` 这条状态线：
- 删 `useState` (104 行)、`keyboardDidHide` effect（230-242 行）、`beginTaskInputTextEditing` / `finishTaskInputTextEditing`（318-325 行）；
- `openTaskInputEditor` 只 `setEditingInputName(inputName)`；
- Modal 内**只保留 `TextInput` 分支**（`autoFocus multiline`），删掉只读 `ScrollView` 分支（1045-1060 行）；
- 右上角按钮从「编辑 / 完成」二态改为固定「完成」，`onPress={closeTaskInputEditor}`（它已经 `Keyboard.dismiss()` + 清空 `editingInputName`）。

### 验收 / 风险
Android 上 `presentationStyle="pageSheet"` 会被忽略（全屏 Modal），且 `autoFocus` 在 Modal 里偶发不弹键盘。**必须实机确认**：点输入卡片 → Modal 打开即出现光标与键盘 → 输入 → 点「完成」回到表单且内容已写入。若 autoFocus 不稳，回退方案是在 Modal `onShow` 里 `requestAnimationFrame(() => inputRef.current?.focus())`。

### 成本
小（≤2h，含实机验证）。

---

## 五、1.5【P1】提交按钮禁用原因 + 1.3【P1】表单信息架构

这两项与 1.2(f)、3.1(c) 落在同一段 JSX，**合并为一次重构**执行。

### 5.1 —— 1.5：禁用原因

**现状**：`canSubmit`（289-296 行）把六个条件揉成一个布尔量，按钮只变灰（954-975 行），只有「模型未配置」有橙色提示。

**改动**：新增纯模块 `src/promptdex/task-form-submit-state.ts` + 单测。

```ts
export type TaskSubmitBlockKind =
  | "loading_model_configuration"
  | "missing_model_configuration"   // 模型卡已有橙色提示 + CTA，按钮上方不重复渲染
  | "unsupported_template"          // 蒙版编辑条目
  | "missing_edit_image"
  | "missing_required_inputs"
  | "picking_edit_image"
  | "submitting"
  | "model_call_in_progress";

export interface TaskSubmitState {
  canSubmit: boolean;
  block: { kind: TaskSubmitBlockKind; message: string } | null;
}

export function getTaskSubmitState(input: {
  taskType: "generate" | "edit";
  isExecutableEditTemplate: boolean;
  isUnsupportedMaskEditTemplate: boolean;
  missingRequiredInputNames: string[];
  hasPickedEditImage: boolean;
  hasReadyImageConfiguration: boolean;
  isLoadingDefaultConfiguration: boolean;
  isPickingEditImage: boolean;
  isSubmitting: boolean;
  activeModelCallType: ModelCallType | null;
}): TaskSubmitState;
```

- 优先级固定：`submitting` > `model_call_in_progress` > `unsupported_template` > `loading_model_configuration` > `missing_model_configuration` > `missing_edit_image` > `missing_required_inputs` > `picking_edit_image`（一次只讲一个最该先解决的原因）。
- 文案示例：必填缺失 → `必填输入 content 未填写。`（多个则 `content、title`）；锁被占用 → 复用 `getModelCallStatusLabel()`（`src/model-calls/index.tsx:100`）→ `已有模型调用进行中：模板提炼。`
- 屏幕侧：`canSubmit` 与 `disabled` 全部改读这个函数；按钮**上方**渲染 `block.message`（`missing_model_configuration` 除外，模型卡已经讲过一遍，别重复）。
- 单测覆盖每个 kind 各一例 + 优先级冲突两例（提交中 + 缺必填 → 报「提交中」）。

### 5.2 —— 1.3：信息架构与吸底提交

**现状**首屏顺序：条目信息卡 → 生成图片区（大图 + 竖排缩略列表，占满一屏多）→ Promptdex Markdown → 图片模型 → 任务输入 → 尺寸 → 提交按钮。**到这一屏的核心意图是发起任务，首屏却看不到任何输入或 CTA。**

**目标顺序**（`return` 块 656-1064 行重排）：

```
[ScrollView]
  1. 条目信息卡（名称/来源/类型/说明）—— 保留
  2. 图片模型（只读）
  3. 编辑输入（仅 edit 条目）
  4. 任务输入
  5. 图片规格（尺寸 + 质量；来自 1.2）
  6. 失败 / 提示反馈
  7. 生成图片（横向缩略条，见下）
  8. Promptdex Markdown（折叠，保持默认收起）
[吸底 Footer]
  block.message（若有） + 提交按钮
```

- **生成图片区收为横向缩略条**：`EntryImagesSection` 的大图 + 竖排列表，改为 `ScrollView horizontal` 的方形缩略图条（每张点击进图片详情），区块标题右侧给张数。这同时消化掉盘点里的 **1.7（代表图展示两遍）** 和 **1.8（大图不可点）**——它们本在第三批，但按新结构它们会自然消失，不必留到以后再返工。
- **吸底提交**：外层包 `<View className="flex-1 bg-sf-bg-2">`，`ScrollView` 负责滚动（`contentContainerClassName` 底部留白），下面并排一个 Footer `<View className="border-t border-sf-separator bg-sf-bg-3 px-5 pt-3">`，`paddingBottom: Math.max(insets.bottom, 12)`（`useSafeAreaInsets`，`react-native-safe-area-context` 已在依赖里但全仓尚未使用——**首次使用，需实机确认 expo-router 的 Navigation 容器已提供 SafeAreaProvider**；若拿不到 inset，退化为固定 `pb-5`）。
- Markdown 手风琴保持原样，只是移到底部（盘点建议「移至更深层级」，但独立页面会打断「看条目 → 抄 Markdown」的连贯性，**移到底部即可满足首屏诉求**，不新开页面）。

### 成本
1.5 小 + 1.3 中，合并执行 ≈ 1–1.5 天。

---

## 六、执行顺序与提交切分

| # | 提交 | 内容 | 依赖 |
| --- | --- | --- | --- |
| C1 | `fix(mobile): 修复条目详情生成图片区条件 Hooks 崩溃` | 1.1 | 无，**可立即合入** |
| C2 | `chore(mobile): 引入 ESLint 与 react-hooks 规则` | 决策 3 | C1（先修完再接 verify，避免 lint 一上来就红） |
| C3 | `feat(mobile): 应用默认规格数据层（schema v7 + 仓储）` | 1.2 a/b/c | 无 |
| C4 | `feat(mobile): 设置页新增应用默认规格编辑入口` | 1.2 d | C3 |
| C5 | `feat(mobile): 新增任务重新填写资格判定` | 3.1 a（纯模块 + 单测） | 无 |
| C6 | `feat(mobile): 历史详情支持重新填写` | 3.1 b | C5 |
| C7 | `refactor(mobile): 重构图鉴条目任务表单` | 1.3 + 1.4 + 1.5 + 1.2(f) + 3.1(c) | C3、C5 |

C1 → C2 先走完（拿到静态守卫），C3 与 C5 之间无依赖可并行；C7 是唯一的大块，进去之前把 C3/C5 的纯模块和仓储都准备好，避免同一段 JSX 被改两轮。原「质量维度打通执行链」提交按决策 1 取消。

---

## 七、验证

**每个提交**：`npm run mobile:verify`（C2 之后 = **lint** + typecheck + vitest + 图标静态检查）。

**实机走查（Android 模拟器 `imagemon-avd`，必须做）**：
1. **1.1**：真实模型 + 从未生成过的条目 → 首次生成成功不崩溃；
2. **1.2**：设置 → 应用默认规格改成「竖图」→ 进任意条目，表单已预填竖图 → 本次改回方图并执行 → 任务历史详情的「图片规格」显示方图（本次改动**没有**回写应用默认规格，设置页仍是竖图）；
3. **1.4**：点输入卡片 → Modal 直接出现键盘与光标；
4. **1.5**：清空必填输入 → 按钮上方显示「必填输入 content 未填写。」；发起一次模板提炼占住全局锁 → 条目表单按钮显示「已有模型调用进行中：模板提炼。」；
5. **1.3**：首屏（不滚动）即可看到任务输入区与吸底提交按钮；
6. **3.1**：造一条失败任务（把 Base URL 改坏后执行）→ 历史详情出现「重新填写」→ 点击进入条目表单，历史输入已预填、可编辑 → 执行后产生**新的**任务历史，原失败记录不变。

截图仍按既有约定存 `apps/mobile/.expo/screenshots/android/`，**不入库**。

---

## 八、本批之后顺带被消化 / 明确留下的项

- **顺带消化**：1.6（`bg-blue-50` 硬编码，在 1.2 的规格选择器里一并换成语义色）、1.7（代表图展示两遍）、1.8（大图不可点）——它们原属第三批，但新结构下不修反而要额外写代码去保留旧行为。
- **明确留下**：1.9（输入说明文案出现两遍）留给第三批的文案统一；ADR 0039 的规格 × 模型能力兼容校验留给「模型能力档案（ADR 0216）落地」时一起做；`format` / `n` 的可编辑化留给后续（需要动 `image_results` 的 CHECK 约束与多结果模型）。
