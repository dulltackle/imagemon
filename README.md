# imagemon

面向 AI agent 的 GPT Image 调用封装。项目同时提供 TypeScript SDK 和命令行入口；推荐 agent 优先调用 CLI，因为输入输出稳定，图片会直接落盘，stdout 始终是可解析 JSON。

## 安装与构建

```bash
npm install
npm run build
```

构建后 CLI 入口为 `imagemon`，对应产物是 `dist/cli.js`。在仓库内也可以直接运行：

```bash
node dist/cli.js generate --prompt "生成一张图片"
```

## Skill 分发

`skills/imagemon/` 是面向其他 Agent 的自包含 skill。目录中的
`scripts/imagemon.mjs` 已打包 CLI 和运行依赖，接收方只需 Node.js 20+，无需执行
`npm install` 或全局安装 `imagemon`。

将整个 `skills/imagemon/` 复制或同步到目标 Agent 的 skills 目录即可安装。API 凭据仍由目标环境
通过环境变量、`IMAGEMON_API_CONFIG_FILE` 或工作目录下的 `imagemon.config.json` 提供，不随
skill 分发。

修改 CLI 生产代码后，重新生成并校验 skill：

```bash
npm run build:skill
npm run check:skill
```

提交前可运行统一验证：

```bash
npm run verify
```

## 配置

CLI 和 SDK 共用同一套配置优先级：

```text
命令行/函数参数 > imagemon.config.json 或 IMAGEMON_API_CONFIG_FILE > 环境变量
```

支持的环境变量：

```bash
IMAGEMON_API_KEY=你的密钥
IMAGEMON_API_BASE_URL=https://api.openai.com/v1
IMAGEMON_API_TIMEOUT_MS=45000
IMAGEMON_API_MAX_RETRIES=0
IMAGEMON_API_CONFIG_FILE=/path/to/imagemon.config.json
```

也可以在当前工作目录放置 `imagemon.config.json`：

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
imagemon generate \
  --prompt "生成一张赛博朋克风格的城市夜景" \
  --size 1536x1024 \
  --quality high \
  --format png \
  --out ./outputs
```

修改图片：

```bash
imagemon edit \
  --image ./input.png \
  --prompt "把背景改成雪山" \
  --size 1024x1536 \
  --out ./outputs
```

可选参数：

- `--model`：默认 `gpt-image-2`
- `--size`：例如 `1024x1024`、`1536x1024`、`auto`；使用 `gpt-image-2` 时还可便捷选择 `2048x2048`、`2048x1152`、`3840x2160`、`2160x3840`
- `--quality`：`auto`、`low`、`medium`、`high`
- `--format`：`png`、`jpeg`、`webp`
- `--n`：生成数量
- `--mask`：编辑图片时的遮罩图
- `--api-key`、`--base-url`、`--config`：覆盖默认配置
- `--json`：兼容参数，stdout 默认始终输出 JSON

CLI 会在发起网络请求前校验参数语法：

- `--quality` 仅接受 `auto`、`low`、`medium`、`high`
- `--size` 仅接受 `auto` 或 `WIDTHxHEIGHT` 格式；模型能力、尺寸范围和参数组合由 SDK 校验
- 所有参数都不允许重复或使用空字符串
- `--n` 必须使用整数格式
- `--json` 是布尔兼容开关，不接受 `--json=value`

`imagemon --help`、`imagemon generate --help`、`imagemon edit --help` 和
`imagemon --version` 将稳定信息写入 stderr，并以 0 退出；它们不会向 stdout 写入内容。

## 输出结构

CLI 会创建输出目录，默认是 `./outputs`。每次调用会写出：

```text
outputs/<timestamp>-<random>-0.png
outputs/<timestamp>-<random>.json
```

自动生成的基础文件名包含随机后缀，并使用独占写入，避免同一毫秒内的并发调用静默覆盖文件。
SDK 调用方显式传入 `baseName` 时，已有同名输出默认会导致失败；只有显式设置
`overwrite: true` 才允许覆盖。

stdout 只输出一行 JSON，方便 agent 解析：

```json
{
  "ok": true,
  "files": ["/abs/path/outputs/2026-06-01T00-00-00-000Z-a1b2c3-0.png"],
  "metadataPath": "/abs/path/outputs/2026-06-01T00-00-00-000Z-a1b2c3.json",
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
    "code": "INVALID_OPTION",
    "message": "--prompt is required"
  }
}
```

参数语法错误使用稳定错误码 `INVALID_OPTION`；执行阶段错误使用 `EXECUTION_ERROR`。

## SDK 用法

```ts
import { DEFAULT_IMAGE_MODEL, generateImage, saveImageResult } from "imagemon";

const result = await generateImage({
  prompt: "生成一张图片",
  size: "1024x1024",
  quality: "high",
});

const saved = await saveImageResult(result, {
  outDir: "./outputs",
  request: {
    model: DEFAULT_IMAGE_MODEL,
    prompt: "生成一张图片",
  },
});

console.log(saved.files);
```

### URL 图片下载安全

`saveImageResult` 遇到 URL 图片时默认启用安全下载策略：

- 仅允许 HTTPS，并拒绝环回、本机、链路本地和私网目标。
- 每次重定向都会重新校验目标，最多跟随 5 次。
- 总超时为 300 秒，最大响应体为 20 MiB。
- 仅接受 `image/png`、`image/jpeg` 和 `image/webp`。

可信开发环境或兼容平台需要访问 HTTP、私网地址或自定义图片类型时，必须显式配置：

```ts
const saved = await saveImageResult(result, {
  download: {
    fetch: customFetch,
    allowHttp: true,
    allowPrivateNetwork: true,
    timeoutMs: 30_000,
    maxBytes: 10 * 1024 * 1024,
    allowedContentTypes: ["image/png"],
  },
});
```

## 模型能力契约

默认模型由 SDK 导出的 `DEFAULT_IMAGE_MODEL` 统一定义，当前值为 `gpt-image-2`；SDK 请求和 CLI 元数据均复用该常量。

项目会对已知模型执行本地能力校验：

- `gpt-image-2` 及其版本模型支持自定义尺寸和 `input_fidelity`，但不支持透明背景。
- `gpt-image-1`、`gpt-image-1.5` 支持透明背景和 `input_fidelity`，但不支持自定义尺寸。
- `gpt-image-1-mini` 支持透明背景，但不支持 `input_fidelity` 和自定义尺寸。
- 兼容平台扩展模型 `gpt-image-3` 支持透明背景、`input_fidelity` 和自定义尺寸。

SDK 导出 `GPT_IMAGE_2_UNIQUE_SIZES` 和 `getImageModelPresetSizes(model)`，供界面或 Agent 根据所选模型展示推荐尺寸。`gpt-image-2` 及其版本模型会额外返回四个便捷预设：

```ts
getImageModelPresetSizes("gpt-image-2");
// ["auto", "1024x1024", "1536x1024", "1024x1536",
//  "2048x2048", "2048x1152", "3840x2160", "2160x3840"]
```

这些尺寸是帮助用户选择 `gpt-image-2` 的推荐快捷项，不是其他模型的专属限制。其他支持自定义尺寸的模型仍可使用这些值；未知模型不会被本地尺寸能力校验阻止。

透明背景只能与 `png` 或 `webp` 输出格式配合。未知模型只执行通用参数和参数组合校验，其模型能力参数会透传给兼容平台，由平台返回具体错误。

## Agent 调用建议

AI agent 应优先调用 `imagemon generate` 或 `imagemon edit`，并只解析 stdout 的 JSON。不要直接拼接 OpenAI 图片接口路径；本项目已经统一处理默认模型、兼容平台 baseURL、参数校验、图片落盘和元数据记录。
