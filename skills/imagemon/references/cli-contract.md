# Imagemon CLI 契约

## 运行时要求

- Node.js 20 或更高版本。
- `scripts/imagemon.mjs` 是包含运行依赖的自包含 ESM 文件。
- 输出目录、相对配置路径、输入图片路径和提示词文件路径均相对于调用方当前工作目录解析。
- CLI 保存 URL 图片时会逐个校验初始及重定向目标，并将默认传输连接绑定到已校验的 DNS 地址。
- SDK 调用方注入自定义 `fetch` 时，必须同时设置 `allowPrivateNetwork: true` 并自行承担目标网络安全责任。

## 配置优先级

```text
命令行参数 > imagemon.config.json 或 IMAGEMON_API_CONFIG_FILE > 环境变量
```

支持的环境变量：

```text
IMAGEMON_API_KEY
IMAGEMON_API_BASE_URL
IMAGEMON_API_TIMEOUT_MS
IMAGEMON_API_MAX_RETRIES
IMAGEMON_API_CONFIG_FILE
```

默认读取当前工作目录下的 `imagemon.config.json`。配置文件可包含：

```json
{
  "apiKey": "密钥",
  "baseURL": "https://api.openai.com/v1",
  "timeout": 45000,
  "maxRetries": 0
}
```

`baseURL` 必须是 API 版本前缀，不能包含具体图片接口路径。
`maxRetries` 必须是非负整数，其优先级为函数参数、配置文件、`IMAGEMON_API_MAX_RETRIES`，最后使用
OpenAI SDK 默认值。

## 命令与参数

生成图片：

```bash
node <skill-root>/scripts/imagemon.mjs generate --prompt "<提示词>" [选项]
node <skill-root>/scripts/imagemon.mjs generate --prompt-file <提示词文件> [选项]
```

编辑图片：

```bash
node <skill-root>/scripts/imagemon.mjs edit --image <图片路径> --prompt "<修改要求>" [选项]
node <skill-root>/scripts/imagemon.mjs edit --image <图片路径> --prompt-file <提示词文件> [选项]
```

可选参数：

- `--prompt-file <path>`：按 UTF-8 读取提示词；与 `--prompt` 必须且只能提供一个。多行、超长或不可信提示词应使用此参数。
- `--model <name>`：默认 `gpt-image-2`。
- `--size <size>`：`auto` 或 `WIDTHxHEIGHT`。
- `--quality <quality>`：`auto`、`low`、`medium` 或 `high`。
- `--format <format>`：`png`、`jpeg` 或 `webp`。
- `--n <integer>`：生成数量。
- `--out <directory>`：输出目录，默认 `./outputs`。
- `--mask <path>`：编辑任务使用的遮罩图。
- `--config <path>`：显式配置文件路径。

Skill 不应传递 `--api-key`。只有用户明确要求使用兼容平台时才传递 `--base-url`，并且不得将 URL
拼接到具体图片接口。

## 输出协议

图片任务的 stdout 始终是唯一一行 JSON。成功格式：

```json
{"ok":true,"files":["/abs/path/output.png"],"metadataPath":"/abs/path/output.json","usage":{}}
```

失败格式：

```json
{"ok":false,"files":[],"metadataPath":null,"error":{"code":"INVALID_OPTION","message":"错误信息"}}
```

- `INVALID_OPTION`：参数语法或必填参数错误。
- `EXECUTION_ERROR`：配置、API 请求、图片下载或文件写入错误。
- 成功退出码为 `0`，失败退出码非 `0`。
- `--help` 和 `--version` 写入 stderr，不写入 stdout。
