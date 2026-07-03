# 移动端模型配置与首次设置竖切执行计划

本文记录下一阶段移动端开发的可执行方案。目标是先闭合“就绪默认模型配置”这条产品主链路，再进入图片任务、模板提炼、图片结果和任务历史。

## 目标

完成一个本地可用的移动端竖切：

- 首次设置可以创建或跳过默认模型配置。
- 模型配置非敏感字段保存在 SQLite。
- API Key 保存在 SecureStore。
- 测试连接使用窄 `fetch` 适配器，不引入 OpenAI SDK。
- 测试通过后配置可标记为就绪。
- 首次设置中的测试通过会设为对应默认模型配置。
- 设置页可以查看、创建、编辑、测试、设默认和删除模型配置。
- 移动端提供独立 `mobile:verify` 验证入口。

## 范围内

- `apps/mobile` 内的 Expo React Native 实现。
- `apps/mobile/src/storage` 中的 SQLite 初始化、迁移、设置和凭据适配。
- `apps/mobile/src/model-configurations` 中的模型配置类型、校验、仓储、测试连接和 hooks。
- 首次设置全屏流程。
- 设置 Tab 中的模型配置列表和详情入口。
- 当前页面内的测试连接失败摘要。
- 最小全局模型调用锁接口，用于阻止并发测试连接和未来模型调用。
- fail closed 的初始化失败状态。

## 范围外

- 图片任务、模板提炼、图片结果和任务历史。
- 拉取模型列表辅助选择。
- 供应商预设。
- OpenAI SDK 或真实图片/文本模型调用。
- 测试连接取消能力。
- 测试连接跨页面继续。
- 完整全局顶部状态条。
- 完整只读恢复模式和 ZIP 抢救入口。
- 自动化测试访问真实网络或真实模型服务。
- iOS/Android 原生构建作为本竖切验收条件。

## 关键决策

- 默认模型配置引用保存在应用设置中，不放 `isDefault` 到模型配置记录。
- 首次设置完成或跳过有独立持久状态，不从默认配置是否存在推断。
- 模型配置测试失败摘要只在当前页面会话内显示，不持久化。
- 配置 ID 由应用层生成稳定字符串；SecureStore key 由配置 ID 派生。
- 时间字段使用 ISO 8601 UTC 字符串，以 SQLite `TEXT` 保存。
- `app_settings` 使用单行固定 schema。
- SQLite schema 版本使用 `schema_migrations` 表。
- schema v1 只做事务内初始化；未来 v2 再补升级前快照和迁移回滚。
- 初始化或迁移失败必须 fail closed，不允许继续写入、测试或完成首次设置。

## 数据模型草案

### `schema_migrations`

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

### `model_configurations`

```sql
CREATE TABLE IF NOT EXISTS model_configurations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('image', 'text')),
  base_url TEXT NOT NULL,
  model_name TEXT NOT NULL,
  has_credential INTEGER NOT NULL CHECK (has_credential IN (0, 1)),
  is_ready INTEGER NOT NULL CHECK (is_ready IN (0, 1)),
  last_test_succeeded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### `app_settings`

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY CHECK (id = 'app'),
  default_image_model_configuration_id TEXT,
  default_text_model_configuration_id TEXT,
  first_run_setup_completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (default_image_model_configuration_id)
    REFERENCES model_configurations(id) ON DELETE SET NULL,
  FOREIGN KEY (default_text_model_configuration_id)
    REFERENCES model_configurations(id) ON DELETE SET NULL
);
```

仓储层必须额外保证：

- `default_image_model_configuration_id` 只能指向 `type = 'image'` 且 `is_ready = 1` 的配置。
- `default_text_model_configuration_id` 只能指向 `type = 'text'` 且 `is_ready = 1` 的配置。
- 影响调用行为的字段或凭据变化后，立即把配置设为未就绪，并清除对应默认引用。
- 删除默认配置时清除对应默认引用。

## SecureStore 规则

SecureStore key 由配置 ID 派生：

```ts
`imagemon.model-configuration-api-key.${configurationId}`
```

SQLite 只保存 `has_credential`，不保存 API Key 明文，也不保存可漂移的 credential key 字段。

## 测试连接规则

- 先保存配置，再测试连接。
- 请求 URL：去掉 `base_url` 末尾 `/` 后拼接 `/models`。
- HTTP 方法：`GET`。
- 请求头：`Authorization: Bearer <apiKey>`，`Accept: application/json`。
- 固定 30 秒应用侧超时，不提供用户配置。
- 2xx 判通过。
- 400、404 等非鉴权、非传输响应按 ADR 0198 判通过。
- 401 判 `unauthorized`。
- 403 判 `forbidden`。
- 429 判 `rate_limited`。
- 5xx 判 `server_error`。
- 网络失败判 `network_error`。
- 超时判 `timeout`。
- 无法形成有效 HTTP 响应判 `invalid_response`。
- 其他异常判 `unknown_error`。
- 失败摘要只在当前页面会话内展示，离开页面、再次测试开始、字段或 API Key 修改、配置删除时清除。

## 校验规则

- 模型配置不保存独立名称，也不做名称唯一性校验。
- base URL 做 ADR 0125 的最小基础校验：非空、可解析、协议为 `https:`、host 非空、不能写到具体图片接口路径，例如 `/images/generations` 或 `/images/edits`。
- 模型名只校验非空，不校验是否存在，也不校验模型能力。
- API Key 可以缺失并保存为未就绪草稿，但测试连接必须有凭据。
- 配置详情页中 API Key 输入为空表示保留原凭据；只有明确点击“清除凭据”才删除，只有输入新 Key 并保存才替换。

## 首次设置规则

- 首次启动且没有 `first_run_setup_completed_at` 时显示全屏首次设置。
- 完成或跳过后进入四个 Tab。
- 跳过不创建默认配置。
- 允许只完成图片模型配置或只完成文本模型配置。
- 图片任务入口后续按是否存在就绪默认图片模型配置拦截。
- 模板提炼入口后续按是否存在就绪默认文本模型配置拦截。
- base URL 默认填 `https://api.openai.com/v1`。
- 图片模型名默认填 `gpt-image-2`。
- 文本模型名不硬编码默认值。
- 提供“文本模型使用相同连接信息”开关，但只复制表单内容，不实时绑定。
- 图片区和文本区各自提供“保存并测试”按钮。
- 首次设置中的“保存并测试”成功后，自动设为对应默认配置。
- 测试通过后锁定该配置区，提供“修改”按钮。
- 点击“完成”时，如果存在未保存编辑，必须拦截，让使用者选择保存测试或放弃修改。

## 设置页规则

- 设置 Tab 提供“模型配置”入口。
- 模型配置列表按图片模型配置和文本模型配置分组。
- 列表显示名称、模型名、base URL 简要、就绪或未就绪、当前默认状态。
- 列表不显示测试失败原因，也不提供直接设默认。
- 详情页允许保存未就绪草稿。
- 详情页只对就绪且尚未成为对应默认的配置显示或启用“设为默认”。
- 普通详情页测试成功只标记就绪，不自动设默认。
- 删除配置需要二次确认，删除时同步删除 SecureStore 凭据。
- 测试连接进行中禁止保存、删除、返回和再次测试。

## 自动化测试策略

- 不打真实网络。
- 不需要真实 API Key。
- 测试连接使用 mock `fetch`。
- SecureStore 通过可替换凭据适配器测试。
- 时间和 ID 生成器可注入。
- 重点测试仓储和测试连接适配层，UI 先用类型检查和轻量组件逻辑保证。

## 验证入口

新增：

```bash
npm run mobile:test
npm run mobile:verify
```

建议语义：

```json
{
  "scripts": {
    "mobile:test": "npm run test --workspace @imagemon/mobile",
    "mobile:verify": "npm run mobile:typecheck && npm run mobile:test"
  }
}
```

`mobile:verify` 不进入根 `npm run verify`，避免 Expo 移动端环境阻塞 CLI/Skill 发布链路。

## 提交分解

每完成一个任务后都单独提交。提交信息统一使用中文。

### 任务 0：提交领域决策与本计划

修改范围：

- `CONTEXT.md`
- `docs/adr/0199-default-model-configuration-ids-live-in-app-settings.md`
- `docs/adr/0200-first-run-setup-completion-is-explicit-state.md`
- `docs/adr/0201-model-configuration-test-failure-summary-is-session-only.md`
- `docs/plans/mobile-model-configuration-first-run-setup.md`

验收：

- 文档表达与本计划一致。
- 新 ADR 编号连续。

提交点：

```bash
git add CONTEXT.md docs/adr/0199-default-model-configuration-ids-live-in-app-settings.md docs/adr/0200-first-run-setup-completion-is-explicit-state.md docs/adr/0201-model-configuration-test-failure-summary-is-session-only.md docs/plans/mobile-model-configuration-first-run-setup.md
git commit -m "记录移动端模型配置竖切决策与计划"
```

### 任务 1：建立移动端测试与验证入口

修改范围：

- `apps/mobile/package.json`
- `package.json`
- `apps/mobile/vitest.config.ts`
- 必要的测试 setup 文件。

实现要点：

- 给 `@imagemon/mobile` 增加 `test` 脚本。
- 根包增加 `mobile:test` 和 `mobile:verify`。
- 测试只覆盖纯 TypeScript 逻辑，不依赖真实 Expo 原生运行时。

验收：

```bash
npm run mobile:verify
```

提交点：

```bash
git add package.json package-lock.json apps/mobile/package.json apps/mobile/vitest.config.ts apps/mobile
git commit -m "增加移动端独立验证入口"
```

### 任务 2：调整移动端路由骨架

修改范围：

- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/(tabs)/_layout.tsx`
- `apps/mobile/app/(tabs)/index.tsx`
- `apps/mobile/app/(tabs)/images.tsx`
- `apps/mobile/app/(tabs)/history.tsx`
- `apps/mobile/app/(tabs)/settings.tsx`
- 后续详情页占位路由。

实现要点：

- 根布局改为 Stack。
- 四个底部 Tab 移到 `(tabs)` route group。
- 保留图鉴、图片、历史、设置四个入口。
- 为首次设置和模型配置详情留出非 Tab 路由。

验收：

```bash
npm run mobile:typecheck
```

提交点：

```bash
git add apps/mobile/app
git commit -m "调整移动端路由骨架"
```

### 任务 3：实现 SQLite schema v1 与初始化 fail closed

修改范围：

- `apps/mobile/src/storage`
- `apps/mobile/src/storage/*.test.ts`

实现要点：

- 使用 `expo-sqlite` 的 `openDatabaseAsync`、`execAsync`、`runAsync`、`getFirstAsync`、`getAllAsync` 和 `withTransactionAsync`。
- 初始化时事务内创建 `schema_migrations`、`model_configurations`、`app_settings`。
- 初始化默认 `app_settings` 单行记录。
- 记录 schema version 1。
- 初始化失败返回显式失败状态，应用层不得继续写操作。
- 第一版不做升级前数据库快照。

验收：

```bash
npm run mobile:verify
```

提交点：

```bash
git add apps/mobile/src/storage apps/mobile
git commit -m "实现移动端 SQLite 初始 schema"
```

### 任务 4：实现基础工具和凭据适配器

修改范围：

- `apps/mobile/src/storage`
- `apps/mobile/src/model-configurations`

实现要点：

- 增加 ISO UTC 时间生成器。
- 增加可注入 ID 生成器，运行时优先使用 `globalThis.crypto.randomUUID()`。
- 增加 SecureStore 凭据适配器，封装 `getItemAsync`、`setItemAsync`、`deleteItemAsync`。
- 按配置 ID 派生 SecureStore key。
- 测试覆盖保存、读取、替换、删除和 key 派生。

验收：

```bash
npm run mobile:verify
```

提交点：

```bash
git add apps/mobile/src/storage apps/mobile/src/model-configurations
git commit -m "实现模型配置凭据适配器"
```

### 任务 5：实现模型配置领域类型与校验

修改范围：

- `apps/mobile/src/model-configurations`
- 对应测试。

实现要点：

- 定义 `ModelConfigurationType = "image" | "text"`。
- 定义配置实体、保存输入、测试失败摘要、仓储接口。
- 实现 base URL、模型名校验。
- base URL 校验按 ADR 0125。
- 不实现模型列表或能力校验。

验收：

```bash
npm run mobile:verify
```

提交点：

```bash
git add apps/mobile/src/model-configurations
git commit -m "实现模型配置校验规则"
```

### 任务 6：实现模型配置仓储

修改范围：

- `apps/mobile/src/model-configurations/repository.ts`
- `apps/mobile/src/model-configurations/*.test.ts`
- `apps/mobile/src/storage`

实现要点：

- 支持创建、读取、列表、更新、删除。
- 支持设置和清除默认模型配置。
- 支持读取和更新首次设置完成状态。
- 保存草稿不要求 API Key。
- 不保存模型配置名称，同类型内可以有多条模型名或 base URL 相同的配置。
- 影响调用行为字段变化后清除就绪状态、最近测试成功时间和对应默认引用。
- 替换或清除凭据后清除就绪状态、最近测试成功时间和对应默认引用。
- 删除配置时删除派生 SecureStore key，并清除对应默认引用。

验收：

```bash
npm run mobile:verify
```

提交点：

```bash
git add apps/mobile/src/model-configurations apps/mobile/src/storage
git commit -m "实现模型配置仓储"
```

### 任务 7：实现测试连接适配器

修改范围：

- `apps/mobile/src/model-configurations/test-connection.ts`
- 对应测试。

实现要点：

- 接收 `fetch`、时间和超时参数注入。
- 使用 `GET ${normalizedBaseUrl}/models`。
- 固定默认 30 秒超时。
- 不发送模型名和任务内容。
- 按 ADR 0198 映射成功和失败。
- 失败摘要只作为返回值，不写入持久存储。

验收：

```bash
npm run mobile:verify
```

提交点：

```bash
git add apps/mobile/src/model-configurations
git commit -m "实现模型配置测试连接适配器"
```

### 任务 8：实现最小模型调用锁

修改范围：

- `apps/mobile/src/model-calls`
- `apps/mobile/app/_layout.tsx`

实现要点：

- 提供 React context。
- 支持开始和结束 `modelConfigurationTest`。
- 同一时间只允许一个模型调用。
- 当前竖切不做顶部状态条。
- 当前竖切不做取消。
- 测试连接中页面内显示进行中，禁用保存、删除、返回和再次测试。

验收：

```bash
npm run mobile:verify
```

提交点：

```bash
git add apps/mobile/src/model-calls apps/mobile/app
git commit -m "增加最小模型调用锁"
```

### 任务 9：接入应用初始化和首次设置 gate

修改范围：

- `apps/mobile/app/_layout.tsx`
- `apps/mobile/src/storage`
- `apps/mobile/src/app-state` 或同等目录。

实现要点：

- 启动时初始化数据库。
- 初始化中显示加载态。
- 初始化失败显示 fail closed 错误态，不允许进入写操作。
- 无 `first_run_setup_completed_at` 时显示首次设置。
- 完成或跳过后进入 Tab。

验收：

```bash
npm run mobile:verify
```

提交点：

```bash
git add apps/mobile/app apps/mobile/src
git commit -m "接入首次设置启动 gate"
```

### 任务 10：实现首次设置页面静态表单

修改范围：

- `apps/mobile/app/first-run.tsx`
- `apps/mobile/src/first-run`
- 共享 UI 组件。

实现要点：

- 图片模型配置区和文本模型配置区分开。
- base URL 默认 `https://api.openai.com/v1`。
- 图片模型名默认 `gpt-image-2`。
- 文本模型名为空。
- “文本模型使用相同连接信息”只复制一次，不实时绑定。
- 提供“保存并测试图片模型”“保存并测试文本模型”“完成”“跳过”。
- 测试通过后配置区锁定，提供“修改”。

验收：

```bash
npm run mobile:typecheck
```

提交点：

```bash
git add apps/mobile/app/first-run.tsx apps/mobile/src/first-run apps/mobile/src/shared
git commit -m "实现首次设置表单界面"
```

### 任务 11：接入首次设置保存和测试流程

修改范围：

- `apps/mobile/src/first-run`
- `apps/mobile/src/model-configurations`
- `apps/mobile/app/first-run.tsx`

实现要点：

- 每个配置区先保存，再测试。
- 测试成功后设为对应默认配置。
- 两种类型互不回滚。
- 测试失败保留未就绪配置，并在当前页面显示会话态摘要。
- “完成”允许只完成一种类型。
- 有未保存编辑时拦截完成，让使用者保存测试或放弃修改。
- “跳过”只写入首次设置完成时间。

验收：

```bash
npm run mobile:verify
```

提交点：

```bash
git add apps/mobile/app/first-run.tsx apps/mobile/src/first-run apps/mobile/src/model-configurations
git commit -m "接入首次设置保存测试流程"
```

### 任务 12：实现设置页模型配置列表

修改范围：

- `apps/mobile/app/(tabs)/settings.tsx`
- `apps/mobile/app/model-configurations/index.tsx`
- `apps/mobile/src/model-configurations`

实现要点：

- 设置页提供模型配置入口。
- 列表按图片模型配置和文本模型配置分组。
- 显示模型名、base URL 简要、就绪或未就绪、当前默认。
- 不显示失败摘要。
- 不提供列表直接设默认。

验收：

```bash
npm run mobile:typecheck
```

提交点：

```bash
git add apps/mobile/app apps/mobile/src/model-configurations
git commit -m "实现模型配置列表页"
```

### 任务 13：实现模型配置详情和新建页

修改范围：

- `apps/mobile/app/model-configurations/new.tsx`
- `apps/mobile/app/model-configurations/[id].tsx`
- `apps/mobile/src/model-configurations`
- 共享表单组件。

实现要点：

- 支持保存未就绪草稿。
- 支持 API Key 留空保留原凭据。
- 支持明确清除凭据。
- 支持显式测试连接。
- 普通详情页测试成功只标记就绪，不自动设默认。
- 只对就绪且非默认配置显示或启用“设为默认”。
- 支持删除并二次确认。
- 测试进行中禁用返回、保存、删除和再次测试。

验收：

```bash
npm run mobile:verify
```

提交点：

```bash
git add apps/mobile/app/model-configurations apps/mobile/src/model-configurations apps/mobile/src/shared
git commit -m "实现模型配置详情管理"
```

### 任务 14：补齐入口拦截和占位提示

修改范围：

- `apps/mobile/app/(tabs)/index.tsx`
- `apps/mobile/app/(tabs)/settings.tsx`
- 必要的共享 hooks。

实现要点：

- 图鉴任务入口如无就绪默认图片模型配置，显示需要配置。
- 模板提炼入口如无就绪默认文本模型配置，显示需要配置。
- 当前竖切仍不实现真实图片任务或模板提炼。
- 设置页展示默认配置状态，便于手动修正。

验收：

```bash
npm run mobile:typecheck
```

提交点：

```bash
git add apps/mobile/app apps/mobile/src
git commit -m "补齐默认模型配置入口提示"
```

### 任务 15：最终收尾和移动端验证

修改范围：

- 只修正本竖切相关代码、文案和测试。
- 如发现 `README.md` 或 `docs/current-architecture.md` 对 `apps/mobile` 状态过期，可以单独更新。

验收：

```bash
npm run mobile:verify
npm run mobile:typecheck
git status --short
```

不要求：

```bash
npm run verify
```

除非本竖切修改了根包、shared core、Skill 或 CLI 发布链路。

提交点：

```bash
git add apps/mobile docs README.md package.json package-lock.json
git commit -m "完成移动端模型配置竖切收尾"
```

## 实施纪律

- 不修改测试来绕过失败。
- 每个任务完成后先运行该任务验收命令，再提交。
- 如果一个任务变大，继续拆成多个提交，不合并成大提交。
- 如果实现时发现新领域决策，先更新 `CONTEXT.md` 或新增 ADR，再继续编码。
- 如果发现现有 ADR 与当前实现计划冲突，先停下确认，不直接绕过。
- 自动化测试不得依赖真实网络、真实 API Key 或外部模型服务。
- 移动端代码不调用 Skill CLI，也不复用 Node 文件系统握手机制。
