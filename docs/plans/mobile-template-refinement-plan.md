# 手机端模板提炼实现计划

本文描述手机端从外部完整提示词和计划用途中生成提炼方案、审阅确认并写入个人图鉴条目的实现计划。目标是在个人图鉴条目基础能力完成后，打通模板提炼闭环，同时保持手机端首版单发、结构化、可恢复但不保留过程材料的边界。

## 已确认范围

- 模板提炼入口放在图鉴列表页，进入独立页面；不放在图鉴条目详情页或设置页。
- 路由建议为 `/promptdex/refine`。
- 初始表单只收集 `外部完整提示词` 和 `计划用途`。
- 提交前只做最小确定性校验：两个字段 trim 后非空，并设置长度上限。
- `外部完整提示词` 最多 20,000 字符，`计划用途` 最多 1,000 字符。
- 明确离线时阻止提交；没有就绪默认文本模型配置或缺少凭据时阻止提交。
- 不在本地判断计划用途是否足够明确，不引入模型主导澄清。
- 文本模型调用使用 OpenAI 兼容 `/chat/completions`，要求返回纯 JSON 文本。
- 请求可以携带 `response_format: { "type": "json_object" }`；服务端不支持时不自动移除字段重试。
- 模型输出必须是应用可解析的结构化 JSON；应用不从自然语言、Markdown 或混合响应中猜测提炼方案。
- 结构化提炼方案至少包含拟写入的 Promptdex 模板字段、任务类型推断说明、保留规则摘要、删除规则摘要和提炼补充列表。
- 解析失败、结构无效或 Promptdex 契约校验失败时，本次生成失败；保留可重新生成的提炼草稿，但不保存原始响应。
- 提炼草稿最多一个；未点击生成前的普通表单输入不持久化。
- 提炼草稿状态使用 `editing_input`、`generating`、`ready_for_review`、`failed`。
- `ready_for_review` 页面必须展示摘要、提炼补充、输入声明和将写入的逐字正文。
- 确认写入前需要勾选 `我已检查将写入的完整正文和输入声明。`。
- 如果存在提炼补充，还需要单独勾选 `我批准以上提炼补充写入图鉴条目。`。
- 确认写入前只允许本地编辑 `name` 和 `description`；不允许编辑 `inputs`、`body`、`version` 或摘要内容。
- 修改 `name` 或 `description` 后，已勾选的批准项清空，需要重新确认。
- 写入前名称冲突时，不丢方案、不重新生成；阻止写入并要求本地改名。
- 模板提炼复用全局模型调用锁，新增 `templateRefinement` call type。
- 模板提炼失败保存非敏感结构化错误摘要，且只保存在提炼草稿里。

## 明确不做

- 不支持一次融合多个外部完整提示词。
- 不支持修改已有图鉴条目的执行语义。
- 不支持模型主导多轮澄清。
- 不支持流式输出、局部方案预览或增量 JSON 解析。
- 不使用 Responses API、工具调用或函数调用。
- 不自动降级重试不支持 `response_format` 的服务。
- 不保存原始完整模型响应、请求头、API Key、底层堆栈、中间推理内容、不可解析散文或半截 JSON。
- 不把模板提炼写入任务历史。
- 不在未点击生成前保存普通表单草稿。
- 不允许手工编辑输入声明或模板正文。
- 不在提炼写入后的个人图鉴条目中保留外部完整提示词、来源 URL 或提炼过程。

## 依赖决策

- `CONTEXT.md`：提炼会话、模板提炼、提炼方案、提炼补充、提炼草稿、业务模型调用、全局模型调用状态。
- ADR 0022：手机端首版包含经确认的模板提炼。
- ADR 0029：所有模型调用使用全局单模型调用锁。
- ADR 0030：模板提炼不进入任务历史，不确定结果保留提炼草稿。
- ADR 0031：全应用最多保留一个提炼草稿。
- ADR 0074：提炼草稿只保存可恢复流程的最小状态。
- ADR 0075：提炼写入后不保留外部完整提示词来源。
- ADR 0184：提炼草稿与文本模型配置解耦。
- ADR 0185：提炼写入时名称冲突由写入前改名解决。
- ADR 0195：手机端提炼批准必须覆盖将写入的逐字正文。
- ADR 0196：手机端首版提炼是单发，不引入模型主导多轮澄清。
- ADR 0207：手机端模板提炼只接受结构化 JSON 输出。
- ADR 0208：手机端模板提炼使用 Chat Completions 且不自动降级重试。

## 提炼方案 JSON 契约

建议内部解析后的结构：

```ts
interface TemplateRefinementProposal {
  template: {
    name: string;
    description: string;
    version?: string | boolean;
    inputs: Record<string, { required: boolean; description: string }>;
    body: string;
  };
  taskTypeRationale: string;
  retainedRules: string[];
  removedRules: Array<{ reason: string; summary: string }>;
  additions: Array<{
    summary: string;
    reason: string;
    impactIfRejected: string;
  }>;
}
```

规则：

- `template` 必须能构造成 `PromptdexTemplate` 并通过 core 的 Promptdex 契约校验。
- `taskType` 不由 JSON 独立声明，而是由 `inputs` 推断；如模型输出独立任务类型字段，应用按 `invalid_response` 拒绝，以符合 ADR 0001。
- `body` 是将写入个人图鉴条目的逐字正文。
- `additions` 为空时，页面显示 `提炼补充：无`。
- `retainedRules` 和 `removedRules` 用于审阅导览，不写入个人图鉴条目。

## 提炼草稿

草稿状态：

- `editing_input`：已进入提炼流程但没有可确认方案；可编辑输入并发起生成。
- `generating`：模型调用进行中；页面显示等待态，不允许编辑输入。
- `ready_for_review`：已有结构化提炼方案，等待确认写入或重新生成。
- `failed`：上次生成失败，保留输入、错误摘要和重新生成入口。

创建与持久化：

- 进入提炼页后输入内容但未点击生成，离开页面不保存草稿。
- 点击生成并通过本地校验后，创建或更新唯一草稿为 `generating`。
- 生成成功后写入结构化提炼方案，状态变为 `ready_for_review`。
- 生成失败后写入错误摘要，状态变为 `failed`。
- 在 `failed` 或 `ready_for_review` 修改外部完整提示词或计划用途时，更新草稿为 `editing_input`，并使原方案失效。
- 确认写入个人图鉴条目或主动丢弃后，清除提炼草稿。

## 错误摘要

模板提炼失败摘要只保存在提炼草稿中，建议原因枚举：

- `missing_text_model_configuration`
- `missing_credential`
- `offline`
- `unauthorized`
- `rate_limited`
- `server_error`
- `network_error`
- `invalid_response`
- `promptdex_contract_invalid`
- `unknown`

摘要字段：

- `reason`
- `occurredAt`
- 可选 `statusCode`
- 可选 `providerCode`

摘要不得包含原始响应体、请求头、API Key、堆栈或不可展示调试信息。

## 页面交互

图鉴列表页：

- 提供进入模板提炼页的入口。
- 如果存在 `ready_for_review` 或 `failed` 草稿，图鉴相关入口可以显示需要处理状态。
- 模板提炼进行中时，图鉴相关入口和全局状态显示“模板提炼进行中”。

提炼页：

1. 无草稿时显示初始表单。
2. 有草稿时先显示继续或丢弃选择。
3. `editing_input` 和 `failed` 可编辑外部完整提示词与计划用途。
4. `generating` 显示持续 loading，不提供取消本地等待入口。
5. `ready_for_review` 显示方案摘要、提炼补充、输入声明和完整正文。
6. `ready_for_review` 只允许编辑 `name` 和 `description`。
7. 写入按钮仅在名称合法、不冲突、Promptdex 契约校验通过且所需批准项已勾选时启用。
8. 写入成功后清除提炼草稿，新增个人图鉴条目出现在合并图鉴个人分组中。

## 模型调用

请求：

- 使用文本模型配置的 `baseUrl`、`modelName` 和 API Key。
- 调用 `${baseUrl}/chat/completions`。
- 使用 system message 固定模板提炼规则和 JSON 输出契约。
- 使用 user message 传入外部完整提示词和计划用途。
- 请求体包含 `model`、`messages` 和 `response_format: { "type": "json_object" }`。
- 不设置固定业务调用超时，不使用流式输出。

响应：

- 只读取首个 assistant message 的文本内容。
- 内容必须是 JSON 对象文本。
- JSON 解析、结构校验和 Promptdex 契约校验全部通过后，才进入 `ready_for_review`。
- 任何不可解析、结构不符或契约失败都进入 `failed`，不保存原始响应。

全局模型调用锁：

- 生成方案前调用 `beginModelCall("templateRefinement")`。
- 锁被占用时禁用生成按钮，并显示当前进行中的调用类型。
- 完成、失败或可确认中断后释放锁。
- 全局状态文案为“模板提炼进行中”，入口返回 `/promptdex/refine`。

## 可执行子任务与提交边界

### 1. 记录领域语言、ADR 与实现计划

Commit 标注：`docs: 记录手机端模板提炼计划`

改动范围：

- 更新 `CONTEXT.md` 中 `提炼方案` 的定义。
- 新增 ADR 0207 和 0208。
- 新增本文档，冻结输入校验、JSON 契约、草稿状态、确认交互和模型调用边界。

验收：

- 文档明确手机端只接受结构化 JSON。
- 文档明确 Chat Completions 不自动降级重试。
- 文档明确未提交表单不持久化。

### 2. 增加提炼草稿 schema 与仓储

Commit 标注：`feat: 增加模板提炼草稿存储`

改动范围：

- 将应用 schema 版本递增。
- 新增单草稿存储表或固定 ID 行。
- 实现提炼草稿 repository，支持读取、创建/更新状态、保存方案、保存失败摘要和清除。
- 提供内存 store 与 SQLite store。

验收：

- 全应用最多一个提炼草稿。
- 未保存原始模型响应。
- 状态迁移符合本文档定义。

### 3. 实现提炼方案解析与校验

Commit 标注：`feat: 校验结构化模板提炼方案`

改动范围：

- 新增结构化 JSON parser。
- 校验 `template`、`taskTypeRationale`、`retainedRules`、`removedRules` 和 `additions`。
- 构造 `PromptdexTemplate` 并调用 core 契约校验。
- 把错误归一为 `invalid_response` 或 `promptdex_contract_invalid`。

验收：

- 非 JSON、数组、缺字段、类型错误、独立 `taskType` 字段和无效 Promptdex 模板都有测试。
- 解析成功结果包含逐字正文和输入声明。

### 4. 实现文本模型客户端

Commit 标注：`feat: 实现模板提炼文本模型调用`

改动范围：

- 新增 OpenAI 兼容 Chat Completions fetch 客户端。
- 请求 `/chat/completions`，包含 JSON 输出约束。
- 归一化鉴权、限流、服务端、网络和无效响应错误。
- 不做 response_format 降级重试。

验收：

- 单元测试覆盖请求 URL、headers、body。
- 单元测试覆盖 401/403、429、5xx、网络失败、非 JSON 输出和成功输出。
- 验证不发生第二次自动重试。

### 5. 实现模板提炼服务

Commit 标注：`feat: 实现模板提炼服务`

改动范围：

- 组合草稿仓储、模型配置仓储、文本模型客户端和合并图鉴唯一性校验。
- 提供生成方案、修改输入、修改名称/描述、确认写入和丢弃草稿能力。
- 写入个人图鉴条目后清除草稿。

验收：

- 缺少就绪文本模型配置、缺少凭据、离线、锁占用和模型失败均不写入个人图鉴条目。
- 成功生成进入 `ready_for_review`。
- 修改输入使方案失效。
- 修改名称/描述清空批准项并重新校验。
- 名称冲突阻止写入但保留方案。

### 6. 接入全局模型调用锁和运行时

Commit 标注：`feat: 接入模板提炼模型调用锁`

改动范围：

- 在 `ModelCallType` 增加 `templateRefinement`。
- 全局状态文案和返回入口支持模板提炼。
- `AppRuntimeProvider` 注入提炼草稿仓储、文本模型客户端和提炼服务。

验收：

- 模板提炼进行中会阻止其他模型调用。
- 其他模型调用进行中会阻止模板提炼。
- 全局入口能回到提炼页。

### 7. 实现提炼页面和图鉴入口

Commit 标注：`feat: 图鉴支持模板提炼入口`

改动范围：

- 在图鉴列表页增加提炼入口。
- 新增 `/promptdex/refine` 页面。
- 实现无草稿、继续/丢弃、编辑输入、生成中、失败和审阅确认状态。
- 审阅页展示摘要、提炼补充、输入声明和逐字正文。
- 审阅页提供两个批准项。

验收：

- 未点击生成离开页面不保存草稿。
- 有草稿时进入页面先要求继续或丢弃。
- 失败后可修改输入并重新生成。
- 成功审阅后可写入个人图鉴条目。
- 写入后图鉴列表出现个人条目。

### 8. 补齐测试与验证

Commit 标注：`test: 覆盖模板提炼闭环`

改动范围：

- 仓储、parser、客户端、服务和可测试 UI 状态逻辑补齐单元测试。
- 运行移动端类型检查和测试。

验收：

- `npm run mobile:test` 通过。
- `npm run mobile:typecheck` 通过。
- 不修改既有测试断言、Mock、Fixture 来绕过失败。

## 推荐实施顺序

1. 先完成个人图鉴条目基础能力计划。
2. 提交模板提炼文档和 ADR。
3. 做提炼草稿 schema 与仓储。
4. 做提炼方案 parser 和文本模型客户端。
5. 做提炼服务，把本地状态机和写入规则压实。
6. 接入全局模型调用锁和运行时。
7. 最后做页面和图鉴入口。

## 风险与注意事项

- 不要从自然语言响应里提取模板；这会绕过结构化校验边界。
- 不要保存原始模型响应；失败摘要必须保持非敏感。
- 不要把提炼失败写入任务历史；提炼不是图片任务。
- 不要允许手工修改正文或输入声明；执行语义变化必须通过重新生成。
- 不要为了兼容不支持 `response_format` 的服务自动重试；让设备使用者明确重新发起。
- 不要让本轮模板提炼实现反向依赖尚未实现的展示信息字段。
