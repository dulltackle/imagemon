# imagemon

## Skill 分发

`skills/imagemon/` 和 `skills/imagemon-promptdex/` 都是面向其他 Agent 的自包含 skill。两个目录中的 `scripts/imagemon.mjs` 字节一致，均已打包 CLI 和运行依赖，接收方只需Node.js 20+，无需执行 `npm install` 或全局安装 `imagemon`。Promptdex 还自带模板运行时和图鉴条目，不依赖普通 Imagemon skill 的目录位置。

普通图片任务安装整个 `skills/imagemon/`；模板驱动图片任务安装整个 `skills/imagemon-promptdex/`。API 凭据仍由目标环境通过环境变量、`IMAGEMON_API_CONFIG_FILE` 或工作目录下的 `imagemon.config.json` 提供，不随 skill 分发。

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
  "timeout": 45000,
  "maxRetries": 0
}
```

- `baseURL` 必须停在 API 版本前缀，例如 `https://api.openai.com/v1`，不要写到 `/images/generations` 或 `/images/edits`。
- `maxRetries` 必须是非负整数，其优先级为函数参数、配置文件、`IMAGEMON_API_MAX_RETRIES`，最后使用OpenAI SDK 默认值。

## 模型能力契约

默认模型由 SDK 导出的 `DEFAULT_IMAGE_MODEL` 统一定义，当前值为 `gpt-image-2`；SDK 请求和 CLI 元数据均复用该常量。

项目会对已知模型执行本地能力校验：

- `gpt-image-2` 及其版本模型支持自定义尺寸和 `input_fidelity`，但不支持透明背景。
- `gpt-image-1`、`gpt-image-1.5` 支持透明背景和 `input_fidelity`，但不支持自定义尺寸。
- `gpt-image-1-mini` 支持透明背景，但不支持 `input_fidelity` 和自定义尺寸。
- 兼容平台扩展模型 `gpt-image-3` 支持透明背景、`input_fidelity` 和自定义尺寸。

这些尺寸是帮助用户选择 `gpt-image-2` 的推荐快捷项，不是其他模型的专属限制。其他支持自定义尺寸的模型仍可使用这些值；未知模型不会被本地尺寸能力校验阻止。

透明背景只能与 `png` 或 `webp` 输出格式配合。未知模型只执行通用参数和参数组合校验，其模型能力参数会透传给兼容平台，由平台返回具体错误。
