# 当前架构导读

本文记录当前仓库已经落地的系统边界，以及开始手机端实现时应遵守的拆分方向。详细领域词汇以 `CONTEXT.md` 为准，长期决策以 `docs/adr/` 为准。

## 当前已实现范围

当前仓库的可运行实现集中在 Imagemon CLI、shared core、Promptdex 脚本运行时、三个 Codex Skill 包，以及移动端模型配置竖切。

- 根包 `imagemon` 提供 TypeScript 实现、CLI 入口和构建脚本。
- `packages/core` 提供平台无关领域逻辑，当前包含图片模型能力/规格校验和 Promptdex 模板解析/渲染。
- `src/lib/image.ts` 负责 OpenAI 兼容图片模型调用和配置读取，并复用 `@imagemon/core` 的图片领域校验。
- `src/lib/image-output.ts` 负责图片文件、元数据文件和输出目录的原子写入。
- `src/lib/image-download.ts` 负责保存 URL 图片时的下载安全边界。
- `.agents/skills/imagemon` 发布普通图片生成和编辑 Skill。
- `.agents/skills/imagemon-promptdex` 发布模板驱动图片任务 Skill。
- `.agents/skills/imagemon-promptdex-builder` 发布从外部完整提示词提炼图鉴条目的 Skill。
- `apps/mobile` 提供 Expo React Native 应用骨架、首次设置、模型配置管理、SQLite schema、安全存储凭据适配和模型配置测试连接。

这些能力已经有测试和发布校验保护。`npm run verify` 仍是 Skill/CLI 发布前的统一验证入口。

## 当前未实现范围

`CONTEXT.md` 与大量 ADR 已定义手机端产品领域，但当前移动端还没有生成任务、任务历史、任务快照、图片结果、业务调用提示、Promptdex 图鉴浏览、模板提炼或 ZIP 备份恢复实现。

这些内容不是现有 CLI/Skill 的隐藏功能，而是手机端落地阶段要实现的产品能力。实现时应避免把 Node CLI 的临时目录、子进程、安全文件握手等机制直接搬进手机端。

## 导出库 API 的定位

`package.json` 通过 `main`、`types` 和 `exports` 暴露 `dist/index.js`，因此其他 TypeScript/Node 代码可以写：

```ts
import { generateImage } from "imagemon";
```

这就是“导出库 API”。当前它更适合作为仓库内部共享能力的过渡入口，而不是对外承诺长期兼容的公共 npm API。手机端落地后，应把平台无关能力沉淀到 shared core，再由 CLI、Skill 和移动端通过各自适配层调用。

## 手机端落地方向

手机端已经从规划进入实现，仓库已按 ADR 0056 引入 npm workspaces，并完成模型配置与首次设置竖切。后续移动端实现仍应继续保持根包现有 CLI/Skill 发布流程独立，不急于迁移所有逻辑。

建议的代码边界：

- `apps/mobile`：Expo React Native 应用，承载页面、导航、平台权限和移动端适配。
- `packages/core`：平台无关领域逻辑；当前已有 Promptdex 契约解析/渲染、图片规格校验和模型能力知识，后续可继续沉淀任务快照构建和错误摘要归一化。
- `apps/mobile/src/storage`：SQLite schema、应用设置和安全存储适配；后续继续扩展图片文件目录适配。
- `apps/mobile/src/image-tasks`：移动端图片任务、任务历史、任务快照、图片结果、模型调用适配和错误摘要归一化。
- 根包现有 CLI/Skill 构建继续独立，不被 Expo 原生依赖牵连。

## 关键边界

- CLI 参数是刻意收窄的交互面，不因底层库类型支持更多字段就自动扩展 CLI。
- Skill 自包含 bundle 仍必须由 `npm run build:skill` 生成，并与源码保持一致。
- Promptdex 模板契约仍以 `.agents/skills/imagemon-promptdex/references/template-contract.md` 为运行时事实来源。
- 手机端不执行 Skill 自带 CLI，也不依赖 Promptdex 任务辅助脚本的 Node 文件系统安全模型。
- 业务模型调用继续遵守全局模型调用锁；但调用进行中只保护自身写入目标，不冻结无关本地写操作。

## 移动端实现顺序

已完成：

1. 引入 `apps/mobile` 骨架，保持根包现有验证不受影响。
2. 建立移动端本地存储基线：SQLite schema、应用设置、安全存储接口和迁移入口。
3. 实现首次设置与模型配置测试，闭合凭据保存、就绪状态和默认配置。

下一阶段：

1. 按 [移动端生成任务资产闭环计划](plans/mobile-generation-task-history-image-result-slice.md) 实现手动输入完整提示词的生成任务。
2. 建立任务历史、任务快照和图片结果的最小持久化模型。
3. 实现创建、历史和图片三个入口的只读查看闭环。
4. 在核心资产闭环稳定后，再实现 Promptdex 图鉴、编辑任务、ZIP 备份恢复、模板提炼和业务调用提示。

## 当前健康度要求

移动端落地前应保持现有 Skill/CLI 测试绿色。若 Promptdex 模板目录出现无效文件、重复模板名或副本污染，应修复生产资产，而不是调整测试。
