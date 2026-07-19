# 表格备份／表格恢复实现方案（2026-07-14）

## 来源与依据

- **共识**：2026-07-14 grilling 会话逐题达成，词汇表见 `CONTEXT.md`（表格备份、表格恢复、备份数据表、飞书连接配置，及修订后的 Promptdex Markdown、恢复预检、恢复进行中、导出进行中）。
- **决策记录**：[ADR 0212](../adr/0212-promptdex-markdown-is-exchange-format-only.md)（结构化字段为唯一载荷）、[ADR 0213](../adr/0213-table-backup-uses-personal-base-token.md)（个人授权码通道 + wiki 坑与双轨录入）、[ADR 0216](../adr/0216-table-backup-targets-use-binding-markers.md)（备份目标身份、binding marker 与旧表显式认领）。
- **通道验证**：2026-07-15（北京时间）spike 全绿——个人授权码对建表、建字段、批量增删改查记录、删表全部放行。
- **分支**：`feishu-backup`。

## 范围

| 批次 | 内容 |
| --- | --- |
| 批次一 | 飞书连接配置 + 表格备份（导出方向），含迁移操作锁首建 |
| 批次二 | 表格恢复（恢复预检 + 合并覆盖） |

**非目标**（本方案明确不做）：自动/定时同步；内置图鉴条目；条目展示信息新列（分类、搜索标签、封面）——SQLite 落地后再给备份数据表加字段；附件/图片上传；ZIP 备份实现（另行立项，但本方案首建的迁移操作锁将来直接复用）；断点续传；多设备并发备份协调（last-write-wins，靠镜像幂等收敛）。

## 关键现状事实

- 个人图鉴条目已是结构化存储：`personal_promptdex_entries`（name 主键 / description / version_json / inputs_json / body / created_at / updated_at），仓储只有插入和删除（`apps/mobile/src/promptdex/personal-entry-repository.ts`）。
- ZIP 备份/恢复**尚未实现**，「导出进行中／恢复进行中」只存在于词汇表——迁移互斥状态机由本方案首建。
- 当前 schema 版本为 8（`apps/mobile/src/storage/index.ts:5`），本方案引入 v9 迁移。
- 凭据安全存储已有适配器模式可仿（`apps/mobile/src/storage/credentials.ts`：接口 + expo-secure-store 实现 + memory 测试实现）。
- 全局模型调用锁模式可仿（`apps/mobile/src/model-calls/model-call-lock.ts`：begin 返回 `blocked` 状态 + React context）。
- 设置页入口位于 `apps/mobile/app/(tabs)/(settings)/settings.tsx`。
- 校验/序列化零件齐备：`validatePromptdexTemplate`（`packages/core/src/promptdex.ts:73`）。

## 一、外部契约

### 1.1 base-api 端点（spike 已验证）

统一前缀 `https://base-api.feishu.cn/open-apis/bitable/v1/apps/:app_token`，鉴权头 `Authorization: Bearer <个人授权码>`：

| 用途 | 方法与路径 |
| --- | --- |
| 探测连接 / 列数据表 | `GET /tables?page_size=…` |
| 创建备份数据表 | `POST /tables` |
| 列字段（备份前校验） | `GET /tables/:table_id/fields` |
| 补建字段 | `POST /tables/:table_id/fields` |
| 拉全量记录（分页） | `GET /tables/:table_id/records` |
| 批量增 / 改 / 删记录 | `POST /tables/:table_id/records/batch_create` / `batch_update` / `batch_delete` |

批量与分页上限按官方文档在实现时核实（按 500/批预设，串行执行，不并发）。**不实现删表**——镜像语义只需记录级增删改，杜绝误伤。

### 1.2 备份数据表字段契约

表名 `Imagemon 图鉴备份` 仅用于展示，不是身份。正常路径以保存的 `table_id` 为强身份；失联恢复使用应用生成的 `backup_binding_id`，并随建表原子加入文本管理字段 `__imagemon_backup_target_v1__<backup_binding_id>`。业务字段保真优先：

| 字段名 | 来源列 | 说明 |
| --- | --- | --- |
| 名称 | `name` | 主字段，镜像与恢复的匹配键 |
| 用途说明 | `description` | |
| 版本 | `version_json` | JSON 原文或空 |
| 输入声明JSON | `inputs_json` | 单列 JSON 文本（共识问题 13） |
| 模板正文 | `body` | |
| 条目创建时间 | `created_at` | ISO 字符串原文，恢复时保真回写 |
| 条目更新时间 | `updated_at` | 同上 |

`taskType` 不入表（恢复后由输入声明重新推断）；`sourceType` 恒为 personal，不入表。使用者在表格里**自行加列**不受影响；改动/删除以上契约字段会被备份前校验与恢复预检拦截。

### 1.3 字段校验规则

候选身份确认前仅用 `GET tables` 与 `GET fields` 做只读分析，不补字段、不上传附件、不写记录。只有已保存 `table_id`、唯一匹配本地 binding 的 managed 表或使用者显式认领的表才进入契约维护：

- 契约字段缺失 → 尝试 `POST fields` 补建；补建失败 → 操作失败并报错。
- 契约字段类型不符（被使用者改类型）→ 操作失败，错误说明指出具体字段，引导在飞书侧改回或换表格重建。
- 多余字段 → 忽略（使用者自有列）。

## 二、批次一：飞书连接配置 + 表格备份

### 2.1 存储（schema v9 迁移）

新增单行表（模式仿 `template_refinement_drafts`）：

```sql
CREATE TABLE table_backup_state (
  id TEXT PRIMARY KEY CHECK (id = 'feishu'),
  app_token TEXT NOT NULL,
  backup_table_id TEXT,            -- 备份数据表 id，首次备份建表后回填
  last_backup_succeeded_at TEXT,   -- 上次成功备份时间
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- `CURRENT_SCHEMA_VERSION` 8 → 9，迁移函数命名与注册跟随 `apps/mobile/src/storage/index.ts` 既有链。
- **个人授权码不入库**：新增凭据适配器（`apps/mobile/src/storage/credentials.ts` 追加），固定 key `imagemon.feishu-personal-base-token`，接口/memory 实现/secure-store 实现三件套与模型配置凭据一致。
- 本表整体属于本设备状态：将来实现 ZIP 备份时**排除**此表（对应词条「飞书连接配置」）。

### 2.2 新模块 `apps/mobile/src/table-backup/`

| 文件 | 职责 |
| --- | --- |
| `connection-input.ts` | 录入解析：`/base/<app_token>` 链接 → 提取 token；裸 `app_token` → 原样接受；`/wiki/` 链接 → 返回 `wiki_link` 判定，UI 展示开发工具插件引导（ADR 0213 双轨录入） |
| `base-api-client.ts` | fetch 封装 1.1 节端点；仅注入授权头；30 秒每请求超时（对齐诊断类调用惯例）；响应 `code !== 0` 归一为结构化错误（错误码 + msg，不含请求头/凭据）；支持 `AbortSignal` 取消 |
| `connection-repository.ts` | `table_backup_state` 读写 + 凭据适配器组合；保存/清除连接配置；清除时同步删凭据 |
| `field-contract.ts` | 1.2 字段契约常量 + 1.3 校验/补建逻辑 + 记录⇄条目双向映射（纯函数，可单测） |
| `backup-service.ts` | 镜像引擎（2.3） |
| `backup-session.ts` | 备份进行中状态机（idle / running / cancelling / failed / succeeded），失败说明为会话级展示，不持久化（对齐 ADR 0201/0105 精神） |
| `migration-lock.ts` | **通用迁移操作锁**（2.4），刻意不叫 table-backup 专名，将来 ZIP 导出/恢复复用 |

UI：`apps/mobile/app/table-backup/index.tsx`（设置页新增入口进入）。

### 2.3 镜像引擎流程

1. 前置：连接配置完整（app_token + 凭据在）；获取迁移操作锁，失败即 blocked 提示。
2. 解析备份目标：已保存 `backup_table_id` 时直接校验该强身份；只有明确的 `1254041 TableIdNotFound` 才进入发现流程。ID 为空、存在待建表状态或建表结果未知时，先分页读取数据表并按 binding marker 对账；兼容旧表或其他 binding 只返回选择状态，不自动认领。完整发现确认无目标后，先持久化 binding 与待建表名，再一次性创建业务字段和 marker 并条件回填 `backup_table_id`。`1254013`、超时、网络错误、5xx、无效响应或缺少 `table_id` 时只读对账，本次不盲目重发建表请求。
3. 字段校验（1.3）。
4. 读本机全部个人图鉴条目（`PersonalPromptdexEntryRepository.list()`，在锁保护下即为一致快照）。
5. 分页拉全量记录，按「名称」建索引；表格中同名多条记录 → 保留第一条参与 diff，其余按镜像语义删除。
6. 计算 diff：本机有表格无 → create；两边都有且任一契约字段值不同 → update（值相同跳过，减少写量）；表格有本机无 → delete。
7. 串行分批执行 batch_create / batch_update / batch_delete。
8. 全部成功 → 写 `last_backup_succeeded_at`；任一步失败 → 中止并展示结构化错误说明，明确文案「表格可能处于中间状态，重新备份即可修复」。
9. 取消：网络阶段随时可取消（AbortSignal）；半写状态靠下次镜像幂等修平；取消不更新成功时间。
10. app 被杀：无需启动清理（区别于 ZIP 的 0110 —— 半写在远端，幂等重跑收敛）。

### 2.4 迁移操作锁与模型调用锁互斥

- `migration-lock.ts` 仿 `model-call-lock.ts`：`beginMigrationOperation(kind)` 返回 acquired/blocked，kind ∈ `table_backup | table_restore`（预留 `zip_export | zip_import`）。
- 双向互斥：迁移锁 begin 前查模型调用锁占用态，模型调用锁 begin 前查迁移锁占用态——具体接线方式在实现时看 `model-call-context.tsx` 暴露的状态；若现有 context 不外露查询接口，为其增加只读占用查询（不改变既有行为，补测试）。
- 飞书 API 调用**不是模型调用**：不占模型调用锁、不产生业务调用提示、不进全局模型调用状态。

### 2.5 连接配置 UI 与保存探测

- 表单：多维表格链接/app_token 输入框（含 `/wiki/` 检测与引导文案）、个人授权码输入框（密文样式，已存时显示「已保存凭据」不回显——对齐 ADR 0136）。
- 保存时自动做一次只读探测（`GET /tables`）：成功即保存；失败保存但明示「探测未通过」，允许使用者稍后重试（避免网络抖动卡死配置流程）。
- 页面展示上次成功备份时间 + 「立即备份」按钮 + 进行中状态（含取消）。
- 同一 `app_token` 替换授权码只改变访问凭据，保留 `backup_table_id`、`backup_binding_id`、待建表名与成功时间。
- 更换 `app_token` 必须同时提供新 Base 的授权码，并清空目标身份与成功时间；在同一 Base 显式更换写入目标使用独立操作，不再借替换授权码隐式解绑。

## 三、批次二：表格恢复

### 3.1 流程

1. 获取迁移操作锁（kind=table_restore）。
2. 字段校验（1.3，只校验不补建——恢复是读方向，契约不满足直接失败）。
3. 分页拉全量记录 → 逐条经 `field-contract.ts` 映射为模板草稿 → `validatePromptdexTemplate` 校验。
4. **恢复预检报告**（只读，不写库）：
   - 新增清单：表格有、本机无；
   - 覆盖清单：同名条目，展示将被覆盖；
   - 非法清单：校验失败记录 + 具体原因（JSON 解析失败/名称格式非法/缺必填字段…），使用者可勾选「排除非法记录继续」；非法记录存在且未排除时不可确认；
   - 同名多条记录：全部列入非法清单（名称即身份，重复无法裁决）。
5. 使用者确认 → 单事务写入：同名覆盖（delete + insert），本机独有保留；`created_at`/`updated_at` 沿用表格记录值（灾备保真）；与内置条目同名遵循既有 ADR 0186 抑制规则，无需新逻辑。
6. 确认后不可取消（对齐 ADR 0108）；事务失败自动回滚；app 被杀 = 事务回滚，无需启动清理。
7. 完成摘要会话级展示，不持久化（对齐 ADR 0087）。

### 3.2 仓储配合

`PersonalPromptdexEntryRepository` 现无「覆盖写」与「带时间戳写入」能力，需为恢复增加事务性批量写入口（如 `replaceFromRestore(entries)`），保持 `saveFromTemplate` 语义不变——**不得**为绕过 duplicate_name 校验而放宽既有方法。

## 四、测试与验证

| 层 | 内容 |
| --- | --- |
| 单元 | `connection-input`（三种输入形态 + wiki 判定）；`field-contract`（契约校验、缺列/改类型/多余列、记录⇄条目往返无损）；镜像 diff（增/改/删/跳过/表格重名）；恢复预检分类（新增/覆盖/非法/重名）；锁互斥矩阵 |
| 集成 | fake base-api client（内存表格实现）+ memory 仓储跑通备份→改动→再备份幂等、恢复预检→确认写入；node:sqlite 跑 v8→v9 真实迁移（记忆：移动端验证套路） |
| 实机 | 测试多维表格全链路：配置→备份→飞书侧手改（改展示列/改坏 JSON/删字段）→再备份与恢复预检的拦截表现；截图走查需脱沙箱（记忆：移动端截图工具链） |

测试失败时只修生产代码，不动测试（全局协作规范）。

## 五、任务分解

**批次一**
1. schema v9 迁移 + `table_backup_state` + 凭据适配器（含迁移测试）
2. `connection-input` + `base-api-client` + `connection-repository`（含单测）
3. `field-contract`（契约 + 校验 + 映射，含单测）
4. `migration-lock` + 模型调用锁互斥接线（含单测）
5. `backup-service` 镜像引擎 + `backup-session`（含集成测试）
6. 设置页入口 + `app/table-backup/index.tsx` UI + 保存探测
7. 实机验证 + 截图走查

**批次二**
8. 恢复读取与预检报告生成（含单测）
9. 仓储恢复写入口 + 事务写入（含测试）
10. 预检 UI + 确认流 + 完成摘要
11. 实机验证（含飞书侧破坏性编辑场景）

每个任务完成标准：对应测试绿 + `npm run lint`/`tsc` 干净；批次一结束时使用者可在真机完成「配置→备份→在飞书看到镜像」，批次二结束时可完成「清库→恢复→条目与时间戳保真回来」。

## 六、风险与备注

| 风险 | 处置 |
| --- | --- |
| 个人授权码通道文档薄、非正式服务端 API | ADR 0213 已记录回退路径（自建应用方案）；client 只依赖 1.1 节已验证端点 |
| 频率限制 / 429 | 首版串行 + 失败即报（幂等重跑）；不做自动重试队列 |
| 批量/分页上限记忆值不准 | 实现 `base-api-client` 时按官方文档核实并以常量固化 |
| 授权码被吊销/过期 | 归一为结构化错误说明，引导重新获取授权码；不自动清除已存凭据 |
| 大数据量 | 个人条目量级为几十，分批串行足够；不做进度条，只做进行中状态 |
| 多设备写同一备份数据表 | 同一已确认目标仍是最后写入者胜；不同 binding 并发首次建表不得静默共享目标，冲突方必须显式认领或创建带确定性后缀的新表 |
