# 移动端多图原子保存与 schema v8→v9 迁移测试补全方案（2026-07-15）

- **来源**：`improving-ui` 分支测试覆盖审查。
- **基线**：`improving-ui` @ `0ce84a0`；多图实现来自 `80a5820`、`694d712`，schema v9 实现来自 `3c4fc71`。
- **状态**：待执行。
- **范围**：补齐模型多图响应、生成与编辑服务、仓储事务，以及 schema v8→v9 迁移的自动化测试。
- **测试纪律**：只新增表达既有契约的测试及必要测试基础设施；不删除、跳过或放宽既有测试。若新增测试暴露生产缺陷，只修复生产代码。

---

## 一、契约基线

本计划以以下既有决策和当前实现为准：

- [ADR 0180](../adr/0180-one-task-history-references-multiple-image-results.md)：同一次任务的多张图片结果独立存在，并弱引用同一条任务历史。
- [ADR 0181](../adr/0181-image-count-maps-to-single-atomic-call.md)：请求数量 `N` 映射为一次模型调用；模型返回 `M≥1` 张时保存实际结果，返回 0 张时任务失败，不存在部分成功状态。
- [ADR 0192](../adr/0192-image-count-semantics-apply-to-both-generation-and-edit-tasks.md)：生成与编辑任务使用相同的多图数量语义。
- 当前分支的 `694d712`：实际返回数量 `M` 可以少于、等于或多于请求数量 `N`，服务不得截断超额结果。
- [ADR 0007](../adr/0007-transactional-local-data-migrations.md)：本地迁移在事务中执行，失败必须回滚并保留旧数据。

这里的“多图原子保存”有两个边界：

1. 图片结果行、任务完成状态和成功提示在一个数据库事务内提交；
2. 图片文件先顺序落盘，数据库提交失败时以补偿删除清理已经成功落盘的文件。

第二点是正常进程内的尽力补偿，不等同于跨文件系统与 SQLite 的崩溃一致事务。进程在文件落盘与数据库提交之间被杀死，或补偿删除本身失败，仍可能留下孤儿文件；本轮测试不把现有实现扩大解释为 crash-safe。

## 二、目标与非目标

### 2.1 目标

1. 锁定 provider 多图响应的完整解析、顺序和 `M≠N` 语义。
2. 锁定多张文件全部保存后才提交数据库，以及任一步失败后的补偿清理。
3. 直接证明 `completeWithImageResults` 对全部结果行和任务状态的事务原子性。
4. 证明编辑任务复用与生成任务一致的多图保存契约。
5. 从冻结的发布版 v8 schema 出发，在真实内存 SQLite 中证明 v9 迁移的数据、约束、索引、外键、幂等和回滚语义。

### 2.2 非目标

- 不改变图片任务、数据库 schema 或迁移的生产行为。
- 不补 UI 展示、图片删除、相册导出等多图下游测试。
- 不在本轮设计进程崩溃后的孤儿文件扫描与恢复机制。
- 不为 v1→v8 的每一段旧迁移新增真实 SQLite 集成测试；只保留现有路由测试，并聚焦本次 v8→v9 风险。
- 不使用 `node:sqlite`：当前 GitHub Actions 固定 Node 20，无法把它作为稳定的 CI 前提。

## 三、现有覆盖与缺口

| 层级 | 现有覆盖 | 关键缺口 |
| --- | --- | --- |
| `model-client.test.ts` | 单张 base64/URL、请求与错误映射 | 没有 `data[]` 多图、顺序和超额结果测试 |
| `generation.test.ts` | 单图成功、模型失败、快照与凭据 | 没有多图成功、0 图、文件中途失败和 DB 失败补偿 |
| `edit.test.ts` | 单图编辑、附件与失败收口 | 没有 `n>1` 编辑结果 |
| `repository.test.ts` | 单图插入、历史状态与删除 | 没有 `completeWithImageResults` 的成功、空输入和回滚测试 |
| `storage/index.test.ts` | 通过 Fake DB 记录迁移 SQL | 没有直接从 v8 出发的用例；无法证明真实数据复制、CHECK/FK 或 DDL 回滚；多处标题仍写“v8” |

## 四、多图原子保存测试矩阵

### 4.1 模型客户端：保留 provider 的实际返回

文件：`apps/mobile/src/image-tasks/model-client.test.ts`

新增场景：请求 `n=2`，provider 返回 3 个 `b64_json` 项。

关键断言：

- 请求 body 仍携带 `n: 2`；
- 返回值是长度为 3 的数组，不按请求数量截断；
- 三项顺序与 provider `data[]` 一致，并全部带有由请求尺寸解析出的 `width`、`height`；
- 既有单图测试继续锁定“单图返回对象”的兼容形状。

### 4.2 生成服务：数量语义与成功结果

文件：`apps/mobile/src/image-tasks/generation.test.ts`

先将当前固定的图片结果 ID 测试夹具改为每个用例重置的顺序 ID 队列，避免多图写入相同路径并覆盖内存 Map。测试只通过公开 `createImageGenerationTaskService` 进入，不导出私有的 `saveGeneratedImageResults`。

使用表驱动覆盖：

| 请求 N | 返回 M | 预期 |
| ---: | ---: | --- |
| 3 | 2 | 成功保存实际 2 张，快照仍记录 `n=3` |
| 2 | 2 | 成功保存 2 张 |
| 2 | 3 | 成功保存实际 3 张，不截断超额结果 |

至少一组使用 `format: "webp"`、`quality: "high"`，并混合 base64 与 bytes，验证：

- 模型客户端收到完整图片规格；
- `imageResults` 中每张图的 ID、文件路径和内容唯一，顺序与模型返回一致；
- 所有结果都关联同一条任务历史，仓储最终行数等于实际 `M`；
- `imageResult` 与 `imageResults[0]` 是同一首图对象，保留旧调用方兼容入口；
- 历史状态仅从 `running` 收口为 `completed`，不存在部分成功状态。

另增“模型返回空数组”场景：断言错误为 `invalid_response`、零文件、零图片结果，任务历史收口为 `failed`。

### 4.3 生成服务：文件与数据库失败补偿

文件：`apps/mobile/src/image-tasks/generation.test.ts`

场景 A——第二张文件保存失败：

1. 用包装后的内存文件存储让第一张正常保存，第二张在返回路径前抛错；
2. 断言第三张不再尝试保存；
3. 断言第一张已由服务补偿删除，文件 Map 和图片结果表均为空；
4. 断言任务历史收口为 `failed`。

当前正在写入但尚未返回路径的第二张文件由单文件存储自身负责清理，服务层只负责删除已经获得成功返回路径的文件，测试不得混淆这两个责任。

场景 B——全部文件保存后仓储完成失败：

1. 模型返回两张图片，文件均成功落盘；
2. 包装仓储，仅令 `completeWithImageResults` 抛错，保留 `markFailed` 正常工作；
3. 断言两张文件都被尝试补偿删除，且不依赖 `Promise.allSettled` 的完成顺序；
4. 断言没有图片结果行，历史最终为 `failed`，而不是 `history: null`。

### 4.4 仓储：事务原子性

文件：`apps/mobile/src/image-tasks/repository.test.ts`

新增三组直接测试：

1. **多图成功**：对 running 历史一次传入两张结果，断言返回 completed 历史、两行顺序不变、字段完整、`taskHistoryId` 相同，按历史查询可读到两行。
2. **空输入拒绝**：传入空数组时返回 `invalid_state`，不进入事务，历史保持 running 且无结果。
3. **事务回滚**：包装 `createMemoryImageTaskStore()`，分别在“第二张结果插入”和“全部结果插入后的历史更新”处抛错；断言原错误向上传递，历史仍为 running，全局及按历史查询的结果均为空。

第二个失败点是核心门槛：它证明即使全部结果行已经写入，历史状态更新失败仍会回滚整批结果，而不是只证明第一张之后的循环被中断。

### 4.5 编辑服务：同一契约复用

文件：`apps/mobile/src/image-tasks/edit.test.ts`

新增 `n=2` 的编辑成功场景，并扩充 ID 队列：

- `edit` 收到 `n`、`format`、`quality`；
- 两张图片都落盘并弱引用同一条 edit 历史；
- `imageResult` 仍指向 `imageResults[0]`；
- 输入附件快照和内部附件文件不受多图结果影响。

文件/数据库故障矩阵不在编辑测试中重复，因为生成与编辑共用同一个保存函数；生成服务测试已经从公开入口覆盖该边界。

## 五、schema v8→v9 迁移测试矩阵

### 5.1 两层测试策略

仅检查 SQL 字符串不能证明迁移真的保留数据和约束，因此采用两层测试：

1. `apps/mobile/src/storage/index.test.ts`：保留轻量 Fake DB，验证 `version=8` 的迁移路由、SQL 顺序和版本记录；
2. 新增 `apps/mobile/src/storage/index.sqlite.test.ts`：使用真实内存 SQLite 执行完整迁移，验证数据与事务语义。

真实 SQLite 测试使用仅面向测试的 [`sql.js`](https://github.com/sql-js/sql.js) WASM 引擎。它可在 Node 中创建内存 SQLite，避免原生扩展编译，并且不会进入移动端生产包。实施时执行：

```bash
npm install --save-dev --workspace @imagemon/mobile sql.js @types/sql.js
```

由 `package-lock.json` 固定实际安装版本；适配器显式定位 `sql-wasm.wasm`，避免依赖运行目录。

### 5.2 Fake DB 路由与 SQL 合同

文件：`apps/mobile/src/storage/index.test.ts`

新增 `migrationRows = [{ version: 8 }]` 场景，断言：

- 直接执行 `CREATE TABLE image_results_v9`；
- 按 `id`、`task_history_id`、`file_path`、`format`、`width`、`height`、`created_at` 七列执行 `INSERT ... SELECT`；
- SQL 顺序为建临时表、复制、删除旧表、改名、重建两个索引；
- 新 CHECK 只允许 `png`、`jpeg`、`webp`；
- 写入且只写入 schema version 9，不执行 v7 以前的 `ALTER TABLE` 或重建迁移；
- 初始化最终仍执行幂等的 v9 schema 补齐与默认设置写入。

同时把现有测试标题中表示“当前 schema v8”的过时文字改为 v9，并在全新库用例中增加格式约束的明确断言；不删除或放宽已有断言。

### 5.3 冻结 v8 发布版 fixture

新增文件：`apps/mobile/src/storage/schema-v8.test-fixture.ts`

fixture 从 `v0.11.0` 标签中的 `apps/mobile/src/storage/index.ts` 冻结复制，不从当前 `createSchemaV9` 反向生成。文件顶部注明：这是历史发布快照，未来 schema 升级不得同步改写。

fixture 至少包含：

- 完整 v8 表、索引和外键；
- `schema_migrations` 中的 version 8；
- 一条已完成 generate 历史；
- 一条关联该历史、宽高有值的 PNG 结果；
- 一条 `task_history_id`、`width`、`height` 均为 NULL 的 PNG 结果。

迁移前先尝试写入 JPEG 并断言 CHECK 拒绝，以证明测试起点确实是仅允许 PNG 的 v8，而不是误用了当前 schema。

### 5.4 sql.js 的 `ApplicationDatabase` 测试适配器

新增文件：`apps/mobile/src/storage/sql-js.test-support.ts`

适配器只实现迁移测试所需的 `ApplicationDatabase` 接口：

- `execAsync`、`runAsync`、`getFirstAsync`、`getAllAsync` 包装 sql.js statement，并始终释放 statement；
- boolean 参数归一化为 SQLite 的 `0/1`；
- `withTransactionAsync` 显式执行 `BEGIN`、`COMMIT`，异常时 `ROLLBACK` 后原样抛出；
- 测试结束关闭数据库；
- WASM 文件通过模块解析得到绝对路径，不访问网络。

该适配器是测试基础设施，不承载迁移规则，也不解析或模拟生产 SQL，避免“测试替身复制了一套迁移逻辑”导致假阳性。

### 5.5 真实 SQLite 成功、幂等与约束测试

文件：`apps/mobile/src/storage/index.sqlite.test.ts`

主用例名称：`从发布版 v8 迁移到 v9 时保留旧结果并开放 JPEG/WebP`。

通过公开 `initializeApplicationStorage({ openDatabase, now })` 执行，不导出私有迁移函数。断言：

1. 初始化返回 `ready`，迁移记录包含 8、9，version 9 的时间固定且不重复；
2. 两条旧结果的七个字段逐列相等，行数不变，NULL 值不被默认值替换；
3. `sqlite_master` 中仅保留最终 `image_results`，不存在 `image_results_v9`；
4. 新表允许插入 JPEG、WebP，继续拒绝 GIF；约束错误只匹配 `CHECK constraint failed`，不依赖完整错误文本；
5. `image_results_created_at_idx` 和 `image_results_task_history_id_idx` 都存在且索引列正确；
6. 外键仍为 `ON DELETE SET NULL`，删除被引用历史后结果的 `task_history_id` 变为 NULL；
7. 在同一数据库上再次初始化，不重复迁移、不新增 version 9 记录、不改变已有数据。

### 5.6 真实 SQLite 失败回滚与重试

同文件新增用例：`v8→v9 写版本失败时原子回滚并可重试`。

在 v8 fixture 上创建仅测试使用的 `BEFORE INSERT` trigger，当 `NEW.version = 9` 时执行 `RAISE(ABORT)`。该故障发生在表重建和数据复制之后、事务提交之前，能够验证完整回滚边界。

首次初始化应返回 `failed`，并断言：

- 迁移记录仍只有 version 8；
- 两条旧结果逐列不变；
- 不存在 `image_results_v9` 临时表；
- `image_results` 的 CHECK 仍只允许 PNG，JPEG 仍被拒绝；
- v8 的两个旧索引仍存在。

删除故障 trigger 后在同一数据库重试，必须成功迁移到 v9。该用例同时证明 DDL、数据复制和版本记录属于同一事务，并且失败后可恢复执行。

## 六、预计文件变更

| 文件 | 变更 |
| --- | --- |
| `apps/mobile/package.json`、`package-lock.json` | 增加 sql.js 及类型的测试依赖 |
| `apps/mobile/src/image-tasks/model-client.test.ts` | 多图响应与超额结果 |
| `apps/mobile/src/image-tasks/generation.test.ts` | M/N 矩阵、0 图、文件和 DB 失败补偿 |
| `apps/mobile/src/image-tasks/repository.test.ts` | 批量完成、空输入与事务回滚 |
| `apps/mobile/src/image-tasks/edit.test.ts` | 编辑任务多图成功 |
| `apps/mobile/src/storage/index.test.ts` | v8 路由/SQL 合同与标题勘误 |
| `apps/mobile/src/storage/index.sqlite.test.ts` | 真实 SQLite 迁移语义 |
| `apps/mobile/src/storage/schema-v8.test-fixture.ts` | 冻结的 v8 schema 和旧数据 |
| `apps/mobile/src/storage/sql-js.test-support.ts` | 测试专用数据库适配器 |

正常情况下不修改生产代码；若测试暴露缺陷，生产修复必须独立说明并与测试契约保持一致。

## 七、实施顺序与提交切分

### 阶段 1：多图各层合同

1. 补模型客户端多图解析测试；
2. 补仓储批量成功、空输入和两类回滚测试；
3. 调整生成测试 ID 夹具，补数量矩阵、空响应和补偿清理；
4. 补编辑任务多图成功路径；
5. 运行图片任务定向测试。

建议提交：`test: 覆盖多图原子保存`

### 阶段 2：迁移真实语义

1. 加入 sql.js 测试依赖和适配器；
2. 从 `v0.11.0` 冻结 v8 fixture；
3. 补 Fake DB 的 v8 路由/SQL 合同；
4. 补真实 SQLite 成功、幂等、约束、外键和失败回滚；
5. 修正过时测试标题并运行存储定向测试。

建议提交：`test: 覆盖 v8 到 v9 迁移`

若任何测试暴露生产缺陷，先保留失败测试，再以独立 `fix:` 提交修复生产代码，不改测试绕过。

## 八、验证命令

先运行定向测试：

```bash
npm run test --workspace @imagemon/mobile -- \
  src/image-tasks/model-client.test.ts \
  src/image-tasks/repository.test.ts \
  src/image-tasks/generation.test.ts \
  src/image-tasks/edit.test.ts \
  src/storage/index.test.ts \
  src/storage/index.sqlite.test.ts
```

再运行完整门禁：

```bash
npm run mobile:verify
npm run verify
git diff --check
git status --short
```

`mobile:verify` 是本轮主要门禁；`verify` 用于确认根包、共享 core、Skill 与全仓测试没有回归。

## 九、风险与控制

| 风险 | 控制方式 |
| --- | --- |
| 固定图片 ID 导致多图覆盖 | 每个用例重置顺序 ID 队列，并断言路径唯一 |
| `now()` 带计数副作用导致脆弱时间断言 | 只断言关键字段与相对归属，不锁定无关调用次数生成的时间序列 |
| `listImageResults()` 默认倒序掩盖 provider 顺序 | 用 service 返回值或 `listImageResultsForTaskHistory()` 验证顺序 |
| 补偿删除并发完成顺序不稳定 | 用集合/`arrayContaining` 断言所有路径均被尝试，不断言删除完成顺序 |
| 仓储故障替身同时破坏 `markFailed` | 仅让 `completeWithImageResults` 失败，确保失败历史能正常收口 |
| fixture 随当前 schema 漂移 | 从 `v0.11.0` 冻结并标记不可跟随更新 |
| WASM 路径在 Vitest/CI 不一致 | 通过模块解析获得绝对路径，不依赖 cwd 或网络 |
| sql.js 与设备 SQLite 构建并非完全相同 | 只验证标准 DDL、CHECK、FK、索引和事务语义；设备专项行为不在该适配器中模拟 |

## 十、完成定义

- [ ] provider 返回多图时全部解析并保持顺序，`M>N` 不截断。
- [ ] 生成任务覆盖 `M<N`、`M=N`、`M>N` 和 `M=0`。
- [ ] 第二张文件保存失败时不留已保存文件或图片结果。
- [ ] 数据库完成失败时清理全部已保存文件，历史收口为失败。
- [ ] 仓储在第二张插入失败、历史更新失败时均回滚整批图片结果。
- [ ] 编辑任务 `n>1` 与生成任务遵循相同保存契约。
- [ ] v8 Fake DB 路由测试精确覆盖 v9 重建 SQL 和版本记录。
- [ ] 冻结 v8 fixture 在真实 SQLite 中证明旧行与 NULL 值保留。
- [ ] 真实 SQLite 证明 JPEG/WebP 放行、GIF 拒绝、索引和 `ON DELETE SET NULL` 保留。
- [ ] version 9 写入失败时 DDL、数据、索引和版本记录完整回滚，移除故障后可重试。
- [ ] 现有“当前 schema v8”测试标题已勘误为 v9，既有断言未被删除或放宽。
- [ ] 定向测试、`npm run mobile:verify`、`npm run verify` 和 `git diff --check` 全部通过。
- [ ] 工作区没有测试生成的未跟踪数据库或 WASM 产物。
