# 飞书表格备份目标绑定与建表恢复修复方案

> 日期：2026-07-17
> 状态：待实施
> 关联文档：[飞书表格备份方案](./2026-07-14-feishu-table-backup.md)、[展示图方案](./2026-07-16-table-backup-display-image.md)、[ADR 0213](../adr/0213-table-backup-uses-personal-base-token.md)、[ADR 0214](../adr/0214-backup-table-mirrors-merged-promptdex-with-display-image.md)

## 一、问题结论

iOS 实机备份出现 `TableNameDuplicated（1254013）` 后，再次点击「立即备份」仍然失败。直接原因是本机与远端的备份表身份发生了分叉：

- 飞书侧已经存在固定名称 `Imagemon 图鉴备份` 的数据表；
- 本机 `table_backup_state.backup_table_id` 为空或已经失效；
- 备份逻辑在 ID 为空时直接再次创建固定名称的数据表，不会发现和恢复已有目标；
- `1254013` 在 `setBackupTableId()` 之前抛出，本机状态没有发生变化；
- 下一次点击会重复完全相同的建表请求，因此不可能自行收敛。

现有统一提示「表格可能处于中间状态，重新备份即可修复」只适用于已经保存 `table_id` 后的记录级半写，不适用于建表阶段的身份丢失。

容易触发状态分叉的场景包括：

1. 在同一 `appToken` 下重新填写个人授权码；当前仓储把任何非空授权码都视为更换目标并清空 `backup_table_id`。
2. 清除连接、重装应用、换设备后重新连接同一个 Base。
3. 建表已在服务端提交，但客户端超时、断网、被系统杀死、收到无法解析的响应，或本地回填 `table_id` 失败。
4. 同一个 Base 已经被另一台设备用于备份。
5. 使用者手工创建或复制了同名数据表。
6. 当前错误分类过宽，把非数据表不存在错误误解释为目标被删除并再次建表。

飞书官方将 `1254013` 定义为 `TableNameDuplicated`，即表名重复：<https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table/create>。

## 二、修复目标

本次修复必须同时满足：

1. 同一 Base 轮换个人授权码不再丢失已绑定的数据表。
2. 建表在远端成功、客户端结果未知时，可以找回同一张表，不重复创建。
3. `1254013` 不再形成永久重试循环。
4. 不得仅凭表名自动接管数据表。
5. 身份未确认前，不得补字段、上传附件或增删改记录。
6. 新设备或重装后应允许先从远端恢复，不能引导使用者先备份并覆盖灾备数据。
7. 旧 7 字段表、部分升级表、当前 10 字段表继续兼容。
8. 正常路径继续以已保存的 `table_id` 为主身份，不增加每次备份的远端扫描开销。
9. 所有失败提示准确说明当前阶段和是否可能发生远端写入。
10. 测试替身必须复现飞书的表名唯一约束和建表结果不确定场景。

## 三、非目标

本次不处理：

- 多台设备同时把不同本地图鉴全量镜像到同一备份表时的最后写入者覆盖问题；
- 自动合并多台设备的图鉴内容；
- 改变当前记录级全量镜像语义；
- 把个人授权码迁移到服务端或开放平台应用鉴权；
- 自动删除、重命名使用者现有的数据表；
- 手工创建 GitHub Release 或绕过现有发布流水线。

## 四、核心安全原则

### 4.1 备份目标身份

备份目标身份定义为：

```text
(appToken, tableId, backupBindingId)
```

- `appToken`：多维表格位置。
- `tableId`：具体备份数据表的飞书资源 ID。
- `backupBindingId`：Imagemon 生成的非秘密 UUID，用于在 `tableId` 丢失或建表结果未知时重新发现目标。
- 个人授权码：访问凭据，不属于资源身份。

正常运行时仍以 `tableId` 为强身份；`backupBindingId` 只用于失联恢复、并发建表对账和冲突判断。

### 4.2 表名和字段契约不是身份

表名 `Imagemon 图鉴备份` 只用于展示。字段契约只能证明一张表可以被当前版本消费，不能证明它就是本机原来绑定的目标。

禁止以下修复：

- 遇到 `1254013` 后按名称取第一张表并继续镜像；
- 找到字段结构相似的表后静默认领；
- 对任意同名表调用 `ensureBackupFieldContract()`，把陌生表补成兼容结构；
- 在候选身份未确认时删除远端独有记录。

原因是表格备份会删除「远端存在、本机不存在」的记录。新设备本机可能为空，而远端表恰好是准备恢复的灾备数据；静默认领后立即镜像会直接销毁备份。

## 五、本地状态与 schema v10

### 5.1 新增字段

`table_backup_state` 增加：

```sql
ALTER TABLE table_backup_state ADD COLUMN backup_binding_id TEXT;
ALTER TABLE table_backup_state ADD COLUMN pending_table_name TEXT;
```

完整语义：

| 字段 | 语义 |
| --- | --- |
| `app_token` | 目标 Base |
| `backup_table_id` | 已确认绑定的数据表 ID |
| `backup_binding_id` | 目标绑定 UUID |
| `pending_table_name` | 已准备或已发起建表，但结果尚未确认时的名称 |
| `last_backup_succeeded_at` | 当前绑定目标的最近成功备份时间 |

### 5.2 迁移规则

- `CURRENT_SCHEMA_VERSION` 从 9 升到 10。
- 旧行的 `app_token`、`backup_table_id`、`last_backup_succeeded_at` 原样保留。
- 新增列初始为 `NULL`，不在迁移时访问网络。
- 已有非空 `backup_table_id` 是强身份；下次备份时再生成绑定 ID 并补远端管理标识。
- ID 为空的旧状态不自动猜测目标，由运行时发现和显式认领处理。
- 本次迁移不修改安全存储中的个人授权码。

## 六、连接配置语义修正

修改 `connection-repository.save()`：

### 6.1 同一 Base 更换凭据

当 `appToken` 不变时，替换个人授权码只更新安全存储，必须保留：

- `backupTableId`
- `backupBindingId`
- `pendingTableName`
- `lastBackupSucceededAt`

授权码只改变访问能力，不改变目标身份。

### 6.2 更换 Base

当 `appToken` 变化时：

- 要求同时填写新 Base 对应的个人授权码；
- 清空 `backupTableId`、`backupBindingId`、`pendingTableName` 和成功时间；
- 不删除旧 Base 中的远端数据表。

### 6.3 显式更换备份目标

新增独立操作 `startNewBackupTarget()`，用于在同一个 Base 中解绑旧表并创建独立目标。不得继续借「替换授权码」隐式更换目标。

### 6.4 条件写入

仓储增加带预期目标的原子方法：

```ts
ensureBackupBindingId(expectedAppToken): Promise<string>;

markCreatePending({
  expectedAppToken,
  bindingId,
  tableName,
}): Promise<void>;

bindBackupTable({
  expectedAppToken,
  expectedBindingId,
  tableId,
}): Promise<TableBackupConnection>;

markBackupSucceeded({
  expectedAppToken,
  expectedTableId,
  succeededAt,
}): Promise<TableBackupConnection>;
```

SQLite 使用带 `WHERE app_token = ?`、必要时带 `backup_binding_id = ?` 的条件更新，并检查影响行数。内存实现保持相同语义。

目标是在备份期间连接从 Base A 切到 Base B 时，拒绝把 A 的 `tableId` 或成功时间写入 B。

绑定 ID 轮换代表目标真正改变，必须清空旧成功时间；仅恢复同一 binding 的 `tableId` 时可以保留成功时间。

## 七、远端管理标识

### 7.1 标识格式

新建数据表时，在现有业务字段之外增加一个文本字段：

```text
__imagemon_backup_target_v1__<backupBindingId>
```

例如：

```text
__imagemon_backup_target_v1__550e8400-e29b-41d4-a716-446655440000
```

该 UUID 不是凭据，不包含设备或用户信息。

### 7.2 标识职责

- 与数据表通过同一个 `POST /tables` 原子创建。
- 不进入图鉴记录字段映射、镜像 diff 或恢复数据。
- `listFields` 可读取并解析该字段名。
- 建表响应超时或缺少 `table_id` 时，可按 binding 找回刚创建的表。
- 表被使用者重命名后，仍可按 binding 找回。
- 复制表导致同一个 binding 出现在多张表时，返回歧义，不按列表顺序选择。

### 7.3 版本处理

管理字段解析器识别通用前缀和版本：

```text
__imagemon_backup_target_v<version>__<uuid>
```

- `v1`：当前支持。
- 未知更高版本：停止写入并提示升级应用。
- 一张表存在多个管理标识：视为绑定冲突，停止写入。

### 7.4 为什么不用哨兵记录

哨兵记录需要在建表后单独写入，不能覆盖「建表成功、写哨兵前中断」的窗口，而且可能被镜像删除。管理字段必须随建表原子创建。

飞书当前新增数据表接口没有可依赖的 `client_token` 建表幂等参数，因此本方案不以客户端幂等键为前提：<https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table/create>。

## 八、共享表解析器

新增：

```text
apps/mobile/src/table-backup/table-resolver.ts
```

建议暴露：

```ts
resolveTableForBackup(...): Promise<TableResolution>;
resolveTableForRestore(...): Promise<TableResolution>;
inspectTableCandidate(...): Promise<TableCandidateInspection>;
reconcilePendingCreate(...): Promise<TableResolution>;
adoptExistingTable(...): Promise<TableResolution>;
createManagedTable(...): Promise<TableResolution>;
```

### 8.1 结果类型

```ts
type TableResolution =
  | { status: "ready"; tableId: string; recovered: boolean }
  | { status: "needs_table_choice"; candidates: TableCandidate[] }
  | { status: "not_found" }
  | { status: "failed"; error: TableResolutionError };
```

### 8.2 候选只读检查

身份确认前只允许 `listTables` 和 `listFields`，不得补字段。

候选分类：

| 类型 | 判定 | 自动行为 |
| --- | --- | --- |
| `stored` | 已保存 `tableId` 可访问 | 自动使用 |
| `managed_matching` | 唯一管理 marker 与本地 binding 匹配 | 自动绑定 |
| `legacy7` | 原 7 个必需字段存在且类型正确，新 3 字段都缺失 | 要求选择 |
| `partial8_9` | 原 7 字段正确，新字段仅部分存在且类型正确 | 要求选择 |
| `current10` | 当前 10 字段正确但无 marker | 要求选择 |
| `managed_other` | 是 Imagemon 表，但 binding 不同 | 要求选择 |
| `incompatible` | 必需字段缺失或任一契约字段类型错误 | 不认领、不修改 |
| `future_managed` | 管理 marker 版本高于当前支持 | 提示升级 |
| `ambiguous` | 多个候选匹配同一 binding | 禁止自动选择 |

多余的使用者字段继续忽略，符合原设计。

### 8.3 正常解析流程

```text
LOAD
 ├─ 有 stored table_id → VERIFY_STORED
 │   ├─ 有效 → VERIFY_BINDING → REPAIR_OWNED_CONTRACT → READY
 │   ├─ 明确 TableIdNotFound → DISCOVER
 │   └─ 超时/网络/权限/无效响应 → FAILED，不建表
 └─ 无 stored table_id → DISCOVER

DISCOVER
 ├─ 唯一 matching binding marker → 绑定 → READY
 ├─ 多个 matching marker → AMBIGUOUS
 ├─ 无标记兼容旧表或其他 binding → NEEDS_TABLE_CHOICE
 ├─ 同名不兼容表 → CREATE_WITH_SUFFIX
 └─ 无候选 → PREPARE_CREATE

PREPARE_CREATE
 ├─ 确保并持久化 binding_id
 ├─ 持久化 pending_table_name
 └─ CREATE

CREATE
 ├─ 成功返回 table_id → 条件绑定 → READY
 ├─ 1254013 → RECONCILE_CREATE
 ├─ timeout/network/invalid_response/5xx → RECONCILE_CREATE
 ├─ POST 发出后取消 → 保留 pending，下次对账
 └─ 明确鉴权/权限/参数错误 → FAILED

RECONCILE_CREATE
 ├─ 唯一 matching marker → 条件绑定 → READY
 ├─ 发现兼容旧表或其他 binding → NEEDS_TABLE_CHOICE
 ├─ 同名外部表占用 → CREATE_WITH_SUFFIX 或要求确认
 └─ 仍无法确认 → CREATE_UNCERTAIN，本次不再 POST
```

### 8.4 已保存 ID 的处理

- 已保存 `tableId` 是强身份，即使远端表被重命名也继续使用。
- 只有飞书明确返回 `1254041 TableIdNotFound` 才进入目标失效流程。
- 先按现有 binding 扫描全部表，防止表只是被复制、移动或本机 ID 损坏。
- 完全找不到旧 binding 后，创建替代目标时必须生成新的 binding，并清除旧成功时间。
- 网络错误、权限错误、服务端错误和 `Data not ready` 不得清 ID、不得建新表。

### 8.5 发现范围

- 正常路径不调用 `listTables`，继续直接使用已保存 ID。
- 仅在 ID 为空、明确失效、存在 pending 或建表结果不确定时分页拉全量数据表。
- 有本地 binding 时需要检查所有表的管理字段，以支持远端重命名。
- 无本地 binding 的旧状态默认只检查精确同名表或使用者显式提供的 `tableId`，不按相似字段扫描整个 Base。
- 任一分页或字段读取失败都会使发现结果不完整；结果不完整时禁止创建或认领。

## 九、`1254013` 与建表结果不确定的处理

### 9.1 建表前

1. 先完成必要的只读发现。
2. 生成并持久化 binding。
3. 选择并持久化目标名称。
4. 一次性创建业务字段与管理 marker。

### 9.2 收到 `1254013`

禁止再次用相同表名盲目 POST。必须：

1. 重新分页读取数据表。
2. 读取候选字段。
3. 找到唯一匹配当前 binding 的表时，保存其 `tableId` 并继续。
4. 找到无 marker 的兼容旧表或其他 binding 时，返回选择状态，本次零记录写入。
5. 同名表明显不兼容时，使用确定性后缀名创建独立目标：

```text
Imagemon 图鉴备份 · <bindingId 前 8 位>
```

若短前缀仍冲突，逐步扩大前缀，限制尝试次数。

### 9.3 结果不确定

以下情况视为建表提交结果未知：

- `timeout`
- `network_error`
- `server_error`
- 响应体无法解析
- 成功信封缺少 `table_id`
- POST 已发出后取消

处理规则：

- 不自动重发非幂等 POST。
- 信号未取消时，执行一次读后对账。
- 对账成功则继续。
- 对账失败则保留 binding 和 pending，返回结构化的 `table_create_uncertain`。
- 同一次运行中不创建第二张无法确认的表。
- 下一次操作首先对账，不首先建表。

## 十、字段契约升级

### 10.1 确权前

只读分析现有字段。不得调用会补字段的函数。

### 10.2 确权后

允许：

- 旧 7 字段表补齐「来源类型」「展示图标识」「展示图」；
- 已保存 ID 的旧表补管理 marker；
- 使用者确认认领的旧表补 marker 和缺失字段；
- 忽略额外字段。

仍然禁止自动修改类型不符字段。

### 10.3 补字段结果不确定

`POST fields` 发生超时、网络错误、5xx、无效响应或字段重名时，重新读取字段：

- 字段已经存在且类型正确：视为成功；
- 字段不存在：返回可重试失败；
- 字段存在但类型错误：返回契约冲突。

`FieldContractError` 应保留结构化 `cause`，不能丢失底层 `BaseApiError.code`。

## 十一、错误码分类修正

修正 `base-api-client.ts`：

| 错误码 | 分类 | 行为 |
| --- | --- | --- |
| `1254013` | `conflict` | 进入建表对账 |
| `1254041` | `table_not_found` | 唯一允许进入目标失效流程的业务码 |
| `1254045` | `field_not_found` | 字段错误，不得解释为表被删 |
| `1254607` | `not_ready` / `transient` | 稍后重试，不得重建表 |
| `1254291` | `write_conflict` | 串行等待后按现有策略处理 |

HTTP 非 2xx 但响应体包含飞书业务码时，必须优先按业务码分类，并在结构化错误中保留 `code`。

任何服务层恢复分支都优先检查具体业务码或明确资源类型，不能继续用宽泛的 `kind === "not_found"` 推断表不存在。

官方字段接口错误定义：<https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/list>。

## 十二、备份服务接入

`runBackup()` 调整为阶段化编排：

1. 读取连接与凭据。
2. 获取迁移锁。
3. `resolveTableForBackup()`。
4. 只有结果为 `ready` 才读取本机内容、上传附件和写记录。
5. 记录阶段继续沿用当前幂等 diff 和串行批处理。
6. 使用带预期 `appToken + tableId` 的条件写入更新成功时间。

扩展结果：

```ts
type RunBackupResult =
  | { status: "succeeded"; summary: BackupSummary; succeededAt: string }
  | { status: "needs_table_choice"; candidates: TableCandidate[] }
  | { status: "not_configured" }
  | { status: "blocked"; reason: "migration" | "model_call" }
  | { status: "cancelled" }
  | { status: "failed"; error: BackupFailure };
```

`BackupFailure` 至少包含：

```ts
interface BackupFailure {
  kind: string;
  phase:
    | "resolve_table"
    | "upgrade_contract"
    | "upload_images"
    | "create_records"
    | "update_records"
    | "delete_records"
    | "mark_success";
  message: string;
  retryable: boolean;
  mayHaveRemoteWrites: boolean;
}
```

## 十三、恢复流程接入

当前恢复预检在 `backupTableId` 为空时返回 `not_configured`，并提示先完成一次备份。该行为必须移除。

新流程：

1. 未配置 `appToken` 或个人授权码：返回 `not_configured`。
2. 已配置但无 `tableId`：调用只读 `resolveTableForRestore()`。
3. 唯一 marker 与本地 binding 匹配：自动条件绑定并继续预检。
4. 发现旧兼容表或其他 Imagemon 表：返回 `needs_table_choice`。
5. 使用者选择「从此表恢复」后：
   - 重新只读校验候选；
   - 保存明确选择的 `tableId`；
   - 运行恢复预检；
   - 不补字段、不写 marker、不修改远端记录。
6. 未发现目标：提示「未发现可恢复的备份数据表」。

恢复预检仍然保持远端只读。管理 marker 的升级延后到使用者后续主动备份时完成。

## 十四、旧表认领 UI

发现无 marker 的旧 7/8/9/10 字段表或其他 binding 的 Imagemon 表时，展示：

> 发现现有 Imagemon 备份数据表。备份是全量镜像，可能删除表中本机不存在的记录。请选择下一步。

操作：

1. **先从此表恢复（推荐）**
2. **使用此表并以本机内容覆盖**
3. **保留此表，创建新的备份表**
4. **取消**

### 14.1 先恢复

- 保存用户明确选择的 `tableId`；
- 进入恢复预检；
- 不做任何远端写入。

### 14.2 覆盖

必须显示二次破坏性确认：

> 继续后，表中本机不存在的图鉴记录会被删除。建议先完成恢复或另建备份表。

确认后：

1. 重新读取字段，防止候选在确认期间发生变化；
2. 准备本地 binding；
3. 保存明确绑定；
4. 补 marker 和缺失字段；
5. 开始镜像。

### 14.3 新建独立表

- 保留现有表不变；
- 生成新的 binding；
- 使用确定性后缀名创建新表；
- 成功后提示实际表名。

### 14.4 精确表链接

连接输入增加对 `?table=tbl...` 的解析，允许使用者用完整 Base 数据表链接明确指定候选。显式 table ID 仍需经过只读字段校验，但不需要按名称猜测。

## 十五、失败文案

删除对所有错误统一追加的「重新备份即可修复」。按阶段映射：

| 场景 | 文案重点 |
| --- | --- |
| 鉴权或权限失败 | 修复授权，不声称存在半写 |
| 同名旧表待认领 | 本次尚未写入，要求选择恢复、覆盖或新建 |
| 契约不兼容 | 指出具体字段，本次未修改记录 |
| 建表结果未知 | 下次会先对账，不会盲目重复创建 |
| 本地绑定保存失败 | 远端表可能已创建，下次会自动识别 |
| 记录增删改开始后失败 | 表格可能已部分更新，再次备份会自动校正 |
| 未找到恢复目标 | 未发现可恢复表，不引导先备份 |
| 未知未来 marker | 请升级应用后再操作 |

错误消息不得包含个人授权码、请求头或完整响应体。

## 十六、会话与并发保护

### 16.1 单进程

- 继续使用迁移锁保证备份和恢复互斥。
- `backup-session.start()` 在 `running/cancelling` 状态必须拒绝重入或返回原信号，不能替换已有 `AbortController`。
- UI 快速双击不得启动两个独立会话。

### 16.2 连接切换

- 所有绑定和成功时间写入使用 CAS。
- CAS 失败说明连接已变化，本次操作停止，不污染新目标。
- 远端可能留下带旧 binding 的表；重新切回旧 Base 时可以通过 marker 找回。

### 16.3 多设备同时建表

- 两台设备使用不同 binding 并发创建固定名称时，一台成功，另一台收到 `1254013`。
- 失败设备重新发现后看到其他 binding，必须要求使用者选择认领或新建，不能静默共享镜像目标。
- 选择新建时使用 binding 后缀名，避免继续冲突。

## 十七、测试方案

新增回归测试时先复现失败，再只修改生产代码使其通过。不得放宽断言、跳过测试或用失真的 Mock 绕过问题。

### 17.1 `base-api-client.test.ts`

- `200 + code=1254013` 映射为冲突并保留错误码。
- `HTTP 400 + code=1254013` 得到相同业务分类。
- `1254041`、`1254045`、`1254607` 分类互不混淆。
- HTTP 错误信封统一保留业务码。
- `listTables` 的分页、取消和无效响应。
- 建表响应缺少 `table_id` 仍为结果不确定。

### 17.2 `connection-repository.test.ts`

- 同一 `appToken` 替换授权码保留全部目标状态。
- appToken 变化清空目标状态。
- 更换 Base 但不提供新授权码时拒绝保存。
- binding 准备、pending、绑定和成功时间的状态转换。
- table ID 真变化时清旧成功时间。
- CAS 阻止 A 的结果写入 B。
- 凭据保存或 SQLite 写入失败后不出现跨目标混搭。

### 17.3 `table-resolver.test.ts`

覆盖：

| 场景 | 期望 |
| --- | --- |
| 已保存 ID 有效 | 不扫描、不建表 |
| 已知表被重命名 | 继续按 ID 使用 |
| ID 明确失效，marker 在重命名表中 | 自动找回 |
| ID 查询超时、无权限、not ready | 保留状态，不建表 |
| 无 ID、无远端表 | 准备 binding 后建表一次 |
| 无 ID、唯一 marker 匹配 | 自动绑定 |
| 无 ID、旧 7 字段表 | 返回选择状态，零写入 |
| 无 ID、当前 10 字段无 marker | 返回选择状态，零写入 |
| 候选带额外用户字段 | 仍可作为兼容候选 |
| 必需字段缺失或类型错误 | 不认领、不补字段 |
| 多个表匹配同一 binding | 返回歧义 |
| 仅名字相似、带空格或后缀 | 不当作旧同名候选 |
| 未知未来 marker | 阻止写入 |

### 17.4 建表故障与竞态

- 首次列表为空，其他客户端抢先创建，本客户端收到 `1254013`。
- 建表远端已提交，但客户端收到 timeout/network/server error。
- 建表响应缺少 `table_id`。
- 建表成功但本地绑定保存失败；下一次找到原表。
- 对账首次读取旧快照，下一次可见。
- `1254013` 后仍未找到当前 binding，本次不再次 POST。
- 同名表属于其他 binding 时不写记录。
- 同名不兼容表保留不变，新表使用确定性后缀。
- 两客户端并发首次备份。
- 对账中取消后，下一次按 pending 继续。

### 17.5 备份和恢复服务

- 只有 `ready` 后才读取本机条目和上传图片。
- `needs_table_choice` 时所有远端写调用为 0。
- 旧表确认覆盖前重新校验候选。
- 新设备可直接进入恢复预检，不要求先备份。
- 恢复预检不补 marker、不补字段。
- 记录级 create/update/delete 半写仍能重跑收敛。
- `markBackupSucceeded` 失败时不伪造成功状态。
- 不同阶段使用不同错误文案。

### 17.6 Fake Base

修正 `fake-base-api.ts`：

- 生产 `createTable` 默认拒绝同名表并返回 `1254013`。
- `seedTable` 仅在测试显式要求时允许制造异常状态。
- 增加表列表分页和 `listTables/listFields/createTable` 调用计数。
- 支持一次性故障注入：
  - 提交前失败；
  - 提交后超时；
  - 缺失响应 ID；
  - 延迟可见；
  - 本地绑定保存失败；
  - 字段创建结果不确定。

这是提高测试替身与真实飞书的一致性，不是通过修改测试逻辑规避失败。

### 17.7 schema 迁移

- 全新库直接创建 v10 schema。
- v9 → v10 保留现有连接、表 ID 和成功时间。
- 重复初始化不重复改表。
- 迁移失败事务回滚，遵守现有只读恢复模式。

## 十八、iOS 实机验收

在开发构建和 Release/TestFlight 构建各执行一次：

1. 空白 Base 首次备份，只创建一张 managed 表。
2. 立即再次备份，表 ID 和表数量不变。
3. 同一 Base 重新填写同一个或新个人授权码，继续使用原表。
4. 清除连接后重新配置同一 Base，发现旧表并要求先恢复、覆盖或新建。
5. 重装应用后连接旧 Base，可以直接先恢复，不能要求先备份。
6. 删除远端已绑定表，再次备份创建新的 binding 目标并清旧成功时间。
7. 远端表被重命名且本地 ID 丢失，按 marker 找回。
8. 构造旧 7 字段表，显式认领后补齐新字段和 marker。
9. 手工创建不兼容同名表，确认它的字段和记录未被修改。
10. 建表响应阶段断网或强杀应用，恢复后自动找回原表。
11. 两台设备同时首次备份，不会静默共享不同 binding 的表。
12. 快速双击和取消不会丢失第一次操作的取消信号。
13. 错误授权码、无权限、飞行模式和 not ready 不会触发建表。
14. 记录写入中断后不刷新成功时间，再次备份能够收敛。
15. 全流程不再向使用者暴露可重复的 `TableNameDuplicated 1254013` 循环。

## 十九、代码改动范围

预计涉及：

```text
apps/mobile/src/storage/index.ts
apps/mobile/src/storage/index.migration.test.ts
apps/mobile/src/table-backup/base-api-client.ts
apps/mobile/src/table-backup/base-api-client.test.ts
apps/mobile/src/table-backup/connection-input.ts
apps/mobile/src/table-backup/connection-input.test.ts
apps/mobile/src/table-backup/connection-repository.ts
apps/mobile/src/table-backup/connection-repository.test.ts
apps/mobile/src/table-backup/field-contract.ts
apps/mobile/src/table-backup/field-contract.test.ts
apps/mobile/src/table-backup/table-resolver.ts
apps/mobile/src/table-backup/table-resolver.test.ts
apps/mobile/src/table-backup/backup-service.ts
apps/mobile/src/table-backup/backup-service.test.ts
apps/mobile/src/table-backup/backup-session.ts
apps/mobile/src/table-backup/backup-session.test.ts
apps/mobile/src/table-backup/restore-service.ts
apps/mobile/src/table-backup/restore-service.test.ts
apps/mobile/src/table-backup/fake-base-api.ts
apps/mobile/app/table-backup/index.tsx
apps/mobile/app/table-backup/restore.tsx
CONTEXT.md
docs/adr/<新 ADR>.md
docs/plans/2026-07-14-feishu-table-backup.md
```

## 二十、实施批次

### 批次一：决策与回归测试

1. 新增 ADR：备份目标身份、binding marker、旧表显式认领。
2. 修订原方案中「更换授权码即清状态」和「ID 空直接建表」的规则。
3. 修正 Fake Base 的表名唯一约束。
4. 添加 `1254013`、错误码分类和旧表候选失败测试。

完成标准：测试能够稳定复现当前永久循环，且未修改生产逻辑绕过失败。

### 批次二：存储与 API 基础

1. schema v10 迁移。
2. 仓储目标状态和 CAS。
3. 连接保存语义修正。
4. Base API 错误码分类与 HTTP 信封统一。
5. 管理 marker 解析与构造。

完成标准：仓储、迁移和客户端单测全绿。

### 批次三：共享解析器

1. 候选只读检查。
2. stored ID 验证。
3. binding 发现。
4. managed 表创建。
5. 1254013 和结果不确定对账。
6. 旧表选择、外部同名表和歧义处理。

完成标准：表解析状态矩阵和故障注入测试全绿。

### 批次四：备份、恢复与 UI

1. 备份接入 resolver。
2. 恢复预检接入只读 resolver。
3. 旧表选择和破坏性确认 UI。
4. 完整表链接解析。
5. 阶段化错误文案。
6. 会话防重入。

完成标准：服务集成测试、会话测试和 UI 纯函数文案测试全绿。

### 批次五：统一验证与实机

运行：

```bash
npm run mobile:verify
npm run verify
```

随后完成第十八节实机矩阵。

## 二十一、发布门槛

只有同时满足以下条件才可发布：

- 所有新增回归测试通过；
- `npm run mobile:verify` 通过；
- `npm run verify` 通过；
- schema v9 → v10 真机升级验证通过；
- iOS 开发构建与 Release/TestFlight 构建均完成实机矩阵；
- 身份不确定场景保持零记录写入；
- 重装或换设备可以先恢复，不会先覆盖远端备份；
- 建表成功但客户端结果未知时，下一次可找回同一张表；
- 正常重复备份不增加新表；
- 不再出现可重复的 `TableNameDuplicated 1254013` 循环。

如本次修复随版本发布，按仓库发布规范统一同步根包、`packages/core` 与 `apps/mobile` 版本，重建 Skill 并通过统一验证；只推送与 `package.json` 严格匹配的 `v<version>` 标签，由现有工作流创建 Release。
