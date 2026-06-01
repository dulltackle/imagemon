# illustrating

面向 AI agent 的 GPT Image 调用封装。项目同时提供 TypeScript SDK 和命令行入口；推荐 agent 优先调用 CLI，因为输入输出稳定，图片会直接落盘，stdout 始终是可解析 JSON。

## 安装与构建

```bash
npm install
npm run build
```

构建后 CLI 入口为 `gpt-image`，对应产物是 `dist/cli.js`。在仓库内也可以直接运行：

```bash
node dist/cli.js generate --prompt "生成一张图片"
```

## 配置

CLI 和 SDK 共用同一套配置优先级：

```text
命令行/函数参数 > gpt-image.config.json 或 IMAGE_API_CONFIG_FILE > 环境变量
```

支持的环境变量：

```bash
IMAGE_API_KEY=你的密钥
IMAGE_API_BASE_URL=https://api.openai.com/v1
IMAGE_API_TIMEOUT_MS=45000
IMAGE_API_MAX_RETRIES=0
IMAGE_API_CONFIG_FILE=/path/to/gpt-image.config.json
```

也可以在当前工作目录放置 `gpt-image.config.json`：

```json
{
  "apiKey": "你的密钥",
  "baseURL": "https://api.openai.com/v1",
  "timeout": 45000
}
```

`baseURL` 必须停在 API 版本前缀，例如 `https://api.openai.com/v1`，不要写到 `/images/generations` 或 `/images/edits`。

## CLI 用法

文生图：

```bash
gpt-image generate \
  --prompt "生成一张赛博朋克风格的城市夜景" \
  --size 1536x1024 \
  --quality high \
  --format png \
  --out ./outputs
```

修改图片：

```bash
gpt-image edit \
  --image ./input.png \
  --prompt "把背景改成雪山" \
  --size 1024x1536 \
  --out ./outputs
```

可选参数：

- `--model`：默认 `gpt-image-2`
- `--size`：例如 `1024x1024`、`1536x1024`、`auto`
- `--quality`：`auto`、`low`、`medium`、`high`
- `--format`：`png`、`jpeg`、`webp`
- `--n`：生成数量
- `--mask`：编辑图片时的遮罩图
- `--api-key`、`--base-url`、`--config`：覆盖默认配置
- `--json`：兼容参数，stdout 默认始终输出 JSON

## 输出结构

CLI 会创建输出目录，默认是 `./outputs`。每次调用会写出：

```text
outputs/<timestamp>-0.png
outputs/<timestamp>.json
```

stdout 只输出一行 JSON，方便 agent 解析：

```json
{
  "ok": true,
  "files": ["/abs/path/outputs/2026-06-01T00-00-00-000Z-0.png"],
  "metadataPath": "/abs/path/outputs/2026-06-01T00-00-00-000Z.json",
  "usage": {
    "total_tokens": 1,
    "input_tokens": 1,
    "output_tokens": 0
  }
}
```

失败时仍输出 JSON，并返回非 0 exit code：

```json
{
  "ok": false,
  "files": [],
  "metadataPath": null,
  "error": {
    "message": "--prompt is required"
  }
}
```

## SDK 用法

```ts
import { generateGptImage, saveGptImageResult } from "image2";

const result = await generateGptImage({
  prompt: "生成一张图片",
  size: "1024x1024",
  quality: "high",
});

const saved = await saveGptImageResult(result, {
  outDir: "./outputs",
  request: {
    model: "gpt-image-2",
    prompt: "生成一张图片",
  },
});

console.log(saved.files);
```

## Agent 调用建议

AI agent 应优先调用 `gpt-image generate` 或 `gpt-image edit`，并只解析 stdout 的 JSON。不要直接拼接 OpenAI 图片接口路径；本项目已经统一处理默认模型、兼容平台 baseURL、参数校验、图片落盘和元数据记录。
