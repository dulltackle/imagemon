# 移动端内置图鉴生成任务竖切执行计划

本文记录移动端下一条开发闭环的可执行方案。目标是在当前“生成任务 -> 任务历史/任务快照 -> 图片结果”资产链路已经功能闭合的基础上，把手机端主入口切回提示词图鉴，并先闭合“内置图鉴条目 -> 模板输入 -> 完整提示词 -> 生成任务 -> 任务历史/图片结果”的最小链路。

## 背景结论

- 当前移动端生成任务资产闭环已按源码事实功能闭合：创建页、任务历史列表/详情、图片结果列表/详情、SQLite 仓储、应用内部图片文件保存、启动时遗留进行中任务转状态未知、全局模型调用锁、模型配置快照、错误摘要和瞬时失败重试已经落地。
- `README.md` 与 `docs/current-architecture.md` 仍把该能力列为下一阶段，属于文档滞后，不代表真实实现边界。
- 下一条主闭环选择 Promptdex 内置图鉴条目只读浏览与生成任务执行。
- 业务调用提示排在本闭环之后；模板提炼排在业务调用提示之后；ZIP 备份恢复继续后延；薄弱覆盖率暂不作为独立开发方向。

## 目标

完成一个本地可用的 Promptdex 生成任务竖切：

- 首个 Tab 从“创建”切回“图鉴”。
- 图鉴页展示内置图鉴条目。
- `taskType = "generate"` 的可用图鉴条目可以进入任务表单。
- `taskType = "edit"` 的图鉴条目可浏览但暂不可执行。
- 任务表单根据图鉴条目的文本类模板输入收集任务输入。
- 应用使用 `@imagemon/core` 渲染完整提示词。
- 应用使用就绪默认图片模型配置发起生成任务。
- 生成成功后沿用现有图片结果保存和任务历史完成逻辑。
- 生成失败后沿用现有错误摘要和任务历史失败逻辑。
- 任务历史详情能展示旧 manual 任务快照和新的 Promptdex 任务快照。

## 范围内

- `apps/mobile` 内的 Expo React Native 实现。
- 内置图鉴条目的只读加载、列表展示和详情/任务入口。
- 仅执行生成任务图鉴条目，不执行编辑任务图鉴条目。
- 仅支持文本类模板输入；不支持 `image` 或 `mask` 文件输入。
- 复用 `@imagemon/core` 的 Promptdex 模板解析与渲染。
- 将 Promptdex 任务快照写入现有 `image_task_histories.snapshot_json`。
- 兼容已有 `source: "manual"` 的任务快照。
- 复用现有生成任务执行能力：图片模型调用、文件保存、图片结果记录、错误摘要、凭据缺失处理和全局模型调用锁。
- 复用当前图片规格选择边界：尺寸可选，质量、格式和数量固定。
- 移动端测试覆盖图鉴条目加载、模板输入校验、完整提示词渲染、Promptdex 任务快照写入和旧快照兼容。

## 范围外

- 不扩展 Promptdex Markdown 契约。
- 不实现条目展示信息：标题、用途说明、图鉴分类、搜索标签和封面示例图均不在本闭环落地。
- 不新增内置图鉴条目；本闭环接受主要使用现有 `light-infographic` 验证生成任务路径。
- 不实现个人图鉴条目。
- 不实现 Promptdex Markdown 导入导出。
- 不实现模板提炼。
- 不实现编辑任务、图片选择、mask、输入图片校验或任务历史内部附件。
- 不实现业务调用提示。
- 不实现 ZIP 备份恢复。
- 不实现图片结果或任务历史删除。
- 不实现重试、再次执行、历史重新填写或完整提示词复制入口。
- 不实现真实网络自动化测试。

## 关键决策

- 本闭环把手机端产品主入口从手动完整提示词“创建”切回“图鉴”，符合提示词图鉴作为产品主轴的方向。
- 当前手动完整提示词入口视为资产链路竖切的过渡入口；完成本闭环后不继续作为主入口暴露。
- 图鉴条目的任务类型仍由 `inputs.image` 推断，不新增独立任务类型字段，延续 ADR 0001。
- 只执行生成任务图鉴条目。编辑任务图鉴条目可展示但禁用执行，后续单独进入编辑任务闭环。
- 本闭环不扩展 Promptdex Markdown 契约，也不在移动端硬编码条目展示信息。
- 本闭环采用收窄版 Promptdex 任务快照：保存图鉴条目执行语义和任务输入，不保存条目展示信息。
- 未来若补充条目展示信息，当前历史按“无展示信息的 Promptdex 快照”做 legacy 兼容，不尝试回填执行时分类、搜索标签或封面示例。
- Promptdex 生成任务仍先创建进行中的任务历史并保存任务快照，再执行模型调用，延续 ADR 0023。
- 任务快照保存非敏感模型配置快照，不保存 API Key 或安全存储引用，延续 ADR 0013。
- 任务历史只读解释执行事实，不从当前图鉴条目追随或替换历史身份，延续 ADR 0098。
- 图片规格属于图片任务，不属于图鉴条目，延续 ADR 0037。
- 业务调用提示在本闭环之后补，不阻塞图鉴生成任务主链路。

## 内置图鉴条目来源

首版直接使用应用包内随版本提供的内置图鉴条目文件，来源与现有 Promptdex Skill 内置模板保持一致。

实现时应优先复用 `@imagemon/core` 的解析规则，不在移动端重新实现一套不一致的 Promptdex 解析器。移动端适配层负责把应用包内的模板源加载为 `PromptdexTemplateSource`，再交由 core 解析、校验、列表化和渲染。

规则：

- 内置图鉴条目只读。
- 当前版本应用只加载当前包内置条目，不保留旧版本内置条目。
- 同名冲突、个人图鉴覆盖、导入冲突等规则不在本闭环实现，因为本闭环没有个人图鉴条目。
- `taskType = "edit"` 的内置图鉴条目进入只读展示和不可执行状态。

## Promptdex 任务快照结构

`snapshot_json` 需要兼容旧 manual 快照和新 Promptdex 快照。建议通过 `source` 区分：

```ts
type MobileImageTaskSnapshot =
  | ManualImageTaskSnapshot
  | PromptdexImageTaskSnapshot;
```

收窄版 Promptdex 快照建议结构：

```json
{
  "source": "promptdex",
  "promptdexEntry": {
    "name": "light-infographic",
    "description": "将一段文字转换为浅色、清爽、结构清晰的解释性信息图",
    "version": 1,
    "sourceType": "built-in",
    "taskType": "generate",
    "inputs": {
      "content": {
        "required": true,
        "description": "主要内容"
      },
      "title": {
        "required": false,
        "description": "可选标题"
      }
    },
    "body": "模板正文"
  },
  "taskInputs": {
    "content": "本次任务输入",
    "title": "可选标题"
  },
  "imageSpec": {
    "size": "1024x1024",
    "quality": "auto",
    "format": "png",
    "n": 1
  },
  "modelConfiguration": {
    "type": "image",
    "baseUrl": "https://api.openai.com/v1",
    "modelName": "gpt-image-2"
  },
  "fullPrompt": "渲染后的完整提示词"
}
```

规则：

- `promptdexEntry` 保存执行时图鉴条目的核心执行语义。
- `sourceType` 本闭环只会写入 `built-in`，但结构保留未来 `personal` 空间。
- `taskInputs` 只保存本次使用者填写的模板输入。
- `fullPrompt` 只读展示，不作为再次执行图片任务的直接输入。
- 不保存 API Key、安全存储引用、封面示例图、图鉴分类、搜索标签或其他条目展示信息。
- 历史详情展示旧 manual 快照时继续沿用当前显示规则；展示 Promptdex 快照时优先显示图鉴条目名称、来源类型、description、模板输入、图片规格、模型配置快照、完整提示词和错误摘要。

## 页面规则

### 图鉴 Tab

- Tab 文案为“图鉴”。
- 显示内置图鉴条目列表。
- 列表项显示图鉴条目名称、description 和任务类型标识。
- 生成任务图鉴条目显示可执行入口。
- 编辑任务图鉴条目显示暂不可执行状态。
- 空状态和加载失败状态必须可解释。
- 本闭环不实现搜索、分类筛选、封面示例图或个人图鉴管理。

### 图鉴条目详情 / 任务表单

- 展示图鉴条目名称、description、任务类型和输入声明。
- 对 `taskType = "generate"` 的条目显示任务输入表单。
- 对 `taskType = "edit"` 的条目只读展示，并提示编辑任务后续支持。
- 必需文本输入为空时阻止提交，不创建任务历史。
- 可选文本输入为空时不写入完整提示词的当前任务输入区块。
- 图片规格沿用当前尺寸选择；质量、格式和数量固定。
- 缺少就绪默认图片模型配置时，不创建任务历史，提示前往模型配置。
- 有模型调用进行中时禁止提交，并沿用全局模型调用锁。
- 提交后显示等待态；完成或失败后不自动跳转。

### 历史列表

- 继续展示时间、任务状态、尺寸和摘要。
- 对 Promptdex 快照，摘要可优先使用图鉴条目名称或完整提示词/输入摘要。
- 对 manual 快照，保持现有展示。
- 不新增业务调用提示、未查看标记或重新填写入口。

### 历史详情

- 支持 manual 快照和 Promptdex 快照分支渲染。
- Promptdex 快照展示图鉴条目名称、来源类型、description、任务输入、图片规格、模型配置快照和完整提示词。
- 失败时展示错误摘要。
- 完成时展示关联图片结果入口。
- 不提供删除、重试、再次执行、历史重新填写或复制完整提示词。

### 图片列表与图片详情

- 继续沿用当前图片结果列表和详情。
- 关联历史为 Promptdex 快照时，图片详情中的关联任务摘要可显示图鉴条目名称或任务输入摘要。
- 不新增导出、分享、重命名、备注或编辑。

## 自动化测试策略

- 不打真实网络。
- 不需要真实 API Key。
- 图鉴条目加载使用内置测试模板源或 fixture。
- 图片模型调用继续使用 mock `fetch` 或注入式 `ImageModelClient`。
- 文件保存继续使用可替换文件存储适配器。
- 时间、ID 生成器和模型调用适配器继续可注入。

重点覆盖：

- 内置图鉴条目可被加载并按 `taskType` 区分生成任务和编辑任务。
- 编辑任务图鉴条目不可执行，不会创建任务历史。
- 生成任务图鉴条目按输入声明校验必需输入。
- 可选输入为空时不进入完整提示词。
- 成功执行写入 Promptdex 任务快照、任务历史、图片结果和图片文件。
- 模型调用失败写入安全错误摘要，且任务快照仍可解释执行时图鉴条目。
- 缺少就绪默认图片模型配置时不创建任务历史。
- 凭据缺失时创建失败历史并清除就绪状态和默认引用。
- 历史详情兼容旧 manual 快照。
- `npm run mobile:verify` 通过。

## 验证入口

```bash
npm run mobile:typecheck
npm run mobile:test
npm run mobile:verify
```

如果本闭环改动 `packages/core` 的 Promptdex 快照类型、渲染辅助或导出类型，还需要运行：

```bash
npm run typecheck
npm test
```

如果改动 Promptdex Skill 自包含脚本或内置模板资产，必须额外运行：

```bash
npm run build:skill
npm run verify
```

当前计划不要求改动 Promptdex Markdown 契约或内置模板资产，因此默认以 `mobile:verify` 为主验收入口。

## 提交分解

每完成一个任务后都单独提交。提交信息统一使用中文。

### 任务 0：提交本计划并勘误阶段文档

修改范围：

- `docs/plans/mobile-promptdex-built-in-generation-slice.md`
- 可选：`README.md`
- 可选：`docs/current-architecture.md`

实现要点：

- 记录当前生成任务资产闭环已按源码事实功能闭合。
- 记录下一闭环选择内置图鉴生成任务。
- 不在本任务修改代码。

验收：

```bash
git diff --check
```

提交点：

```bash
git add docs/plans/mobile-promptdex-built-in-generation-slice.md README.md docs/current-architecture.md
git commit -m "记录移动端内置图鉴生成任务计划"
```

### 任务 1：定义移动端 Promptdex 快照类型与兼容读取

修改范围：

- `apps/mobile/src/image-tasks`
- 必要测试文件。

实现要点：

- 扩展移动端任务快照类型，支持 `source: "manual"` 和 `source: "promptdex"`。
- 保持现有 manual 快照读取兼容。
- 增加 Promptdex 快照 clone、序列化和解析测试。
- 不修改 SQLite 表结构。

验收：

```bash
npm run mobile:test
npm run mobile:typecheck
```

提交点：

```bash
git add apps/mobile/src/image-tasks apps/mobile
git commit -m "支持 Promptdex 任务快照"
```

### 任务 2：实现内置图鉴条目加载适配层

修改范围：

- `apps/mobile/src/promptdex` 或同等目录。
- 必要测试文件。
- 如需复用 core 辅助类型，可小范围改动 `packages/core`。

实现要点：

- 从应用包内加载内置 Promptdex 模板源。
- 使用 `@imagemon/core` 解析、校验和列表化图鉴条目。
- 将生成任务和编辑任务区分为可执行与暂不可执行。
- 不实现个人图鉴条目、搜索索引、展示信息或封面示例图。

验收：

```bash
npm run mobile:test
npm run mobile:typecheck
```

若改动 core：

```bash
npm run typecheck
npm test
```

提交点：

```bash
git add apps/mobile/src/promptdex packages/core apps/mobile
git commit -m "实现内置图鉴条目加载"
```

### 任务 3：实现图鉴 Tab 与条目详情入口

修改范围：

- `apps/mobile/app/(tabs)/_layout.tsx`
- `apps/mobile/app/(tabs)/index.tsx`
- `apps/mobile/app/promptdex` 或同等路由。
- 共享 UI 或 hooks。

实现要点：

- 将首个 Tab 文案改回“图鉴”。
- 展示内置图鉴条目列表。
- 生成任务条目进入任务表单。
- 编辑任务条目只读展示并提示后续支持。
- 保留缺省、加载中和加载失败状态。

验收：

```bash
npm run mobile:typecheck
```

提交点：

```bash
git add apps/mobile/app apps/mobile/src
git commit -m "实现内置图鉴浏览入口"
```

### 任务 4：实现 Promptdex 生成任务表单和执行服务

修改范围：

- `apps/mobile/app/promptdex`
- `apps/mobile/src/image-tasks`
- `apps/mobile/src/promptdex`
- 必要测试文件。

实现要点：

- 根据图鉴条目的文本类输入声明生成表单。
- 校验必需输入。
- 使用 `@imagemon/core` 渲染完整提示词。
- 构建 Promptdex 任务快照。
- 复用现有图片生成执行、文件保存、任务历史和图片结果仓储。
- 全局模型调用锁覆盖 Promptdex 生成任务。
- 缺少就绪默认图片模型配置时不创建任务历史。

验收：

```bash
npm run mobile:test
npm run mobile:typecheck
```

提交点：

```bash
git add apps/mobile/app apps/mobile/src
git commit -m "实现 Promptdex 生成任务执行"
```

### 任务 5：更新历史与图片关联展示

修改范围：

- `apps/mobile/app/(tabs)/history.tsx`
- `apps/mobile/app/history/[id].tsx`
- `apps/mobile/app/(tabs)/images.tsx`
- `apps/mobile/app/images/[id].tsx`
- 必要共享格式化逻辑。

实现要点：

- 历史列表兼容 manual 和 Promptdex 快照摘要。
- 历史详情展示 Promptdex 快照中的图鉴条目名称、来源类型、description、任务输入、完整提示词和模型配置快照。
- 图片详情关联历史摘要兼容 Promptdex 快照。
- 不新增复制、重试、再次执行或删除入口。

验收：

```bash
npm run mobile:typecheck
```

提交点：

```bash
git add apps/mobile/app apps/mobile/src
git commit -m "展示 Promptdex 任务历史"
```

### 任务 6：竖切收尾验证与文档勘误

修改范围：

- 必要的测试补充。
- 可选：`README.md`
- 可选：`docs/current-architecture.md`

实现要点：

- 确认本闭环不引入范围外能力。
- 补齐 Promptdex 快照、图鉴加载、任务执行和历史兼容测试。
- 勘误阶段文档：当前已进入 Promptdex 内置图鉴生成任务阶段。

验收：

```bash
npm run mobile:verify
git diff --check
git status --short
```

如改动 core 或 Skill 资产，按“验证入口”补跑对应命令。

提交点：

```bash
git add apps/mobile packages/core README.md docs/current-architecture.md
git commit -m "完成内置图鉴生成任务竖切"
```

## 后续路线

本闭环完成后的路线顺序：

1. 业务调用提示：图片任务成功、失败或状态需要处理时，在相关入口和列表项保留布尔可发现性提示，进入详情后清除。
2. 模板提炼：从外部完整提示词和计划用途生成提炼方案，确认后写入个人图鉴条目；保持单发提炼，不引入多轮澄清。
3. ZIP 备份恢复：继续后延。接受在 ZIP 落地前，个人图鉴条目、任务历史、任务快照和图片结果无法跨设备迁移的风险。
4. 编辑任务：后续单独评估图片选择、输入图片校验、内部附件、`/images/edits` 调用和编辑任务快照。
5. 薄弱覆盖率：暂不作为独立开发方向；在相关闭环触碰对应代码时补齐。

## 实施纪律

- 测试失败时修复生产代码，不修改测试、断言、Mock、Fixture 或跳过测试来规避失败。
- 本闭环不扩展 Promptdex Markdown 契约；如果实现中发现必须扩展契约，应先停下确认并更新计划。
- 如果发现现有 ADR 与本计划冲突，先新增或修订 ADR，再继续编码。
- 不为了移动端竖切改动 Skill 自包含 CLI 发布链路，除非实际修改了 Promptdex runtime 或内置模板资产。
- 移动端不执行 Skill 自带 CLI，也不依赖 Node 文件系统安全模型。
- 不引入真实网络、真实 API Key 或外部模型服务作为自动化测试前提。
