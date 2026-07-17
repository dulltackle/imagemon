# 表格备份镜像合并图鉴并附展示图——实现方案（2026-07-16）

## 来源与依据

- **共识**：2026-07-16 grilling 会话逐题达成，词汇表见 `CONTEXT.md`（修订后的「表格备份」「表格恢复」、新增「展示图」）。
- **决策记录**：[ADR 0214](../adr/0214-backup-table-mirrors-merged-promptdex-with-display-image.md)（备份数据表镜像合并图鉴并附展示图）、[ADR 0215](../adr/0215-restore-contract-validation-by-consumption-necessity.md)（恢复契约校验按消费必需性分级）。
- **前置基础**：表格备份/恢复本体已随 v0.11.0 发布，模块在 `apps/mobile/src/table-backup/`，原方案见 [2026-07-14-feishu-table-backup.md](./2026-07-14-feishu-table-backup.md)。
- **未验证前提（硬门槛）**：个人授权码通道能否上传附件——批次〇 spike 不过则全案停止、回到 grilling 重议，不预设降级。

## 范围

| 批次 | 内容 |
| --- | --- |
| 批次〇 | spike：个人授权码上传附件全链路验证（**硬门槛**） |
| 批次一 | 契约扩展 + 备份方向（合并图鉴全量入表、展示图上传与标识 diff） |
| 批次二 | 恢复方向（消费必需性校验、来源过滤、预检第四类别） |

**非目标**（本方案明确不做）：图片压缩/转码（原图直传）；Wi-Fi 检测与流量预估提示；展示图回流本机（单向投放，恢复不读附件）；备份最新一张以外的图片结果；封面示例图与任务历史入表；断点续传；对使用者在飞书侧改动附件内容的察觉与修复（标识不变即不触碰）。

## 关键现状事实

- 字段契约现为 7 个文本字段（`field-contract.ts`），`sourceType` 恒为 personal 不入表——本方案推翻这两点。
- 镜像引擎 `backup-service.ts` 是无状态文本 diff（`planMirror` + `fieldsDiffer`），任一步失败即中止、幂等重跑修平——语义保持，流程中插入上传阶段。
- 合并图鉴数据源：`personalRepository.list()`（含时间戳）+ `loadBuiltInPromptdexCatalog().templates`（完整 `PromptdexTemplate`，**无时间戳**）；同名时个人条目抑制内置（`promptdex/index.ts:103`），合并图鉴内名称唯一——「名称」仍可作镜像匹配键。
- 「已生成图鉴条目 + 最新一张图片结果」的判定逻辑已存在：`promptdex/home.ts` 的分类（completed 任务 + 快照 sourceType:name 匹配）与 `compareImageResultDescending` 排序，`generatedEntries[].representativeImage` 即所需数据。
- 图片文件：`ImageResult.filePath`（相对路径）经 `ImageResultFileStorage.resolveFileUri` 解析为可上传 URI；`format` 字段区分 png/jpg；RN 的 FormData 支持 `{ uri, name, type }` 文件上传（现有 `ImageUploadFile` 形态可仿）。
- `base-api-client.ts` 只做 JSON 请求、统一 30s 超时——上传需新增 multipart 方法与独立超时。
- **本次不动 SQLite schema**：无迁移、无新增本机持久化状态（镜像保持无状态是共识第 4 条）。

## 〇、批次〇：spike（硬门槛）

验证目标：个人授权码（`pt-` token）在 base-api 域名走「上传素材拿 `file_token` → 写记录附件字段 → 飞书界面看到图」全链路。开发者 shell 拒绝 `curl`，全部命令由开发者用 `!` 前缀自跑。

1. **上传素材**（待核实端点在 base-api 域是否放行）：

   ```
   curl -X POST 'https://base-api.feishu.cn/open-apis/drive/v1/medias/upload_all' \
     -H 'Authorization: Bearer pt-…' \
     -F 'file_name=spike.png' \
     -F 'parent_type=bitable_image' \
     -F 'parent_node=<app_token>' \
     -F 'size=<字节数>' \
     -F 'file=@spike.png'
   ```

   期待 `code=0` 且 `data.file_token` 非空；`parent_type=bitable_image` 不放行则改试 `bitable_file`。
2. **建附件字段**：`POST /tables/:table_id/fields`，`{ "field_name": "展示图", "type": 17 }`。
3. **写附件字段**：`batch_update` 某记录 `{ "展示图": [{ "file_token": "…" }] }`，飞书界面确认图片可见。
4. **读回记录**：`GET records` 观察附件字段读回值形态（确认 `file_token` 键名与数组结构，供 fake 与实现对齐）。
5. **落定常量**：`parent_type` 取值、上传端点路径、附件写/读值形态，全部以 spike 实测为准写进 `base-api-client.ts` 注释与常量。
6. **结论追记**：spike 结果（全绿或失败）追记到 ADR 0214；失败即停止后续批次，回 grilling 重议（波及 ADR 0213/0214）。

## 一、外部契约变更

### 1.1 字段契约 v2（7 → 10 字段）

新增三个字段追加在契约尾部（建表顺序不影响既有表——旧表靠备份方向补建）：

| 字段名 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| （原 7 字段） | 文本 | 同原方案 1.2 | 不变；内置条目的「条目创建时间/条目更新时间」写空串（内置模板无时间戳） |
| 来源类型 | 文本（type 1） | `sourceType` | 值 `built-in` / `personal`，与 `PromptdexCatalogEntrySourceType` 字面量一致 |
| 展示图标识 | 文本（type 1） | 最新图片结果 id | 未生成条目为空串；驱动附件更新的 diff 键 |
| 展示图 | 附件（type 17） | 图片文件 | 值 `[{ file_token }]` 或空；**不参与文本 diff**，不进 `entryToBackupFields` |

新增常量 `BASE_FIELD_TYPE_ATTACHMENT = 17`（`base-api-client.ts`）。

### 1.2 上传端点（以 spike 实测为准）

`base-api-client.ts` 新增 `uploadMedia(input, options): Promise<string /* file_token */>`：

- multipart/form-data，字段 `file_name` / `parent_type` / `parent_node=app_token` / `size` / `file`（RN FormData `{ uri, name, type }`）；
- **独立超时常量**（预设 `120_000ms`，大图 + 移动网络，30s 统一超时不适用），支持 `AbortSignal`；
- 错误归一沿用 `BaseApiError`，凭据不入错误说明。

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

### 2.2 镜像流程 v2（上传先行，标识殿后）

原流程 1–5 步不变（锁 → 确保表 → 契约补建 → 快照 → 拉全量记录），`planMirror` 本体不改——「展示图标识」作为普通文本字段天然进 diff。新增与调整：

6. **计算上传清单**（纯函数，可单测）：
   - creates 中标识非空的记录 → 需上传；
   - updates 中本地标识 ≠ 远端标识（`extractBaseTextValue`）且本地非空 → 需上传；
   - updates 中本地标识为空且远端非空 → 需清空（写入合入 `展示图: []`）；
   - 标识相同的记录 → **不触碰附件字段**（使用者手改附件不察觉不修复，共识第 4 条）。
7. **串行上传**：逐张 `resolveFileUri` → `uploadMedia` → 记下 `file_token`；图片文件缺失或上传失败 → 整次备份 failed（沿用中止语义）。
8. **批量写入**：把 `展示图: [{ file_token }]`（或 `[]`）合入对应记录的 create/update fields 后，按原顺序 batch_create → batch_update → batch_delete。**「展示图标识」与附件同批写入、且必在上传成功之后**——这是共识第 5 条的实现约束：标识先落而图未上，diff 会认为无需重传，形成永久缺图。
9. 成功 → `markBackupSucceeded`；失败/取消语义不变，幂等重跑只补标识仍有差异的部分（已成功记录不重传）。
10. 上传成功但后续写入失败 → `file_token` 成为未挂载的孤儿素材，无害，重跑重传，文档化即可。

`BackupSummary` 增加 `uploadedImages` 计数，备份完成提示顺带展示。

### 2.3 fake 与 UI 配合

- `fake-base-api.ts` 扩展：附件字段类型、`uploadMedia`（内存 file_token 发放）、附件值读回形态（按 spike 实测对齐）。
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

「展示图标识」「展示图」恢复方向不读、不校验（消费必需性）。确认写入口 `replaceFromRestore` 不变——内置记录在预检层就被挡下，不进入写入集合。

### 3.2 预检 UI（`app/table-backup/restore.tsx`）

三清单 → 四类别：新增 / 覆盖 / 非法（可排除）/ **内置记录（仅计数说明，不可选、不参与写入）**。确认按钮的启用条件不变（非法未排除时禁用）。

## 四、测试与验证

| 层 | 内容 |
| --- | --- |
| 单元 | `field-contract`：10 字段契约、恢复必需集/可选集分级、类型不符仍致命、`entryToBackupFields` 内置条目空时间戳与标识列往返；`planMirror`：标识变化触发 update、附件字段不参与 diff；上传清单计算：新建/换图/删图清空/未变不触碰四象限 |
| 集成 | fake-base-api + memory 仓储：备份 → 生成新图 → 再备份只传一张；上传失败中止后重跑补齐（标识未落）；旧契约表（7 字段）恢复按全 personal、首次备份自动补建 3 字段；恢复预检四类别与内置记录不写入 |
| 实机 | spike 表全链路：备份 → 飞书看到内置+个人记录与展示图；删除最新图/重新生成 → 再备份附件更新；飞书侧手改「来源类型」「展示图标识」→ 预检/再备份的拦截与修平表现；v0.11.0 旧表升级路径 |

测试失败时只修生产代码，不动测试（全局协作规范）。本次无 SQLite 迁移，不需要 node:sqlite 迁移测试。

## 五、任务分解

**批次〇**
1. spike 全链路（开发者 `!` 自跑）→ 常量落定 + ADR 0214 追记；不过则停止

**批次一**
2. `base-api-client`：`BASE_FIELD_TYPE_ATTACHMENT` + `uploadMedia`（独立超时、AbortSignal，含单测）
3. `field-contract`：契约 v2 + 校验分级 + 映射扩展（含单测）
4. 上传清单计算纯函数 + `backup-service` 流程 v2（含集成测试；先传图后写标识的顺序有专门断言）
5. `fake-base-api` 扩展 + 已生成条目数据源接线（复用 home 分类）
6. 备份页文案 + 摘要展示上传张数
7. 实机验证：全新备份 / 换图更新 / 失败重跑 / 旧表升级

**批次二**
8. `restore-service` 来源分流 + 预检四类别（含单测/集成测试）
9. 预检 UI 第四类别
10. 实机验证：恢复旧表（缺新字段）/ 新表含内置记录 / 飞书侧破坏性编辑

每个任务完成标准：对应测试绿 + `npm run lint`/`tsc` 干净。批次一结束：真机「备份 → 飞书里每个已生成条目带图、未生成留空」；批次二结束：真机「旧表与新表都能恢复，内置记录明示不写入」。

## 六、风险与备注

| 风险 | 处置 |
| --- | --- |
| 上传端点对个人授权码不放行 | 批次〇硬门槛拦截；失败回 grilling 重议，不预设降级（共识第 8 条） |
| `parent_type` 取值 / 附件读回形态记忆值不准 | 一律以 spike 实测为准落常量，不信文档记忆 |
| 大图上传慢、流量大 | 手动触发 + 每图一生只传一次（标识 diff）+ 120s 独立超时；不做压缩与 Wi-Fi 检测（共识第 7 条） |
| 上传成功但写入失败产生孤儿素材 | 无害，重跑重传；文档化，不做清理 |
| 内置条目随版本增删引起记录抖动 | 镜像语义的自然结果（ADR 0214 已记录后果），不做特殊处理 |
| 使用者手改附件/标识 | 标识改动会被下次备份 diff 修平；仅改附件不察觉不修复（词条「展示图」已定义） |
| 多设备写同一备份数据表 | 不协调，last-write-wins，沿用原方案结论 |
