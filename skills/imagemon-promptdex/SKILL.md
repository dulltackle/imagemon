---
name: imagemon-promptdex
description: 使用 Imagemon 提示词图鉴选择模板、收集模板要求的输入、构建完整提示词，并通过自带 Imagemon CLI 生成或编辑图片。用于用户要求按某类提示词模板完成图片任务、明确指定图鉴条目，或希望从图鉴中选择合适模板时；不用于普通生图、普通图片编辑或仅编写提示词的请求。
---

# Imagemon 提示词图鉴

根据图鉴条目完成模板驱动的图片任务。每个图鉴条目都是
`references/templates/*.md` 中的一个有效提示词模板。

## 模板选择

按需读取 [`references/template-contract.md`](references/template-contract.md)，并以其中规则作为模板格式、发现和完整提示词构建的唯一契约。

1. 调用 `node scripts/promptdex.mjs list` 枚举图鉴条目。
2. 用户明确指定模板名时，使用对应模板。
3. 用户未指定时，根据 `list` 返回的元数据、用户目标、是否提供原图、期望产物和视觉风格进行语义匹配。
4. 仅存在一个明显匹配项时自动选择；没有明显匹配项或多个模板同等匹配时，让用户选择。
5. 一次图片任务只能使用一个模板。
6. 只使用 skill 自带模板，不执行任意外部模板文件。

选定模板后调用 `node scripts/promptdex.mjs inspect --template <name>` 读取完整元数据和正文。模板无效时停止任务并报告模板错误，不猜测或修复模板。

新增或修改模板后，在当前 skill 目录运行：

```bash
node scripts/promptdex.mjs validate
```

## 收集输入

- 从当前对话提取用户已提供的输入，不要求用户按字段名重复提供。
- 一次列出所有缺失的必需输入及其 `description`，让用户一次补齐。
- 不主动追问缺失的可选输入；仅当缺失会导致任务意图无法判断时追问。
- 模板声明 `image` 或 `mask` 时，在调用 CLI 前验证路径存在且为普通文件；不预判文件格式或内容有效性。
- 用户内容存在内部矛盾、歧义或多个并列核心结论，且会影响任务意图时，停止并追问。
- 不主动联网核验或擅自修正用户提供的事实。
- 用户要求与模板正文明确冲突时，指出具体冲突并停止；无法判断时先澄清。

## 构建完整提示词

将收集到的输入写入临时 JSON 文件，调用：

```bash
node scripts/promptdex.mjs render --template <name> --inputs-file <json-path>
```

使用返回的任务类型、完整提示词以及存在时的 `image`、`mask`。Agent 不自行解析 frontmatter、手工拼装完整提示词或改写用户输入。默认不向用户展示完整提示词；用户明确要求时才展示。

## 执行图片任务

默认执行参数：

```text
size: 1536x1024
quality: high
format: png
n: 1
out: ./outputs
```

用户可以明确覆盖 `size`、`quality`、`format`、`n`、`out`，不能通过本 skill 覆盖
`model`、`api-key`、`base-url` 或 `config`。`n > 1` 表示使用同一完整提示词产生多个视觉版本，
不得用于拆分多个核心结论。

信息充分且不存在冲突时直接调用 CLI，不展示完整提示词，也不要求用户二次确认。
将完整提示词作为一个经过 shell 安全转义的参数传给 `--prompt`，不得把用户输入直接拼接为可执行命令。

生成任务调用：

```bash
node scripts/imagemon.mjs generate --prompt "<完整提示词>" --size <size> --quality <quality> --format <format> --n <n> --out <out>
```

编辑任务调用：

```bash
node scripts/imagemon.mjs edit --image <image> [--mask <mask>] --prompt "<完整提示词>" --size <size> --quality <quality> --format <format> --n <n> --out <out>
```

## 处理结果

始终解析 CLI stdout 的唯一一行 JSON，并以 `ok` 为准：

- `ok: true`：向用户汇报模板名、`files`、`metadataPath`，以及存在时的 `usage`。
- `ok: false`：向用户汇报 `error.code` 和 `error.message`。
- stdout 不是有效单行 JSON 或缺少必要字段：报告 CLI 输出协议错误。

任何失败都不自动重试。

图片任务完成或失败后删除临时输入文件。
