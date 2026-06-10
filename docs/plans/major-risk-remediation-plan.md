# 主要风险修复执行方案

## 目标

本方案修复以下五项主要风险：

1. SDK `baseName` 可导致输出路径逃逸。
2. URL 图片安全下载存在 DNS rebinding 时间差。
3. 配置文件声明支持 `maxRetries`，但实现未读取。
4. 统一验证未覆盖 Promptdex 模板、覆盖率门槛和远端 CI。
5. CLI 版本号与 `package.json` 重复维护。

每项风险作为一个独立修复任务实施。一个任务只能包含解决该风险所必需的生产代码、测试、文档和生成产物；任务验证通过后必须立即提交，禁止把多个任务合并到同一个提交。

## 全局执行规则

### 方案文档提交

本方案文档不属于任一风险修复。开始任务 1 前，应先将本文件作为独立文档提交，避免后续修复提交夹带方案文件：

```bash
git add docs/plans/major-risk-remediation-plan.md
git commit -m "docs: 添加主要风险修复执行方案"
```

### 开始前基线

在第一个任务开始前执行：

```bash
git status --short --branch
npm run verify
node skills/imagemon-promptdex/scripts/validate_templates.mjs
```

要求：

- 工作树不存在与本方案无关的改动。
- 当前构建、类型检查、测试、Skill bundle 校验和 Promptdex 模板校验全部通过。
- 如果基线失败，先定位已有问题，不得通过修改测试、断言、Mock、Fixture 或跳过测试绕过失败。

### 单任务循环

每个任务严格执行以下循环：

1. 只修改该任务“允许改动范围”列出的文件。
2. 为新增或变更行为补充回归测试；测试用于证明风险已被消除，不得放宽已有断言。
3. 修改 `src/` 后执行 `npm run build:skill`，将同步后的 `skills/imagemon/scripts/imagemon.mjs` 纳入同一提交。
4. 执行该任务列出的专项验证。
5. 执行当时可用的完整验证链。
6. 使用 `git diff --check`、`git diff --stat` 和 `git status --short` 确认提交范围。
7. 只暂存当前任务文件并立即创建一次 Git commit。
8. 提交后执行 `git status --short`，确认没有遗漏当前任务改动，再开始下一任务。

任务 1 至任务 3 在任务 4 完成前使用：

```bash
npm run verify
node skills/imagemon-promptdex/scripts/validate_templates.mjs
```

任务 4 完成后，任务 4 和任务 5 使用新的统一验证入口：

```bash
npm run verify
```

任何验证失败都必须修复当前任务的生产代码或配置，不得通过修改测试预期来掩盖失败。发现问题属于其他任务时，记录并留待对应任务处理，不混入当前提交。

## 任务 1：限制图片输出基础名范围

### 修复目标

保证 SDK 调用方提供的 `baseName` 只能生成 `outDir` 的直接子文件，不能通过绝对路径、`..`、正反斜杠或平台差异逃逸输出目录。

### 实现方案

在 `src/lib/image-output.ts` 增加集中式基础名校验，并在创建临时目录、下载图片或写入任何文件前执行。

校验规则：

- `baseName` 必须是非空字符串，去除首尾空白后仍不能为空。
- 禁止绝对路径。
- 禁止 `.` 和 `..`。
- 禁止 `/`、`\` 和 NUL 字符，确保在 POSIX 与 Windows 语义下都只是单一文件名。
- 生成每个最终路径后，再使用 `relative(outDir, candidatePath)` 做纵深防御；结果为绝对路径、等于 `..` 或以 `../` 开头时拒绝写入。
- 自动生成的基础名继续沿用现有逻辑，但最终路径同样经过目录包含校验。
- 校验失败时抛出明确的执行错误，不创建输出文件或临时目录。

不改变以下行为：

- 合法基础名的文件命名格式。
- 默认拒绝覆盖和 `overwrite: true` 的覆盖语义。
- CLI 自动生成输出名的行为。

### 允许改动范围

- `src/lib/image-output.ts`
- `test/image-output.test.ts`
- `README.md`，仅补充 `baseName` 安全约束
- `skills/imagemon/scripts/imagemon.mjs`，由 `npm run build:skill` 生成

### 回归测试

在 `test/image-output.test.ts` 增加：

- 拒绝 `../escape`。
- 拒绝绝对路径。
- 拒绝包含 `/` 或 `\` 的基础名。
- 拒绝空白、`.` 和 `..`。
- 每种失败场景均断言 `outDir` 内外没有新增最终文件或临时目录。
- 合法基础名与 `overwrite: true` 的已有行为仍然通过。

### 专项验证

```bash
npm test -- test/image-output.test.ts
npm run build:skill
npm run check:skill
npm run verify
node skills/imagemon-promptdex/scripts/validate_templates.mjs
```

### 提交

```bash
git add src/lib/image-output.ts test/image-output.test.ts README.md skills/imagemon/scripts/imagemon.mjs
git commit -m "fix: 限制图片输出基础名范围"
```

### 验收标准

- 任意调用方控制的 `baseName` 都不能在 `outDir` 外创建、覆盖或删除文件。
- 拒绝请求不会留下部分输出。
- 全部验证通过，提交仅包含本任务文件。

## 任务 2：绑定安全下载的已校验地址

### 修复目标

消除“先通过 DNS 校验域名，随后实际连接时再次解析并可能切换到私网地址”的时间差，保证默认下载链路连接到已经校验过的地址。

### 实现方案

重构 `src/lib/image-download.ts` 的默认网络传输：

- 对每个初始 URL 和重定向 URL 分别解析主机名。
- 保留“解析结果中只要存在私网、环回、链路本地、保留或其他禁止地址就整体拒绝”的现有策略。
- 将通过校验的地址及地址族保存为本次请求的固定连接目标。
- 默认下载使用 Node `http.request` / `https.request`，通过请求的 `lookup` 回调返回已经校验的固定地址；请求 URL 仍保留原主机名，使 HTTPS SNI、证书校验和 `Host` 头保持正确。
- 每次重定向都重新执行协议、凭据、DNS 和固定连接目标校验。
- 保留总超时、最大响应体、`Content-Length`、允许的 `Content-Type`、重定向上限和错误 URL 脱敏行为。
- HTTP 仅在 `allowHttp: true` 时允许；私网仅在 `allowPrivateNetwork: true` 时允许。

`ImageDownloadOptions.fetch` 无法约束自定义实现的 DNS 和连接行为，因此将其明确为可信传输覆盖：

- 默认安全链路不再依赖 `fetch`。
- 使用自定义 `fetch` 时必须同时显式设置 `allowPrivateNetwork: true`，表示调用方主动接管目标网络安全责任。
- README 和 SDK 类型注释必须明确该边界，避免调用方误以为自定义 `fetch` 仍具备 DNS 固定保证。

为保持代码可测试性，可增加最小的 DNS 解析依赖注入点；该注入点只控制解析结果，不能绕过地址校验。

### 允许改动范围

- `src/lib/image-download.ts`
- `src/lib/image.types.ts`，仅在下载公开类型确有需要时修改
- `test/image-download.test.ts`
- `test/image-output.test.ts`，仅适配可信自定义传输的显式选项
- `README.md`
- `skills/imagemon/references/cli-contract.md`，仅补充下载安全边界时修改
- `skills/imagemon/scripts/imagemon.mjs`，由 `npm run build:skill` 生成

### 回归测试

覆盖以下场景：

- 域名解析得到公网地址后，实际请求的 `lookup` 只能返回该已校验地址，不进行第二次 DNS 解析。
- 模拟第一次解析为公网、后续解析为私网的 rebinding 场景，证明连接目标仍是第一次通过校验的地址。
- 任一解析结果为私网时，在发起请求前失败。
- 重定向目标重新解析并绑定，重定向到私网时失败。
- HTTPS 请求保留原主机名用于 SNI 和 `Host`。
- 自定义 `fetch` 未显式允许私网时失败；显式接管安全责任时保持兼容。
- 现有超时、响应体大小、Content-Type、状态码、凭据和敏感查询参数保护测试继续通过。

### 专项验证

```bash
npm test -- test/image-download.test.ts test/image-output.test.ts
npm run build:skill
npm run check:skill
npm run verify
node skills/imagemon-promptdex/scripts/validate_templates.mjs
```

### 提交

```bash
git add src/lib/image-download.ts src/lib/image.types.ts test/image-download.test.ts test/image-output.test.ts README.md skills/imagemon/references/cli-contract.md skills/imagemon/scripts/imagemon.mjs
git commit -m "fix: 绑定安全下载的已校验地址"
```

暂存前应删除命令中实际未修改的路径，禁止为了匹配方案而制造无意义改动。

### 验收标准

- 默认下载连接地址与安全校验使用同一份 DNS 解析结果。
- 初始请求及每次重定向都不存在重新解析后连接私网地址的窗口。
- 自定义传输的信任边界明确且必须显式启用。
- 全部验证通过，提交仅包含本任务文件。

## 任务 3：统一 `maxRetries` 配置契约

### 修复目标

使配置文件中的 `maxRetries` 与文档、环境变量和函数参数行为一致，不再静默忽略。

### 实现方案

在 `src/lib/image.ts` 中：

- 为 `ImageConfigFile` 增加 `maxRetries?: number`。
- 按与 `timeout` 相同的标准校验：必须是非负整数。
- 从配置文件返回并读取该字段。
- 最终优先级固定为：

```text
ImageClientOptions.maxRetries > 配置文件 maxRetries > IMAGEMON_API_MAX_RETRIES > OpenAI SDK 默认值
```

- 非法配置必须在网络请求前抛出明确错误。

同步 README 和 Skill CLI 契约，保证配置示例、优先级和实现一致。

### 允许改动范围

- `src/lib/image.ts`
- `test/image.test.ts`
- `README.md`
- `skills/imagemon/references/cli-contract.md`
- `skills/imagemon/scripts/imagemon.mjs`，由 `npm run build:skill` 生成

### 回归测试

在 `test/image.test.ts` 增加或完善：

- 配置文件 `maxRetries` 被客户端读取。
- 函数参数覆盖配置文件。
- 配置文件覆盖环境变量。
- 未提供配置文件值时读取环境变量。
- 负数、小数、字符串等非法配置在请求前失败。

测试应通过读取客户端实际 `maxRetries` 或可观察请求行为验证，不只验证文档内容。

### 专项验证

```bash
npm test -- test/image.test.ts
npm run build:skill
npm run check:skill
npm run verify
node skills/imagemon-promptdex/scripts/validate_templates.mjs
```

### 提交

```bash
git add src/lib/image.ts test/image.test.ts README.md skills/imagemon/references/cli-contract.md skills/imagemon/scripts/imagemon.mjs
git commit -m "fix: 支持配置文件设置重试次数"
```

### 验收标准

- `maxRetries` 的所有配置来源均有效且优先级明确。
- 非法值不会被静默忽略。
- 文档、Skill 契约和实现一致。
- 全部验证通过，提交仅包含本任务文件。

## 任务 4：完善统一验证与持续集成

### 修复目标

让本地 `npm run verify` 和 GitHub CI 使用同一验证入口，覆盖构建、类型检查、测试覆盖率、普通 Skill bundle 和 Promptdex 模板。

### 实现方案

更新项目脚本与配置：

- 新增 `check:promptdex`，执行 `node skills/imagemon-promptdex/scripts/validate_templates.mjs`。
- 新增 `test:coverage`，使用 Vitest coverage provider 执行全部测试。
- 新增 `vitest.config.ts`，设置初始全局覆盖率门槛：
  - statements：80%
  - branches：75%
  - functions：85%
  - lines：80%
- 更新 `verify`，按以下顺序执行：

```text
build -> typecheck -> test:coverage -> check:skill -> check:promptdex
```

- 在 `devDependencies` 中显式加入与当前 Vitest 主版本兼容的 coverage provider。
- 新增 `.github/workflows/verify.yml`：
  - 在 push 和 pull_request 时运行。
  - 使用 Node.js 20，与 Skill 运行时要求一致。
  - 执行 `npm ci` 和 `npm run verify`。
  - 使用 npm 缓存。
- README 只保留 `npm run verify` 作为提交前统一验证入口，并说明其覆盖内容。

覆盖率门槛低于当前报告，但足以防止明显退化；后续提高门槛应作为独立质量任务，不混入本提交。

### 允许改动范围

- `package.json`
- `package-lock.json`
- `vitest.config.ts`
- `.github/workflows/verify.yml`
- `README.md`

### 验证

```bash
npm run check:promptdex
npm run test:coverage
npm run verify
git diff --check
```

如果 GitHub Actions 尚未实际运行，本地验收只确认工作流语法、Node 版本和命令与本地一致；远端首次运行结果需在推送后确认。

### 提交

```bash
git add package.json package-lock.json vitest.config.ts .github/workflows/verify.yml README.md
git commit -m "ci: 完善统一验证与持续集成"
```

### 验收标准

- `npm run verify` 单独覆盖全部本地质量检查。
- 覆盖率低于门槛时命令失败。
- Promptdex 模板无效时命令失败。
- GitHub CI 使用 `npm run verify`，不复制另一套检查逻辑。
- 全部验证通过，提交仅包含本任务文件。

## 任务 5：从包元数据提供 CLI 版本

### 修复目标

移除 `src/cli.ts` 中硬编码的版本号，使 `package.json` 成为唯一版本来源，并保证 TypeScript 构建和自包含 Skill bundle 都能获得同一版本。

### 实现方案

采用构建工具可静态处理的 JSON 模块导入：

- 在 `src/cli.ts` 从根目录 `package.json` 导入版本字段，移除硬编码 `CLI_VERSION`。
- 必要时在 `tsconfig.json` 增加 JSON 模块解析配置。
- 普通 TypeScript 构建产物运行时从包根目录读取 `package.json`。
- `npm run build:skill` 使用 esbuild 将版本值内联进自包含 bundle，bundle 运行时不得依赖仓库中的 `package.json`。
- CLI 测试从 `package.json` 获取期望版本，不再重复写死 `0.1.0`。
- 保留 `scripts/check-skill.mjs` 对 bundle 版本与 `package.json` 一致性的现有校验。

如果验证表明当前 Node.js 20、TypeScript NodeNext 或 esbuild 对 JSON import attributes 的组合不稳定，则使用专门的构建时版本注入脚本作为备选。备选方案仍必须保证 `package.json` 是唯一人工维护的版本来源，且不能生成需要人工同步的第二个版本文件。

### 允许改动范围

- `src/cli.ts`
- `test/cli.test.ts`
- `tsconfig.json`，仅在 JSON 模块导入需要时修改
- `scripts/build-skill.mjs`，仅在采用构建时注入备选方案时修改
- `scripts/check-skill.mjs`，仅在保持版本一致性校验需要时修改
- `skills/imagemon/scripts/imagemon.mjs`，由 `npm run build:skill` 生成

### 回归测试

- `runImagemonCli(["--version"])` 输出等于 `package.json.version`。
- `dist/cli.js --version` 输出等于 `package.json.version`。
- 自包含 Skill bundle 在不依赖仓库 `package.json` 的临时目录中输出同一版本。
- `check:skill` 继续检测 bundle 与源码或版本不一致。

### 验证

```bash
npm test -- test/cli.test.ts test/skill-bundle.test.ts
npm run build
node dist/cli.js --version
npm run build:skill
npm run verify
```

### 提交

```bash
git add src/cli.ts test/cli.test.ts tsconfig.json scripts/build-skill.mjs scripts/check-skill.mjs skills/imagemon/scripts/imagemon.mjs
git commit -m "build: 统一 CLI 版本来源"
```

暂存前应删除命令中实际未修改的路径。

### 验收标准

- 仓库只有 `package.json.version` 需要人工维护。
- SDK/CLI 构建与自包含 Skill bundle 输出同一版本。
- `npm run verify` 全部通过。
- 提交仅包含本任务文件。

## 最终验收

五个任务全部提交后执行：

```bash
git status --short --branch
git log --oneline -5
npm run verify
```

要求：

- 工作树干净。
- 最近五个提交分别对应五个风险，顺序与本方案一致。
- 不存在包含多个风险修复的巨型提交。
- `npm run verify` 完整通过。

预期提交序列：

```text
fix: 限制图片输出基础名范围
fix: 绑定安全下载的已校验地址
fix: 支持配置文件设置重试次数
ci: 完善统一验证与持续集成
build: 统一 CLI 版本来源
```
