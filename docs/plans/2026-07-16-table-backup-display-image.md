# 表格备份镜像合并图鉴并附展示图——实现方案（2026-07-16，2026-07-17 spike 修订）

## 来源与依据

- **共识**：2026-07-16 grilling 会话逐题达成，词汇表见 `CONTEXT.md`（修订后的「表格备份」「表格恢复」、新增「展示图」）。
- **决策记录**：[ADR 0214](../adr/0214-backup-table-mirrors-merged-promptdex-with-display-image.md)（备份数据表镜像合并图鉴并附展示图）、[ADR 0215](../adr/0215-restore-contract-validation-by-consumption-necessity.md)（恢复契约校验按消费必需性分级）。
- **前置基础**：表格备份/恢复本体已随 v0.11.0 发布，模块在 `apps/mobile/src/table-backup/`，原方案见 [2026-07-14-feishu-table-backup.md](./2026-07-14-feishu-table-backup.md)。
- **硬门槛结论**：2026-07-17 spike 全绿——个人授权码通道可上传素材，并可经 bitable v1 单条记录更新把附件写入数据表，飞书界面显示与记录读回均正常；具体兼容边界见批次〇。

## 范围

| 批次 | 内容 |
| --- | --- |
| 批次〇 | spike：个人授权码上传附件全链路验证（**硬门槛，2026-07-17 已通过**） |
| 批次一 | 契约扩展 + 备份方向（合并图鉴全量入表、展示图上传与标识 diff） |
| 批次二 | 恢复方向（消费必需性校验、来源过滤、预检第四类别） |

**非目标**（本方案明确不做）：图片压缩/转码（原图直传）；Wi-Fi 检测与流量预估提示；展示图回流本机（单向投放，恢复不读附件）；备份最新一张以外的图片结果；封面示例图与任务历史入表；断点续传；对使用者在飞书侧改动附件内容的察觉与修复（标识不变即不触碰）。

## 关键现状事实

- 字段契约现为 7 个文本字段（`field-contract.ts`），`sourceType` 恒为 personal 不入表——本方案推翻这两点。
- 镜像引擎 `backup-service.ts` 是无状态文本 diff（`planMirror` + `fieldsDiffer`），任一步失败即中止、幂等重跑修平——语义保持，流程中插入上传阶段。
- 合并图鉴数据源：`personalRepository.list()`（含时间戳）+ `loadBuiltInPromptdexCatalog().templates`（完整 `PromptdexTemplate`，**无时间戳**）；同名时个人条目抑制内置（`promptdex/index.ts:103`），合并图鉴内名称唯一——「名称」仍可作镜像匹配键。
- 「已生成图鉴条目 + 最新一张图片结果」的判定逻辑已存在：`promptdex/home.ts` 的分类（completed 任务 + 快照 sourceType:name 匹配）与 `compareImageResultDescending` 排序，`generatedEntries[].representativeImage` 即所需数据。
- 图片文件：`ImageResult.filePath`（相对路径）现只能经 `ImageResultFileStorage.resolveFileUri` 解析为 URI，但上传还必需真实字节数；需给文件存储增加上传描述能力，统一产出 `{ uri, name, type, size }`。当前 `ImageResultFormat` 只有 png（映射 `image/png`），结果同时保存可空的宽高；MIME/扩展名映射仍按 format 封装以便未来扩展。
- `base-api-client.ts` 现只做 JSON 请求、统一 30s 超时——上传需新增 multipart 方法与独立超时；附件写入复用 JSON 请求超时，但必须新增 bitable v1 单条记录 `PUT`，不能复用批量更新。
- **本次不动 SQLite schema**：无迁移、无新增本机持久化状态（镜像保持无状态是共识第 4 条）。

## 〇、批次〇：spike（硬门槛，2026-07-17 已通过）

验证目标：个人授权码（`pt-` token）在 base-api 域名走「上传素材拿 `file_token` → 写记录附件字段 → 飞书界面看到图 → 读回附件值」全链路。实测结果如下（凭据与资源标识均未入文档）：

| 验证项 | 实测结果 |
| --- | --- |
| 上传素材，`parent_type=bitable_image` | HTTP 200，业务码 `1011 personal token is invalid`，不可用 |
| 上传素材，`parent_type=bitable_file` | HTTP 200、`code=0`，返回非空 `data.file_token`（另带 `version`） |
| 创建「展示图」字段 | HTTP 200、`code=0`，读回 `type=17`、`ui_type=Attachment` |
| bitable v1 `batch_update` 写 `[{ file_token }]` | HTTP 200、业务码 `1254001 WrongRequestBody`，附件仍为空，不可用 |
| Base v3 `append_attachments` | `base-api.feishu.cn` 路由直接 HTTP 404，个人授权码域不暴露该端点 |
| bitable v1 单条记录 `PUT` 写 `[{ file_token }]` | HTTP 200、`code=0`，飞书界面实际显示图片 |
| `GET records` 读回 | `展示图` 为数组，元素包含 `file_token`、`name`、`size`、`tmp_url`、`type`、`url` |

据此落定：

1. 上传端点为 `POST https://base-api.feishu.cn/open-apis/drive/v1/medias/upload_all`，`parent_type` 固定为 `bitable_file`，`parent_node` 为 `app_token`。
2. 附件字段类型固定为 `17`；写值为 `[{ "file_token": "…" }]`；计划用 `[]` 清空（硬门槛 spike 未覆盖清空，留待实现后实机验证）。
3. 附件写入固定走 `PUT /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id`；「展示图标识」与「展示图」必须放在同一个单条 `PUT` 的 `fields` 中。
4. `batch_create` 只负责先建立记录；`batch_update` 继续用于普通文本更新，二者都不得携带「展示图标识」或「展示图」——两个字段只允许由单条 `PUT` 同时触碰。
5. 不使用 `bitable_image`，不尝试把附件塞入 `batch_update`，也不使用个人授权码域未暴露的 Base v3 `append_attachments`。

## 一、外部契约变更

### 1.1 字段契约 v2（7 → 10 字段）

新增三个字段追加在契约尾部（建表顺序不影响既有表——旧表靠备份方向补建）：

| 字段名 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| （原 7 字段） | 文本 | 同原方案 1.2 | 不变；内置条目的「条目创建时间/条目更新时间」写空串（内置模板无时间戳） |
| 来源类型 | 文本（type 1） | `sourceType` | 值 `built-in` / `personal`，与 `PromptdexCatalogEntrySourceType` 字面量一致 |
| 展示图标识 | 文本（type 1） | 最新图片结果 id | 未生成条目为空串；驱动附件更新的 diff 键 |
| 展示图 | 附件（type 17） | 图片文件 | 值 `[{ file_token }]` 或空；**不参与文本 diff**，不进 `entryToBackupFields` |

附件写入请求只发送 `[{ file_token }]`；单条 `PUT` 响应回显同一精简形态。`GET records` 实测未挂附件时为 `null`，挂载后返回富化数组，元素包含 `file_token` / `name` / `size` / `tmp_url` / `type` / `url`；恢复不消费这些附件值，临时 URL 不持久化、不写日志。

新增常量 `BASE_FIELD_TYPE_ATTACHMENT = 17`（`base-api-client.ts`）。

### 1.2 附件上传与单记录写入（spike 已实测）

`base-api-client.ts` 新增 `uploadMedia(input, options): Promise<string /* file_token */>`：

- `POST /open-apis/drive/v1/medias/upload_all`，multipart/form-data 字段为 `file_name` / `parent_type=bitable_file` / `parent_node=app_token` / `size` / `file`（RN FormData `{ uri, name, type }`）；不要手工设置 `Content-Type`，由 FormData/fetch 生成 boundary；
- `size` 必须取文件真实字节数且大于 0；普通素材上传上限为 20 MB，超限时直接给出可解释失败（不压缩、不转码，也不改走分片上传）；
- **独立超时常量**（预设 `120_000ms`，大图 + 移动网络，30s 统一超时不适用），支持 `AbortSignal`；
- 成功只消费 `data.file_token`，忽略同响应的 `version`；错误归一沿用 `BaseApiError`，凭据不入错误说明。

`ImageResultFileStorage` 同步新增 `createUploadFile(filePath, format): Promise<{ uri, name, type, size }>`：Expo 实现通过 `expo-file-system` 的 `File.info()` 校验文件存在并读取字节数，memory 实现从内存文件内容计算；`backup-service` 不直接依赖 Expo API。图片文件缺失、空文件或超过 20 MB 都在上传前失败。

同时新增 `updateRecord(tableId, recordId, fields, options): Promise<BaseRecord>`：

- `PUT /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id`，复用现有 JSON 请求、30s 超时与取消语义；
- 严格解析单条响应的 `data.record`，不复用批量接口的 `data.records` 解析；
- 只要记录需要新增、替换或清空展示图，就由该方法在同一个 `fields` 中同时写「展示图标识」与「展示图」；
- `batchUpdateRecords` 仍用于纯文本更新，但任何 batch 调用都必须剔除「展示图标识」与「展示图」。

新增常量 `BASE_MEDIA_PARENT_TYPE = "bitable_file"`、`MAX_BASE_MEDIA_UPLOAD_BYTES = 20 * 1024 * 1024`、`DEFAULT_BASE_MEDIA_UPLOAD_TIMEOUT_MS = 120_000` 与 `BASE_FIELD_TYPE_ATTACHMENT = 17`；注释记录上述个人授权码兼容边界，避免将来按标准 OpenAPI/CLI 形态误改为 batch 或 Base v3。

### 1.3 校验规则分级（ADR 0215）

`field-contract.ts` 把契约拆为两级：

- **恢复必需集** = 原 7 字段：`assertRestoreFieldContract` 只要求这 7 个，缺失即失败（文案不变）。
- **可选集** = 新 3 字段：恢复方向缺失不拦路；「来源类型」缺失 → 整表按全 `personal` 处理。
- **类型不符对任何存在的契约字段都致命**（两个方向一致）——字段在但类型被改，数据不可靠，照旧引导飞书侧改回或换表重建。
- 备份方向不变：`ensureBackupFieldContract` 按 10 字段契约缺什么补建什么，第一次备份自动把旧表升级。

## 二、批次一：备份方向

### 2.1 数据源（`backup-service.ts` 输入扩展）

镜像快照从「个人条目列表」扩为三部分（都在迁移锁保护下读取）：

1. `personalRepository.list()` → 个人条目全量（含时间戳）；
2. `loadBuiltInPromptdexCatalog().templates` 过滤掉与个人条目同名者 → 内置条目全量（对齐合并图鉴的抑制语义，与 `createMergedPromptdexCatalogService.list()` 一致）；
3. 「已生成 → 最新图片结果」映射：复用 `promptdex/home.ts` 的分类逻辑（注入 `imageTaskRepository`），取每个 entryKey（`sourceType:name`）的 `representativeImage.imageResult`。**不要重写判定**——「已生成图鉴条目」的语义（completed 任务 + 快照匹配 + 图片仍存在）只此一处权威实现；如直接复用 `PromptdexHomeService.getHome()` 不便，抽出分类纯函数共享，不复制。

`entryToBackupFields` 签名扩展为接受 `{ sourceType, name, description, version, inputs, body, createdAt?, updatedAt?, displayImageId }`，内置条目时间戳写空串、`displayImageId` 未生成写空串。

### 2.2 镜像流程 v2（上传先行，单条 PUT 同落标识与附件）

原流程 1–5 步不变（锁 → 确保表 → 契约补建 → 快照 → 拉全量记录），`planMirror` 本体不改——「展示图标识」作为普通文本字段天然进 diff。新增与调整：

6. **计算展示图动作清单**（纯函数，可单测）：
   - creates 中标识非空的记录 → 需上传；
   - updates 中本地标识 ≠ 远端标识（`extractBaseTextValue`）且本地非空 → 需上传；
   - updates 中本地标识为空且远端非空 → 需清空；
   - 标识相同的记录 → **不触碰附件字段**（使用者手改附件不察觉不修复，共识第 4 条）。
7. **串行上传**：逐张 `createUploadFile` → `uploadMedia` → 记下 `file_token`；图片文件缺失、空文件、超限或上传失败 → 整次备份 failed（沿用中止语义）。
8. **暂存新建记录**：
   - 所有 create 的 batch 请求都剔除「展示图标识」和「展示图」；无展示图记录因此自然保持空值，有展示图记录先落为无标识、无附件的恢复点；逻辑镜像计划仍保留本地目标标识；
   - 根据 `batch_create` 返回记录的「名称」（合并图鉴内唯一）建立本地条目到远端 `record_id` 的映射，不依赖返回数组顺序；返回缺项、重名或无法映射均按无效响应失败。
9. **串行单条写附件**：按清单逐条调用 `updateRecord`：
   - 新建/换图：`fields` 包含该记录的全部目标契约文本字段（含本地目标「展示图标识」）与 `展示图: [{ file_token }]`；
   - 删图：`fields` 包含该记录的全部目标契约文本字段（含空的「展示图标识」）与 `展示图: []`；
   - 标识未变：不调用单条附件写；若只有普通文本变化，剔除两个展示字段后留给 `batch_update`；若仅附件被使用者手改，完全跳过；
   - **附件与标识必须在上传成功后由同一个单条 `PUT` 写入**。不得先写标识，也不得把附件放入实测失败的 `batch_update`。
10. **完成其余镜像写入**：纯文本 updates 才执行 `batch_update`，随后执行 `batch_delete`；全部成功后 `markBackupSucceeded`。`BackupSummary` 的 created/updated 仍按逻辑镜像计划计数，不因暂存新建 + 单条补写而重复计数。

失败与重跑语义：

- 上传失败发生在任何镜像记录写入之前（契约补建不在此列），本次直接失败；
- 暂存新建成功而单条 `PUT` 失败时，远端记录的标识仍为空，下次备份会把它识别为 update 并重传，不会重复 create；
- 已有记录的单条 `PUT` 失败时，远端保留旧标识，下次备份仍会重传；
- 某条单条 `PUT` 已成功、但后续记录或删除失败时，该条标识已与附件一起落定，下次备份不会重复上传，只修复仍有文本或标识差异的记录；
- 单条 `PUT` 服务端已成功但客户端丢失响应/超时时，下次备份读到目标标识后同样跳过上传；
- 上传成功但对应单条 `PUT` 未成功时，`file_token` 成为未挂载的孤儿素材，无害，重跑会重新上传，首版不清理。

`BackupSummary` 增加 `uploadedImages` 计数，备份完成提示顺带展示。

### 2.3 fake 与 UI 配合

- `fake-base-api.ts` 扩展：附件字段类型、`uploadMedia`（内存 `file_token` 发放与素材元数据）、`updateRecord`（精确模拟单条 `PUT`）及附件读回形态（包含实测的 `file_token` / `name` / `size` / `tmp_url` / `type` / `url` 键）；单条与批量更新都改为真实的字段 merge 语义，batch 收到任一展示字段时测试保护应直接失败，并提供上传/单条写失败注入与调用计数。
- `app/table-backup/index.tsx`：备份说明文案更新（现在镜像合并图鉴并附展示图）；进行中状态无需进度条（沿用既有「进行中 + 可取消」）。

## 三、批次二：恢复方向

### 3.1 记录分类（`restore-service.ts`）

预检读取记录后，先按「来源类型」分流，再走既有校验：

| 来源类型字段/值 | 处理 |
| --- | --- |
| 字段不存在（旧契约表） | 整表按 `personal` 处理，行为与 v0.11.0 完全一致 |
| 值 = `personal` | 照旧进入新增/覆盖/非法三清单 |
| 值 = `built-in` | 不参与写入；计入「内置记录」独立类别，预检明示数量（绝不静默跳过） |
| 空串或其他值 | 走既有非法记录通道：明示原因（「来源类型无法识别」），可排除后继续 |

「展示图标识」「展示图」的**记录值**在恢复方向不读、不校验（消费必需性）；但字段存在时，其字段类型仍按 1.3 节参与契约类型校验。确认写入口 `replaceFromRestore` 不变——内置记录在预检层就被挡下，不进入写入集合。

### 3.2 预检 UI（`app/table-backup/restore.tsx`）

三清单 → 四类别：新增 / 覆盖 / 非法（可排除）/ **内置记录（仅计数说明，不可选、不参与写入）**。确认按钮的启用条件不变（非法未排除时禁用）。

## 四、测试与验证

| 层 | 内容 |
| --- | --- |
| 单元 | `base-api-client`：上传固定 `bitable_file`、真实 size/20 MB 边界、multipart 不手设 Content-Type、120s 超时/取消/错误归一、单条 `PUT` 路径与 `data.record` 响应；图片结果文件存储：上传描述、缺失/空文件/超限；`field-contract`：10 字段契约、恢复必需集/可选集分级、类型不符仍致命、`entryToBackupFields` 内置条目空时间戳与标识列往返；`planMirror`：标识变化触发 update、附件字段不参与 diff；展示图动作清单：新建/换图/删图清空/未变不触碰四象限 |
| 集成 | fake-base-api + memory 仓储：带图新记录先以不含两个展示字段的 batch create 暂存、再单条 `PUT` 同落标识与附件；生成新图后再备份只传一张；上传失败不写记录；暂存 create 后单条写失败，重跑按 update 补齐且不重复 create；部分单条写成功后重跑不重复上传；删图走单条 `PUT` 同时清标识与附件；任何 batch create/update 都不含「展示图标识」或「展示图」；旧契约表（7 字段）恢复按全 personal、首次备份自动补建 3 字段；恢复预检四类别与内置记录不写入 |
| 实机 | 已完成硬门槛 spike；实现后验证全新备份 → 飞书看到内置+个人记录与展示图；删除最新图/重新生成 → 再备份附件清空/更新；模拟单条写失败后重跑；飞书侧手改「来源类型」「展示图标识」→ 预检/再备份的拦截与修平表现；v0.11.0 旧表升级路径 |

测试失败时只修生产代码，不动测试（全局协作规范）。本次无 SQLite 迁移，不需要 node:sqlite 迁移测试。

## 五、任务分解

**批次〇**
1. **已完成（2026-07-17）**：spike 全链路全绿，兼容边界与 ADR 0214 已追记；实测常量在任务 2 写入生产代码

**批次一**
2. `base-api-client`：实测常量 + `uploadMedia`（真实 size/20 MB、独立超时、AbortSignal）+ bitable v1 `updateRecord` 单条 `PUT`；`ImageResultFileStorage` 增加上传描述；同步让 fake 满足新接口（含单测）
3. `field-contract`：契约 v2 + 校验分级 + 映射扩展（含单测）
4. 抽取并复用 home 分类逻辑，接通合并图鉴与代表图数据源（含单测）
5. 展示图动作清单纯函数 + `backup-service` 流程 v2，同时补齐 fake 的真实 merge/附件读回/失败注入（含集成测试；覆盖先上传、带图 create 无展示字段暂存、单条 `PUT` 同落标识附件、batch 剔除两个展示字段与失败重跑）
6. 备份页文案 + 摘要展示上传张数
7. 实机验证：全新备份 / 标识与附件同 PUT / 换图更新 / 空标识与 `[]` 同 PUT 清图 / 单条写失败重跑 / 纯文本 batch 不触碰附件 / 旧表升级

**批次二**
8. `restore-service` 来源分流 + 预检四类别（含单测/集成测试）
9. 预检 UI 第四类别
10. 实机验证：恢复旧表（缺新字段）/ 新表含内置记录 / 飞书侧破坏性编辑

每个任务完成标准：对应测试绿 + `npm run lint`/`tsc` 干净。批次一结束：真机「备份 → 飞书里每个已生成条目带图、未生成留空」；批次二结束：真机「旧表与新表都能恢复，内置记录明示不写入」。

## 六、风险与备注

| 风险 | 处置 |
| --- | --- |
| 个人授权码附件兼容面窄 | spike 已确认只采用 `bitable_file` 上传 + bitable v1 单条 `PUT`；明确禁用已失败的 batch 附件写与 base-api 域 Base v3 路径，防止按标准 OpenAPI/CLI 误改 |
| 单条 `PUT` 增加请求次数 | 只对展示图标识变化或清空的记录串行调用；个人图鉴量级小，标识未变时不触碰附件 |
| `展示图: []` 清空尚未在硬门槛 spike 覆盖 | 保留为实现后实机验证项；发布前必须跑通“删除最新图 → 再备份附件清空” |
| 图片缺失、空文件或超过素材上传 20 MB 上限 | 上传前由文件存储解析并校验真实 size；明确失败，不压缩、不转码、不做分片上传 |
| 大图上传慢、流量大 | 手动触发 + 正常稳态仅在标识变化时上传一次 + 120s 独立超时；写入失败重跑可能重传，不做压缩与 Wi-Fi 检测（共识第 7 条） |
| 上传成功但写入失败产生孤儿素材 | 无害，重跑重传；文档化，不做清理 |
| 内置条目随版本增删引起记录抖动 | 镜像语义的自然结果（ADR 0214 已记录后果），不做特殊处理 |
| 使用者手改附件/标识 | 标识改动会被下次备份 diff 修平；仅改附件不察觉不修复（词条「展示图」已定义） |
| 多设备写同一备份数据表 | 不协调，last-write-wins，沿用原方案结论 |
