# 移动端生成任务、任务历史与图片结果竖切执行计划

本文记录下一阶段移动端开发的可执行方案。目标是在不接入 Promptdex 图鉴的前提下，先闭合“生成任务 -> 任务历史/任务快照 -> 图片结果”这条最小资产链路。

## 目标

完成一个本地可用的移动端竖切：

- “创建”Tab 提供提示词输入框和尺寸选择。
- 设备使用者使用就绪默认图片模型配置发起生成任务。
- 应用先创建进行中的任务历史并保存任务快照，再调用图片模型。
- 生成成功后保存应用内部图片结果，并将任务历史标记为完成。
- 生成失败后保存结构化错误摘要，并将任务历史标记为失败。
- 应用启动时将遗留的进行中任务历史转为状态未知。
- “历史”Tab 提供任务历史列表和只读详情。
- “图片”Tab 提供图片结果列表和只读详情。

## 范围内

- `apps/mobile` 内的 Expo React Native 实现。
- 移动端生成任务创建页，将当前第一个 Tab 文案从“图鉴”调整为“创建”。
- 手动输入完整提示词，不通过图鉴条目、提示词模板或模板输入构建提示词。
- 只支持生成任务，不支持编辑任务。
- 图片规格仅开放尺寸选择；质量、格式和数量固定。
- 任务历史、任务快照、图片结果的 SQLite schema、仓储和测试。
- 移动端图片模型调用 `fetch` 适配层，不复用根包 CLI 或 Node OpenAI SDK。
- 应用内部文件目录中的图片文件保存。
- 当前 React runtime 生命周期内的业务模型调用继续执行。
- 全局模型调用锁扩展到生成任务，阻止并发模型调用。
- 历史列表、历史详情、图片列表和图片详情。
- 安全错误摘要归一化。

## 范围外

- Promptdex 图鉴条目浏览、选择、渲染或导入导出。
- 模板提炼。
- 编辑任务、图片选择、mask 或输入图片校验。
- 图片数量选择；本阶段固定 `n = 1`。
- 质量、格式、背景、压缩率等高级规格选择。
- 图片结果或任务历史删除。
- 图片导出到相册、系统分享、重命名、备注、裁剪或编辑。
- 业务调用提示、红点、未查看状态或查看后清除规则。
- 系统后台执行；应用被杀后不继续等待模型调用。
- ZIP 备份恢复。
- 真实网络自动化测试。

## 关键决策

- 本阶段不新增领域概念；输入框内容直接作为本次图片任务的完整提示词。
- 只支持生成任务。编辑任务留到图片资产链路稳定后再评估。
- `n` 固定为 1。数据模型可以保留一对多扩展空间，但 UI 不开放数量选择。
- 尺寸开放 `1024x1024`、`1536x1024`、`1024x1536` 三个选项。
- 质量固定为 `auto`。
- 格式固定为 `png`。
- 图片结果保存到应用内部文件目录，使用应用生成的内部文件名。
- 任务快照只保存完整提示词、图片规格、模型配置快照和内部来源标记。
- 生成完成后不自动跳转到图片详情或历史详情。
- 历史和图片详情只读，不提供删除或资产管理动作。
- 缺少默认就绪图片模型配置时，不创建任务历史，只在创建页显示错误。
- 默认图片模型配置就绪但 SecureStore 中凭据缺失时，创建任务历史并标记失败。
- 发现就绪配置凭据缺失后，同步清除该模型配置的就绪状态、最近测试成功时间和默认引用。
- 移动端不执行 Skill 自带 CLI，也不复用根包 Node/OpenAI SDK 图片调用；只复用 `@imagemon/core` 的纯领域校验。

## 数据模型草案

### `image_task_histories`

```sql
CREATE TABLE IF NOT EXISTS image_task_histories (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL CHECK (task_type IN ('generate')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'unknown')),
  snapshot_json TEXT NOT NULL,
  error_summary_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
```

规则：

- `snapshot_json` 保存任务快照。
- `error_summary_json` 仅在失败状态下保存结构化安全错误摘要。
- `completed_at` 在完成或失败时写入；状态未知可只更新 `updated_at`。
- 启动时发现 `status = 'running'` 的遗留记录，统一更新为 `unknown`。

### `image_results`

```sql
CREATE TABLE IF NOT EXISTS image_results (
  id TEXT PRIMARY KEY,
  task_history_id TEXT,
  file_path TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('png')),
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_history_id)
    REFERENCES image_task_histories(id) ON DELETE SET NULL
);
```

规则：

- `task_history_id` 是弱引用，用于从图片结果回到对应任务历史。
- 本阶段不实现删除，但 schema 不依赖级联删除。
- `file_path` 保存应用内部文件目录中的相对路径或稳定内部路径。
- 文件名由应用生成，例如 `<imageResultId>.png`。

## 任务快照结构

任务快照使用 JSON 保存，首版结构保持小而稳定：

```json
{
  "source": "manual",
  "prompt": "输入框中的完整提示词",
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
  }
}
```

任务快照不保存 API Key、安全存储引用、图鉴条目、模板输入、封面示例或 Promptdex 条目身份。

## 执行规则

- 提交前校验提示词非空。
- 提交前读取默认图片模型配置；缺少就绪默认配置时，显示错误并停止，不创建任务历史。
- 读取默认配置成功后，构建模型配置快照。
- 先创建 `running` 任务历史并保存任务快照。
- 再从 SecureStore 读取 API Key。
- 若 API Key 缺失，将任务历史标记为 `failed`，错误摘要 reason 为 `missing_credential`，并清除该配置的就绪状态和默认引用。
- 若 API Key 存在，使用移动端 `fetch` 适配层调用图片模型。
- 调用成功且返回一张可保存图片时，写入图片文件和图片结果记录，再将任务历史标记为 `completed`。
- 调用失败或响应不可用时，将任务历史标记为 `failed`，并保存结构化错误摘要。
- 应用启动后运行一次清理，把遗留 `running` 任务历史转为 `unknown`。
- 生成任务可跨页面继续，但只保证在当前 React runtime 生命周期内继续；不做系统后台执行。
- 生成任务完成或失败后不自动跳转。

## 错误摘要

错误摘要只保存安全、可展示的信息：

```ts
type ImageTaskFailureReason =
  | "missing_default_model_configuration"
  | "missing_credential"
  | "network_error"
  | "unauthorized"
  | "rate_limited"
  | "server_error"
  | "invalid_response"
  | "unknown_error";
```

字段：

- `reason`：失败原因。
- `message`：面向设备使用者的中文简短说明。
- `occurredAt`：ISO 8601 UTC 时间。
- `statusCode`：可选 HTTP 状态码。
- `providerCode`：可选平台错误码。

不得保存完整模型服务响应体、请求头、API Key、底层堆栈或 SDK 原始错误对象。

## 页面规则

### 创建 Tab

- Tab 文案为“创建”。
- 页面提供完整提示词输入框。
- 页面提供尺寸选择：方图、横图、竖图。
- 页面显示默认图片模型配置摘要；缺少默认配置时显示错误。
- 提交后按钮进入等待状态。
- 有模型调用正在进行时禁止再次提交。
- 生成完成或失败后显示即时状态，不自动跳转。

### 历史列表

- 显示创建时间、任务状态、尺寸和提示词摘要。
- 完成记录可显示关联图片缩略图；缺失或非完成状态显示占位。
- 点击进入历史详情。

### 历史详情

- 只读展示完整提示词。
- 只读展示图片规格。
- 只读展示模型配置快照。
- 展示任务状态。
- 失败时展示错误摘要。
- 完成时展示关联图片结果入口。
- 不提供删除、重试、编辑或再次执行。

### 图片列表

- 显示图片缩略图、创建时间和提示词摘要或关联任务摘要。
- 点击进入图片详情。

### 图片详情

- 展示大图。
- 展示创建时间和基础规格。
- 提供关联历史入口。
- 不提供删除、导出、分享、重命名、备注或编辑。

## 自动化测试策略

- 不打真实网络。
- 不需要真实 API Key。
- 图片模型调用适配层使用 mock `fetch`。
- 文件保存使用可替换文件存储适配器或测试临时目录。
- 时间、ID 生成器和模型调用适配器可注入。
- 重点覆盖：
  - 缺少默认就绪图片模型配置时不创建任务历史。
  - 凭据缺失时创建失败历史并清除就绪状态和默认引用。
  - 成功调用写入任务历史、任务快照、图片结果和图片文件。
  - 调用失败写入安全错误摘要。
  - 启动时遗留进行中任务转为状态未知。
  - 图片结果与任务历史的弱引用读取。

## 验证入口

```bash
npm run mobile:typecheck
npm run mobile:test
npm run mobile:verify
```

本竖切不进入根 `npm run verify` 的发布前 Skill/CLI 链路，除非后续显式决定移动端验证也阻塞 Skill 发布。

## 提交分解

每完成一个任务后都单独提交。提交信息统一使用中文。

### 任务 0：提交本计划并更新阶段文档

Git commit 标记：`待填写`

修改范围：

- `README.md`
- `docs/current-architecture.md`
- `docs/plans/mobile-generation-task-history-image-result-slice.md`

验收：

- 文档表达与本计划一致。
- README 不再声称 `apps/mobile`、SQLite、React Native 页面或安全存储适配尚不存在。

提交点：

```bash
git add README.md docs/current-architecture.md docs/plans/mobile-generation-task-history-image-result-slice.md
git commit -m "记录移动端生成任务资产闭环计划"
```

### 任务 1：扩展移动端存储 schema 与仓储

Git commit 标记：`待填写`

修改范围：

- `apps/mobile/src/storage`
- `apps/mobile/src/image-tasks`
- 必要测试文件。

实现要点：

- 增加任务历史和图片结果表。
- 增加启动时遗留进行中任务转状态未知的初始化逻辑。
- 增加任务历史与图片结果仓储。
- 保持模型配置现有迁移规则可升级。

验收：

```bash
npm run mobile:test
```

提交点：

```bash
git add apps/mobile/src/storage apps/mobile/src/image-tasks apps/mobile
git commit -m "实现生成任务资产存储"
```

### 任务 2：实现移动端图片模型调用和文件保存适配层

Git commit 标记：`待填写`

修改范围：

- `apps/mobile/src/image-tasks`
- 必要测试文件。

实现要点：

- 使用 `fetch` 调用 OpenAI 兼容图片生成接口。
- 复用 `@imagemon/core` 校验图片规格。
- 将 base64 图片写入应用内部文件目录。
- 归一化模型调用错误为安全错误摘要。
- 不引入 OpenAI SDK，不调用根包 CLI。

验收：

```bash
npm run mobile:test
npm run mobile:typecheck
```

提交点：

```bash
git add apps/mobile/src/image-tasks apps/mobile
git commit -m "实现移动端生成任务执行器"
```

### 任务 3：实现创建 Tab

Git commit 标记：`待填写`

修改范围：

- `apps/mobile/app/(tabs)/_layout.tsx`
- `apps/mobile/app/(tabs)/index.tsx`
- `apps/mobile/src/image-tasks`

实现要点：

- 将首个 Tab 文案改为“创建”。
- 实现提示词输入、尺寸选择和提交状态。
- 缺默认就绪图片模型配置时只显示错误，不创建任务历史。
- 调用生成任务执行器。

验收：

```bash
npm run mobile:typecheck
```

提交点：

```bash
git add apps/mobile/app apps/mobile/src/image-tasks
git commit -m "实现生成任务创建入口"
```

### 任务 4：实现历史列表和历史详情

Git commit 标记：`待填写`

修改范围：

- `apps/mobile/app/(tabs)/history.tsx`
- `apps/mobile/app/history`
- `apps/mobile/src/image-tasks`

实现要点：

- 历史列表展示状态、时间、尺寸和提示词摘要。
- 历史详情只读展示快照、状态、错误摘要和关联图片入口。
- 不实现删除、重试或再次执行。

验收：

```bash
npm run mobile:typecheck
```

提交点：

```bash
git add apps/mobile/app apps/mobile/src/image-tasks
git commit -m "实现任务历史查看"
```

### 任务 5：实现图片列表和图片详情

Git commit 标记：`待填写`

修改范围：

- `apps/mobile/app/(tabs)/images.tsx`
- `apps/mobile/app/images`
- `apps/mobile/src/image-tasks`

实现要点：

- 图片列表展示缩略图、时间和关联任务摘要。
- 图片详情展示大图、基础规格和关联历史入口。
- 不实现删除、导出、分享、重命名、备注或编辑。

验收：

```bash
npm run mobile:typecheck
```

提交点：

```bash
git add apps/mobile/app apps/mobile/src/image-tasks
git commit -m "实现图片结果查看"
```

### 任务 6：竖切收尾验证

Git commit 标记：`待填写`

修改范围：

- 必要的测试补充和文档勘误。

实现要点：

- 补齐仓储、执行器和错误摘要测试。
- 检查创建、历史、图片三个入口的空状态、失败状态和成功状态。
- 确认不引入本阶段范围外能力。

验收：

```bash
npm run mobile:verify
```

提交点：

```bash
git add .
git commit -m "完成生成任务资产闭环竖切"
```

## 开发注意事项

- 测试失败时修复生产代码，不修改测试、断言、Mock、Fixture 或跳过测试来规避失败。
- 如果实现时发现新领域决策，先更新 `CONTEXT.md` 或新增 ADR，再继续编码。
- 如果发现现有 ADR 与当前实现计划冲突，先停下确认，不直接绕过。
- 不要为了移动端竖切改动 Skill 自包含 CLI 的发布链路。
