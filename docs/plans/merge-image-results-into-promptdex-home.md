# 图鉴首页合并执行方案

本文档把“图片”Tab 并入“图鉴”Tab 的共识整理为可执行计划。执行时按下列子任务顺序推进；每完成一个子任务并通过对应验证后，必须立即创建一次 git commit，避免不同任务的改动混在同一个提交里。

## 目标

- 底部主入口改为“图鉴 / 历史 / 设置”，移除独立“图片”Tab。
- 图鉴首页成为合并首页，依次展示“已生成图鉴条目”“未生成图鉴条目”和“其他图片”。
- 已生成图鉴条目使用最近创建且仍存在的成功图片结果作为预览，整体点击进入图鉴条目详情，预览图上的图片按钮进入图片详情。
- 未生成图鉴条目使用紧凑列表，不伪装成图片流。
- 其他图片兜底承接无法归入当前可用图鉴条目的图片结果，确保移除图片 Tab 后图片资产仍可发现。

## 非目标

- 本轮不做首页搜索或筛选。
- 本轮不做图片内容识别、全文搜索、缩略图持久化策略调整。
- 本轮不新增数据库表或 schema migration；首个闭环使用现有合并图鉴、任务历史和图片结果数据做应用层聚合。
- 本轮不让进行中、失败或状态未知任务在首页显示状态提示，也不让它们改变首页分区。

## 分区规则

### 已生成图鉴条目

当前合并图鉴中的条目，如果至少有一张仍存在的图片结果满足以下条件，则归入已生成图鉴条目：

- 图片结果关联任务历史。
- 任务历史状态为 `completed`。
- 任务快照 `source` 为 `promptdex`。
- 快照中的图鉴条目 `name` 和 `sourceType` 与当前合并图鉴条目一致。

同一条目有多张匹配图片时，使用 `createdAt` 最新的一张作为首页预览。删除预览图后，下次加载自动回退到下一张；如果没有剩余匹配图片，条目进入未生成图鉴条目。

### 未生成图鉴条目

当前合并图鉴中不满足已生成条件的条目。它可能从未发起过图片任务，也可能只有失败、进行中、状态未知任务，或历史仍在但图片结果已删除。该分区延续现有图鉴列表的信息表达：名称、描述、来源、任务类型和执行状态。

### 其他图片

无法归入当前已生成图鉴条目的图片结果，例如：

- 没有关联任务历史。
- 关联任务历史已删除。
- 任务快照不是 `promptdex` 来源。
- 快照中的图鉴条目 `name + sourceType` 不再匹配当前合并图鉴。

其他图片不是图鉴条目分类。点击其他图片进入 `/images/[id]` 图片详情页。

## 排序规则

- 已生成图鉴条目：按代表图片 `createdAt` 倒序。
- 未生成图鉴条目：沿用当前合并图鉴列表顺序。
- 其他图片：按图片结果 `createdAt` 倒序。

## 子任务与提交边界

### Commit 01：记录设计基线

范围：

- 更新 `CONTEXT.md`，记录“已生成图鉴条目”“未生成图鉴条目”“其他图片”。
- 新增 ADR，记录图片结果并入图鉴首页的导航与信息架构决策。
- 新增本文档，作为后续执行计划。

完成定义：

- 术语定义不包含实现细节。
- ADR 能解释为什么独立“图片”Tab 被移除。
- 本计划包含所有后续子任务的 commit 边界。

验证：

```bash
git diff --check
```

提交：

```bash
git add CONTEXT.md docs/adr/0209-merge-image-results-into-promptdex-home.md docs/plans/merge-image-results-into-promptdex-home.md
git commit -m "docs: 记录图鉴首页合并方案"
```

### Commit 02：增加图鉴首页聚合模型

范围：

- 新增 `apps/mobile/src/promptdex/home.ts`。
- 暴露一个纯应用层聚合函数或服务，例如 `createPromptdexHomeService`。
- 在 `apps/mobile/src/promptdex/index.ts` 导出必要类型。
- 新增 `apps/mobile/src/promptdex/home.test.ts`。

实现要求：

- 聚合输入来自 `MergedPromptdexCatalogService` 和 `ImageTaskRepository`。
- 不解析或访问真实图片文件 URI；文件 URI 解析留给 UI 层。
- 用 `sourceType:name` 作为当前图鉴条目匹配 key。
- 对每个图片结果读取关联任务历史；只有完成状态的 promptdex 快照能让条目归入已生成。
- 同一图鉴条目只保留最新图片作为首页代表图。
- 被同一图鉴条目匹配但不是代表图的图片，不进入“其他图片”；它们后续在图鉴详情页展示。
- 进行中、失败、状态未知任务不产生首页状态。
- 图片结果缺失任务历史、manual 快照、当前图鉴不存在或来源类型不匹配时进入“其他图片”。

测试覆盖：

- 完成状态 promptdex 图片把条目归入已生成。
- 最新图片成为代表图。
- 删除或缺失图片结果后条目回到未生成。
- 同名但来源类型不同不匹配。
- 失败、进行中、状态未知任务不让条目进入已生成。
- manual 或缺失历史的图片进入其他图片。
- 未生成条目保留当前合并图鉴顺序。

验证：

```bash
npm run test --workspace @imagemon/mobile -- src/promptdex/home.test.ts
npm run mobile:typecheck
```

提交：

```bash
git add apps/mobile/src/promptdex/home.ts apps/mobile/src/promptdex/home.test.ts apps/mobile/src/promptdex/index.ts
git commit -m "feat: 增加图鉴首页聚合模型"
```

### Commit 03：实现合并图鉴首页和导航

范围：

- 修改 `apps/mobile/app/(tabs)/_layout.tsx`，底部 Tab 只显示“图鉴 / 历史 / 设置”。
- 将 `apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx` 改为合并首页。
- 旧的 `apps/mobile/app/(tabs)/images.tsx` 不再作为底部入口；可以删除，或保留为隐藏路由，但不得出现在 Tab 中。
- 保留 `/images/[id]` 图片详情路由。

实现要求：

- 页面加载时读取图鉴首页聚合结果。
- 首页顶部仍是“图鉴”。
- 保留模板提炼入口。
- 已生成分区使用图文信息流卡片：代表图、条目名称、来源、任务类型、描述。
- 已生成卡片整体进入 `/promptdex/[name]`。
- 已生成卡片代表图右上角放图片入口按钮，进入 `/images/[id]`。
- 未生成分区使用紧凑列表，不使用图片流卡片。
- 其他图片分区使用图片结果卡片或紧凑图片行，点击进入 `/images/[id]`。
- 图片文件 URI 解析失败时显示占位，不改变分区。
- 首页不显示运行中、失败、状态未知任务提示。
- 首页不提供搜索或筛选控件。

完成定义：

- 空状态分别能表达“没有图鉴条目”和“暂无图片结果”。
- 加载失败有错误提示。
- 代表图按钮点击不会触发卡片整体跳转。
- 文本在小屏下不溢出。
- 现有历史和图片详情路径可继续打开。

验证：

```bash
npm run mobile:typecheck
npm run mobile:test
```

手工验收：

- 启动 `npm run mobile:web` 或移动端 Expo。
- 验证底部 Tab 只有“图鉴 / 历史 / 设置”。
- 验证有成功图片的条目显示在首页上方。
- 验证未生成条目显示为列表。
- 验证其他图片能进入图片详情。

提交：

```bash
git add apps/mobile/app/'(tabs)'/_layout.tsx apps/mobile/app/'(tabs)'/images.tsx apps/mobile/src/promptdex/PromptdexCatalogScreen.tsx
git commit -m "feat: 合并图鉴和图片首页"
```

如果删除了 `apps/mobile/app/(tabs)/images.tsx`，提交命令中的路径按实际删除结果处理。

### Commit 04：在图鉴详情展示代表图和历史图片

范围：

- 修改 `apps/mobile/src/promptdex/PromptdexEntryDetailScreen.tsx`。
- 复用 Commit 02 的聚合模型，或新增条目级图片读取 helper。
- 必要时补充 `apps/mobile/src/promptdex/home.test.ts` 或新增专门测试。

实现要求：

- 图鉴条目详情顶部展示该条目的代表图；没有代表图时不显示图片预览区。
- 代表图上的图片入口进入 `/images/[id]`。
- 详情页提供该条目的最近图片列表或图片入口区，让非代表图图片结果仍可发现。
- 最近图片只包含当前条目 `name + sourceType` 匹配、完成状态任务历史关联的图片结果。
- 详情页仍以填写任务和再次生成作为主操作。
- 未生成条目详情不显示伪预览。

完成定义：

- 首页卡片进入详情后，详情页展示同一代表图。
- 从详情页可以进入代表图图片详情。
- 多张成功图片时，详情页能发现非代表图图片。
- 删除代表图后重新进入详情会回退到下一张或隐藏预览。

验证：

```bash
npm run mobile:typecheck
npm run mobile:test
```

手工验收：

- 生成同一图鉴条目的两张图片，确认首页只显示最新一张。
- 进入详情页，确认两张图片都可发现。
- 删除最新图片后返回首页和详情页，确认代表图回退。

提交：

```bash
git add apps/mobile/src/promptdex/PromptdexEntryDetailScreen.tsx apps/mobile/src/promptdex/home.ts apps/mobile/src/promptdex/home.test.ts
git commit -m "feat: 在图鉴详情展示生成图片"
```

### Commit 05：完善边界测试和回归验证

范围：

- 根据前四个提交的实现结果补齐遗漏测试。
- 只修生产代码或新增必要测试，不通过放宽、删除、跳过既有测试来让测试通过。
- 清理未使用的 imports、样式和旧图片 Tab 残留。

重点回归：

- 个人条目覆盖同名内置条目时，历史内置图片不能误归入当前个人条目。
- 任务历史删除后，图片结果进入其他图片。
- 图片结果删除后，条目从已生成回到未生成。
- 图片文件 URI 解析失败时，首页仍可进入对应详情。
- 首页不显示任何运行中、失败、状态未知任务提示。
- `/images/[id]` 图片详情仍可从首页和图鉴详情进入。

验证：

```bash
npm run mobile:verify
```

如改动影响 core 或 skill 产物，再运行：

```bash
npm run verify
```

提交：

```bash
git add apps/mobile
git commit -m "test: 覆盖图鉴首页合并边界"
```

## 最终验收清单

- [ ] `git log --oneline` 能看到上述每个子任务对应的独立 commit。
- [ ] `git status --short` 干净，或只剩明确不属于本任务的用户改动。
- [ ] `npm run mobile:verify` 通过。
- [ ] 图鉴首页第一屏优先展示真实成功图片预览。
- [ ] 未生成图鉴条目不是图片流。
- [ ] 其他图片可进入图片详情。
- [ ] 独立“图片”Tab 不再出现。
- [ ] 首页没有搜索/筛选控件。
- [ ] 首页没有运行中、失败、状态未知任务提示。
