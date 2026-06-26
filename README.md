# Imagemon 项目地图

Imagemon 当前仓库同时承载两层内容：

- 已落地的 Node.js/TypeScript Imagemon CLI、shared core、Promptdex 运行时和三个 Codex Skill 包。
- 面向未来本地优先手机端应用的领域模型、架构方向和 ADR 决策记录。

阅读和实现时应先区分“当前可运行事实”和“未来产品设计”。当前可运行事实以源码、Skill
契约和测试为准；手机端产品语义以 `CONTEXT.md`、`docs/current-architecture.md`
和 `docs/adr/` 为准，但尚未全部实现。

## 当前已实现

- `src/lib/image.ts`：OpenAI 兼容图片模型调用、配置读取、模型能力校验和图片响应归一化。
- `src/lib/image-output.ts`：图片文件、元数据文件和输出目录的原子写入与回滚。
- `src/lib/image-download.ts`：保存 URL 图片时的下载安全边界。
- `src/cli.ts`：`imagemon generate` 与 `imagemon edit` CLI，stdout 固定为单行 JSON。
- `packages/core`：平台无关领域逻辑，当前包含图片模型能力/规格校验和 Promptdex 模板解析/渲染。
- `.agents/skills/imagemon`：普通图片生成和编辑 Skill。
- `.agents/skills/imagemon-promptdex`：模板驱动图片任务 Skill。
- `.agents/skills/imagemon-promptdex-builder`：从外部完整提示词提炼 Promptdex 图鉴条目的 Skill。

发布前统一验证入口仍是：

```bash
npm run verify
```

## 当前未实现

仓库已经记录手机端产品方向，但当前还没有以下实现：

- `apps/mobile` Expo React Native 应用。
- SQLite 仓储、安全存储适配、移动端文件目录适配。
- ZIP 备份恢复实现。
- 移动端任务历史、图片结果、业务调用提示和模型配置页面。

实现手机端时不要直接复用 Skill 自带 CLI 的临时目录、子进程和文件权限握手机制。应按
`docs/current-architecture.md` 的方向，继续把平台无关语义沉淀到 `packages/core`，
再分别接入 CLI、Skill 和移动端适配层。

## 目录索引

- `src/`：根包 TypeScript 源码，提供 CLI 和当前导出库 API。
- `packages/core/`：私有 workspace 包 `@imagemon/core`，承载平台无关领域逻辑。
- `test/`：Vitest 测试，覆盖 CLI、图片调用、下载安全、输出写入、Promptdex 运行时和 Skill 结构。
- `.agents/skills/`：三个可发布 Skill 包及其自包含脚本、契约文档和触发样例。
- `scripts/`：Skill bundle 构建和结构校验脚本。
- `docs/current-architecture.md`：当前实现边界与手机端落地方向。
- `docs/adr/`：长期架构决策记录。
- `CONTEXT.md`：领域词汇表。讨论产品概念、移动端实现或 ADR 时优先使用这里的术语。
- `AGENTS.md`：协作约束和发布流程。

## 关键文档

- [当前架构导读](docs/current-architecture.md)：当前已实现范围、未实现范围和手机端落地方向。
- [领域词汇表](CONTEXT.md)：统一用语，例如模型配置、图片任务、图鉴条目、任务历史和 ZIP 备份。
- [Promptdex 模板契约](.agents/skills/imagemon-promptdex/references/template-contract.md)：图鉴条目格式、发现方式和完整提示词构建规则。
- [Imagemon CLI 契约](.agents/skills/imagemon/references/cli-contract.md)：Skill 调用 CLI 时的参数、配置优先级和 JSON 输出协议。
- [共享核心 ADR](docs/adr/0009-shared-core-with-platform-adapters.md)：未来 CLI、Skill 和手机端复用领域语义的方向。
- [Workspaces ADR](docs/adr/0056-introduce-npm-workspaces-with-mobile-client.md)：何时引入 `apps/mobile` 和 npm workspaces。

## 常用命令

```bash
npm run build          # 构建 core 与根包 dist
npm run typecheck      # core 与根包 TypeScript 类型检查
npm test               # 运行 Vitest 测试
npm run check:promptdex
npm run check:skill
npm run check:skills
npm run verify         # 发布前统一验证
```

修改 `src/cli.ts` 或底层图片能力后，需要运行：

```bash
npm run build:skill
```

并提交重新生成的：

- `.agents/skills/imagemon/scripts/imagemon.mjs`
- `.agents/skills/imagemon-promptdex/scripts/imagemon.mjs`

## 设计边界

- CLI 参数是收窄后的交互面，不因底层库类型支持更多字段就自动扩展。
- `@imagemon/core` 是仓库内部私有包，不作为对外 npm API 承诺。
- Skill bundle 必须由 `npm run build:skill` 生成，不手写自包含脚本。
- Promptdex 模板契约以 `.agents/skills/imagemon-promptdex/references/template-contract.md` 为运行时事实来源。
- Promptdex 任务通过 `promptdex-task.mjs` 的安全文件握手传递用户输入，不把用户内容拼接进命令行。
- 手机端不执行 Skill 自带 CLI，也不依赖 Node 文件系统安全模型。
- 测试失败时修复生产代码，不修改测试、断言、Mock、Fixture 或跳过测试来规避失败。

## 发布边界

发布由 `.github/workflows/release.yml` 在推送 `v<package.json version>` 标签时自动完成。
不要手工创建 GitHub Release，也不要推送与 `package.json` 版本不一致的发布标签。

推荐流程见 [AGENTS.md](AGENTS.md) 的“发布操作”。
