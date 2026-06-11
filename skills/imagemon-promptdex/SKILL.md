---
name: imagemon-promptdex
description: 使用 Imagemon 提示词图鉴选择模板、收集模板要求的输入、构建完整提示词，并通过自带 Imagemon CLI 生成或编辑图片。用于用户要求按某类提示词模板完成图片任务、明确指定图鉴条目，或希望从图鉴中选择合适模板时；不用于普通生图、普通图片编辑或仅编写提示词的请求。
---

# Imagemon 提示词图鉴

根据图鉴条目完成模板驱动的图片任务。每个图鉴条目都是
`references/templates/*.md` 中的一个有效提示词模板。

## 运行目录

- 将调用本 skill 时 Agent 的当前工作目录记为 `<project-root>`，将本文件所在目录记为 `<skill-root>`。
- 整个图片任务期间保持 `<project-root>` 为当前工作目录，不得切换到 `<skill-root>`。
- 始终从本文件位置解析 `<skill-root>`，并使用 `<skill-root>` 下脚本的绝对路径执行命令。
- 相对输出目录、相对图片路径和 `imagemon.config.json` 均相对于 `<project-root>` 解析。

## 模板选择

按需读取 [`references/template-contract.md`](references/template-contract.md)，并以其中规则作为模板格式、发现和完整提示词构建的唯一契约。

1. 调用 `node <skill-root>/scripts/promptdex.mjs list` 枚举图鉴条目。
2. 用户明确指定模板名时，使用对应模板。
3. 用户未指定时，根据 `list` 返回的元数据、用户目标、是否提供原图、期望产物和视觉风格进行语义匹配。
4. 仅存在一个明显匹配项时自动选择；没有明显匹配项或多个模板同等匹配时，让用户选择。
5. 一次图片任务只能使用一个模板。
6. 只使用 skill 自带模板，不执行任意外部模板文件。

选定模板后调用 `node <skill-root>/scripts/promptdex.mjs inspect --template <name>` 读取完整元数据和正文。模板无效时停止任务并报告模板错误，不猜测或修复模板。

新增或修改模板后，保持 `<project-root>` 为当前工作目录并运行：

```bash
node <skill-root>/scripts/promptdex.mjs validate
```

## 收集输入

- 从当前对话提取用户已提供的输入，不要求用户按字段名重复提供。
- 一次列出所有缺失的必需输入及其 `description`，让用户一次补齐。
- 不主动追问缺失的可选输入；仅当缺失会导致任务意图无法判断时追问。
- 仅传递用户明确提供的可选输入，不自行补写标题、说明或其他可选内容。
- 模板声明 `image` 或 `mask` 时，在调用 CLI 前验证路径存在且为普通文件；不预判文件格式或内容有效性。
- 用户内容存在内部矛盾、歧义或多个并列核心结论，且会影响任务意图时，停止并追问。
- 不主动联网核验或擅自修正用户提供的事实。
- 用户要求与模板正文明确冲突时，指出具体冲突并停止；无法判断时先澄清。

## 执行图片任务

默认执行参数：

```text
size: 1536x1024
quality: high
format: png
n: 1
out: ./outputs
```

默认 `out` 对应 `<project-root>/outputs`。用户提供绝对 `out` 时原样使用；用户提供相对 `out`
时，相对于 `<project-root>` 解析。

用户可以明确覆盖 `size`、`quality`、`format`、`n`、`out`，不能通过本 skill 覆盖
`model`、`api-key`、`base-url` 或 `config`。`n > 1` 表示使用同一完整提示词产生多个视觉版本，
不得用于拆分多个核心结论。

信息充分且不存在冲突时直接调用 CLI，不展示完整提示词，也不要求用户二次确认。
Agent 不自行创建临时文件或 wrapper、不调用 `promptdex.mjs render`、不接触完整提示词，也不直接调用`imagemon.mjs`。始终通过端到端任务辅助脚本完成安全文件握手。

先准备任务：

```bash
node <skill-root>/scripts/promptdex-task.mjs prepare
```

解析 stdout 的唯一一行 JSON，只向返回的 `requestPath` 写入唯一一个 JSON 对象：

```json
{"template":"<name>","inputs":{"<input>":"<value>"},"options":{"size":"1536x1024","quality":"high","format":"png","n":1,"out":"./outputs"}}
```

然后使用返回的 `taskId` 执行任务：

```bash
node <skill-root>/scripts/promptdex-task.mjs run --task-id <taskId>
```

不再需要任务时主动取消：

```bash
node <skill-root>/scripts/promptdex-task.mjs cancel --task-id <taskId>
```

- `inputs` 包含已收集的普通输入，以及模板声明时的 `image`、`mask`。
- `options` 只允许 `size`、`quality`、`format`、`n`、`out`；可以省略并使用默认值。
- 只能写入 `prepare` 返回的 `requestPath`，不得自行选择请求文件、创建其他临时文件或采用 stdin、shell 管道、重定向、heredoc、环境变量、wrapper、命令字符串拼接等其他传递方式。
- 命令参数中不得包含用户内容。
- 执行环境无法写入返回的 `requestPath` 时，调用 `cancel` 后停止任务并报告。
- 辅助脚本负责管理受保护任务目录、构建完整提示词、调用 Imagemon 和清理任务文件。

## 处理结果

始终解析 CLI stdout 的唯一一行 JSON，并以 `ok` 为准：

- `ok: true`：向用户汇报模板名、`files`、`metadataPath`，以及存在时的 `usage`。
- `ok: false`：向用户汇报 `error.code` 和 `error.message`。
- stdout 不是有效单行 JSON 或缺少必要字段：报告 CLI 输出协议错误。

任何失败都不自动重试。
