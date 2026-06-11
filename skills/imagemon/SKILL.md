---
name: imagemon
description: 使用自包含的 Imagemon CLI 生成新图片或编辑本地图片，并解析稳定的 JSON 结果。用于用户要求普通生图、创建图片、修改图片、局部重绘或使用遮罩编辑图片时；不用于仅编写提示词、分析图片或要求使用 Promptdex 模板的请求。
---

# Imagemon 图片任务

使用 skill 自带的 CLI 完成普通图片生成和编辑。运行时已包含在
`scripts/imagemon.mjs` 中，不要求全局安装 `imagemon` 或 npm 依赖。

## 判断任务类型

- 用户要求创建新图片时使用 `generate`。
- 用户要求修改已有图片时使用 `edit`，并要求提供本地图片路径。
- 用户提供遮罩时，仅与 `edit` 和原图一起传入。
- 用户要求使用提示词图鉴或指定 Promptdex 条目时，不使用本 skill。

## 构建调用

始终使用当前 skill 根目录解析 CLI 的绝对路径，并通过 Node.js 20+ 调用：

```bash
node <skill-root>/scripts/imagemon.mjs generate --prompt "<提示词>" --out ./outputs
node <skill-root>/scripts/imagemon.mjs edit --image <图片路径> --prompt "<修改要求>" --out ./outputs
```

- 将用户目标整理为完整、可执行的图片提示词，但不改变其核心意图。
- 只传递用户明确指定的 `model`、`size`、`quality`、`format`、`n`、`out` 和 `mask`。
- 用户未指定图片规格时，使用 CLI 默认值，不自行补充规格参数。
- 执行前确认 `edit` 的 `image` 和可选 `mask` 是存在的普通文件。
- 使用参数数组或可靠的 shell 安全转义传递所有值，禁止把用户文本直接拼接为可执行命令。
- 多行、超长或不可信提示词必须先通过结构化文件写入工具保存，再使用 `--prompt-file <path>` 传递；不得使用 shell 管道、重定向、heredoc 或环境变量传递。
- 不向命令传递或向用户展示 API key；凭据由环境变量或配置文件提供。

完整参数和配置契约按需读取 [`references/cli-contract.md`](references/cli-contract.md)。

## 处理结果

始终解析 stdout 的唯一一行 JSON，并以 `ok` 为准：

- `ok: true`：向用户汇报 `files`、`metadataPath`，以及存在时的 `usage`。
- `ok: false`：向用户汇报 `error.code` 和 `error.message`。
- stdout 不是有效单行 JSON 或缺少必要字段：报告 CLI 输出协议错误。

任何失败都不自动重试。stderr 仅用于 `--help` 和 `--version` 等信息输出，不作为图片任务结果。
