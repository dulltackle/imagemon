// 镜像引擎（展示图方案 2.2）：把本机合并图鉴镜像到备份数据表。
//
// 语义为幂等镜像（last-write-wins）：本机有表格无→create，两边都有且任一契约字段值
// 不同→update，表格有本机无→delete；同名多条记录保留第一条参与 diff、其余删除。
// 任一步失败即中止，半写状态靠下次镜像幂等修平——不删表，只做记录级增删改。
import type { PromptdexTemplate, PromptdexTemplateSource } from "@imagemon/core";

import type { ImageResultFileStorage } from "../image-tasks/file-storage";
import type { ImageTaskRepository } from "../image-tasks/repository";
import {
  classifyPromptdexEntryImages,
  getPromptdexHomeEntryKey,
} from "../promptdex/home";
import {
  loadBuiltInPromptdexCatalog,
  type PromptdexCatalogEntrySourceType,
} from "../promptdex";
import type { PersonalPromptdexEntryRepository } from "../promptdex/personal-entry-repository";
import { createUtcTimestamp } from "../storage";
import {
  BaseApiError,
  type BaseApiClient,
  type BaseRecord,
  type RecordFieldsWrite,
  type RecordUpdateWrite,
} from "./base-api-client";
import type {
  MigrationLockStore,
} from "./migration-lock";
import type { BackupSummary } from "./backup-session";
import {
  DISPLAY_IMAGE_FIELD_NAME,
  DISPLAY_IMAGE_ID_FIELD_NAME,
  entryToBackupFields,
  extractBaseTextValue,
  readRecordName,
} from "./field-contract";
import type { TableBackupConnectionRepository } from "./connection-repository";
import {
  adoptExistingTable,
  createIndependentManagedTable,
  resolveTableForBackup,
  type TableCandidate,
  type TableResolution,
} from "./table-resolver";

export const DEFAULT_BACKUP_BATCH_SIZE = 500;
export const DEFAULT_BACKUP_RECORD_PAGE_SIZE = 500;

export type RunBackupResult =
  | { status: "not_configured" }
  | { status: "blocked"; reason: "migration" | "model_call" }
  | {
      status: "needs_table_choice";
      appToken: string;
      candidates: TableCandidate[];
    }
  | { status: "cancelled" }
  | { status: "failed"; message: string }
  | { status: "succeeded"; summary: BackupSummary; succeededAt: string };

export type BackupTargetAction =
  | {
      kind: "adopt_existing";
      expectedAppToken: string;
      tableId: string;
    }
  | { kind: "create_independent"; expectedAppToken: string };

type MigrationLock = Pick<
  MigrationLockStore,
  "beginMigrationOperation" | "endMigrationOperation"
>;

export interface RunBackupOptions {
  connection: TableBackupConnectionRepository;
  entries: Pick<PersonalPromptdexEntryRepository, "list">;
  imageTasks: Pick<ImageTaskRepository, "listHistories" | "listImageResults">;
  imageFileStorage: Pick<ImageResultFileStorage, "createUploadFile">;
  createClient: (appToken: string, token: string) => BaseApiClient;
  migrationLock: MigrationLock;
  /** 测试与定制目录注入；生产默认使用内置图鉴源。 */
  builtInSources?: readonly PromptdexTemplateSource[];
  signal?: AbortSignal;
  now?: () => string;
  batchSize?: number;
  recordPageSize?: number;
  /** 候选确认后的写入动作；必须在与镜像相同的迁移锁内执行。 */
  targetAction?: BackupTargetAction;
}

const HALF_WRITE_HINT = "表格可能处于中间状态，重新备份即可修复。";

export async function runBackup(options: RunBackupOptions): Promise<RunBackupResult> {
  const now = options.now ?? createUtcTimestamp;
  const batchSize = options.batchSize ?? DEFAULT_BACKUP_BATCH_SIZE;
  const pageSize = options.recordPageSize ?? DEFAULT_BACKUP_RECORD_PAGE_SIZE;
  const signal = options.signal;

  const connection = await options.connection.get();
  const token = await options.connection.getToken();
  if (!connection || !token) {
    return { status: "not_configured" };
  }

  const begin = options.migrationLock.beginMigrationOperation("table_backup");
  if (begin.status === "blocked") {
    return { status: "blocked", reason: begin.reason };
  }
  const operationId = begin.operation.id;

  try {
    const client = options.createClient(connection.appToken, token);
    if (
      options.targetAction &&
      options.targetAction.expectedAppToken !== connection.appToken
    ) {
      return {
        status: "failed",
        message: "飞书连接已切换，请重新选择备份数据表。",
      };
    }
    const resolverOptions = {
      client,
      connection: options.connection,
      expectedAppToken: connection.appToken,
      signal,
    };
    const resolution = options.targetAction
      ? options.targetAction.kind === "adopt_existing"
        ? await adoptExistingTable(resolverOptions, options.targetAction.tableId)
        : await createIndependentManagedTable(resolverOptions)
      : await resolveTableForBackup(resolverOptions);
    const resolved = mapTableResolution(resolution, connection.appToken, signal);
    if (resolved.status !== "ready") {
      return resolved.result;
    }
    const tableId = resolved.tableId;

    const [entries, taskHistories, imageResults] = await Promise.all([
      options.entries.list(),
      options.imageTasks.listHistories(),
      options.imageTasks.listImageResults(),
    ]);
    const catalogEntries = buildMergedBackupCatalogEntries(
      entries,
      options.builtInSources,
    );
    const classified = classifyPromptdexEntryImages({
      entries: catalogEntries,
      taskHistories,
      imageResults,
    });
    const representativeImageByEntryKey = new Map(
      classified.generatedEntries.map(({ entry, representativeImage }) => [
        getPromptdexHomeEntryKey(entry),
        representativeImage.imageResult,
      ]),
    );
    const backupEntries = catalogEntries.map((entry) => ({
      ...entry,
      displayImageId:
        representativeImageByEntryKey.get(getPromptdexHomeEntryKey(entry))?.id ?? "",
    }));
    const imageResultById = new Map(imageResults.map((result) => [result.id, result]));
    const records = await fetchAllRecords(client, tableId, pageSize, signal);

    const plan = planMirror(backupEntries.map(entryToBackupFields), records);
    const displayImageActions = planDisplayImageActions(
      plan.creates,
      plan.updates,
      records,
    );

    // 所有上传都先完成，避免上传失败时留下记录级半写状态。
    const uploadedTokenByName = new Map<string, string>();
    for (const action of displayImageActions) {
      if (action.kind !== "upload") {
        continue;
      }
      throwIfAborted(signal);
      const imageResult = imageResultById.get(action.displayImageId);
      if (!imageResult) {
        throw new BaseApiError(
          "invalid_response",
          null,
          `展示图「${action.displayImageId}」缺少本机图片结果。`,
        );
      }
      const uploadFile = await options.imageFileStorage.createUploadFile(
        imageResult.filePath,
        imageResult.format,
      );
      throwIfAborted(signal);
      const fileToken = await client.uploadMedia(uploadFile, { signal });
      uploadedTokenByName.set(action.name, fileToken);
    }

    const stagedCreates = plan.creates.map(({ fields }) => ({
      fields: withoutDisplayImageFields(fields),
    }));
    const createdRecords = await executeInChunksCollect(
      stagedCreates,
      batchSize,
      signal,
      (chunk) =>
      client.batchCreateRecords(tableId, chunk, { signal }),
    );
    const createdRecordIdByName = mapCreatedRecordIds(plan.creates, createdRecords);

    const displayActionRecordIds = new Set<string>();
    for (const action of displayImageActions) {
      throwIfAborted(signal);
      const recordId = action.recordId ?? createdRecordIdByName.get(action.name);
      if (!recordId) {
        throw new BaseApiError(
          "invalid_response",
          null,
          `新建记录响应缺少「${action.name}」的 record_id。`,
        );
      }
      if (action.recordId) {
        displayActionRecordIds.add(action.recordId);
      }
      const attachmentValue =
        action.kind === "upload"
          ? [{ file_token: requireUploadedToken(uploadedTokenByName, action.name) }]
          : [];
      await client.updateRecord(
        tableId,
        recordId,
        {
          ...action.targetFields,
          [DISPLAY_IMAGE_FIELD_NAME]: attachmentValue,
        },
        { signal },
      );
    }

    const textUpdates = plan.updates
      .filter(({ record_id }) => !displayActionRecordIds.has(record_id))
      .map(({ record_id, fields }) => ({
        record_id,
        fields: withoutDisplayImageFields(fields),
      }));
    await executeInChunks(textUpdates, batchSize, signal, (chunk) =>
      client.batchUpdateRecords(tableId, chunk, { signal }),
    );
    await executeInChunks(plan.deletes, batchSize, signal, (chunk) =>
      client.batchDeleteRecords(tableId, chunk, { signal }),
    );

    throwIfAborted(signal);
    const succeededAt = now();
    await options.connection.markBackupSucceeded({
      expectedAppToken: connection.appToken,
      expectedTableId: tableId,
      succeededAt,
    });
    return {
      status: "succeeded",
      summary: {
        ...plan.summary,
        uploadedImages: uploadedTokenByName.size,
      },
      succeededAt,
    };
  } catch (error) {
    if (isCancellation(error, signal)) {
      return { status: "cancelled" };
    }
    return { status: "failed", message: `${errorMessage(error)}（${HALF_WRITE_HINT}）` };
  } finally {
    options.migrationLock.endMigrationOperation(operationId);
  }
}

export interface BackupCatalogEntry extends PromptdexTemplate {
  sourceType: PromptdexCatalogEntrySourceType;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 生成与图鉴页一致的合并图鉴：个人条目优先，同名时抑制内置条目。
 * 保留完整模板字段，供备份记录序列化使用。
 */
export function buildMergedBackupCatalogEntries(
  personalEntries: Awaited<ReturnType<PersonalPromptdexEntryRepository["list"]>>,
  builtInSources?: readonly PromptdexTemplateSource[],
): BackupCatalogEntry[] {
  const personalNames = new Set(personalEntries.map(({ name }) => name));
  const builtInEntries = loadBuiltInPromptdexCatalog(builtInSources).templates
    .filter(({ name }) => !personalNames.has(name))
    .sort(compareTemplateNameAscending)
    .map((template): BackupCatalogEntry => ({
      ...template,
      sourceType: "built-in",
    }));

  return [
    ...personalEntries
      .slice()
      .sort(compareTemplateNameAscending)
      .map((entry): BackupCatalogEntry => ({ ...entry })),
    ...builtInEntries,
  ];
}

function compareTemplateNameAscending(
  left: Pick<PromptdexTemplate, "name">,
  right: Pick<PromptdexTemplate, "name">,
): number {
  return left.name.localeCompare(right.name);
}

type MappedTableResolution =
  | { status: "ready"; tableId: string }
  | { status: "terminal"; result: RunBackupResult };

function mapTableResolution(
  resolution: TableResolution,
  appToken: string,
  signal: AbortSignal | undefined,
): MappedTableResolution {
  switch (resolution.status) {
    case "ready":
      return { status: "ready", tableId: resolution.tableId };
    case "needs_table_choice":
      return {
        status: "terminal",
        result: {
          status: "needs_table_choice",
          appToken,
          candidates: resolution.candidates,
        },
      };
    case "not_found":
      return {
        status: "terminal",
        result: {
          status: "failed",
          message: "飞书连接已变化，无法确认本次备份目标。",
        },
      };
    case "failed":
      return {
        status: "terminal",
        result: isCancellation(resolution.error.cause, signal)
          ? { status: "cancelled" }
          : { status: "failed", message: resolution.error.message },
      };
  }
}

async function fetchAllRecords(
  client: BaseApiClient,
  tableId: string,
  pageSize: number,
  signal: AbortSignal | undefined,
): Promise<BaseRecord[]> {
  const records: BaseRecord[] = [];
  let pageToken: string | undefined;
  do {
    throwIfAborted(signal);
    const page = await client.listRecords(tableId, { pageSize, pageToken }, { signal });
    records.push(...page.items);
    pageToken = page.pageToken ?? undefined;
  } while (pageToken);
  return records;
}

interface MirrorPlan {
  creates: RecordFieldsWrite[];
  updates: RecordUpdateWrite[];
  deletes: string[];
  summary: BackupSummary;
}

export type DisplayImageAction =
  | {
      kind: "upload";
      name: string;
      /** create 尚无 record_id，待 batch_create 响应按名称回填。 */
      recordId: string | null;
      displayImageId: string;
      targetFields: Record<string, unknown>;
    }
  | {
      kind: "clear";
      name: string;
      recordId: string;
      targetFields: Record<string, unknown>;
    };

/** 根据标识 diff 规划附件动作；附件字段本身从不参与镜像 diff。 */
export function planDisplayImageActions(
  creates: readonly RecordFieldsWrite[],
  updates: readonly RecordUpdateWrite[],
  records: readonly BaseRecord[],
): DisplayImageAction[] {
  const actions: DisplayImageAction[] = [];

  for (const { fields } of creates) {
    const displayImageId = extractBaseTextValue(fields[DISPLAY_IMAGE_ID_FIELD_NAME]);
    if (displayImageId === "") {
      continue;
    }
    actions.push({
      kind: "upload",
      name: readRecordName(fields),
      recordId: null,
      displayImageId,
      targetFields: fields,
    });
  }

  const remoteByRecordId = new Map(
    records.map((record) => [record.record_id, record]),
  );
  for (const { record_id, fields } of updates) {
    const remote = remoteByRecordId.get(record_id);
    if (!remote) {
      throw new BaseApiError(
        "invalid_response",
        null,
        `镜像计划引用了不存在的记录「${record_id}」。`,
      );
    }
    const localDisplayImageId = extractBaseTextValue(
      fields[DISPLAY_IMAGE_ID_FIELD_NAME],
    );
    const remoteDisplayImageId = extractBaseTextValue(
      remote.fields[DISPLAY_IMAGE_ID_FIELD_NAME],
    );
    if (localDisplayImageId === remoteDisplayImageId) {
      continue;
    }

    const name = readRecordName(fields);
    actions.push(
      localDisplayImageId === ""
        ? {
            kind: "clear",
            name,
            recordId: record_id,
            targetFields: fields,
          }
        : {
            kind: "upload",
            name,
            recordId: record_id,
            displayImageId: localDisplayImageId,
            targetFields: fields,
          },
    );
  }

  return actions;
}

/** 计算镜像 diff（纯函数，可单测）。 */
export function planMirror(
  localFieldsList: Record<string, string>[],
  records: BaseRecord[],
): MirrorPlan {
  const remoteByName = new Map<string, BaseRecord>();
  const deletes: string[] = [];
  for (const record of records) {
    const name = readRecordName(record.fields);
    if (remoteByName.has(name)) {
      // 同名多条：保留第一条参与 diff，其余按镜像语义删除。
      deletes.push(record.record_id);
    } else {
      remoteByName.set(name, record);
    }
  }

  const creates: RecordFieldsWrite[] = [];
  const updates: RecordUpdateWrite[] = [];
  const localNames = new Set<string>();
  let skipped = 0;
  for (const fields of localFieldsList) {
    const name = fields[NAME_FIELD];
    localNames.add(name);
    const remote = remoteByName.get(name);
    if (!remote) {
      creates.push({ fields });
    } else if (fieldsDiffer(fields, remote.fields)) {
      updates.push({ record_id: remote.record_id, fields });
    } else {
      skipped += 1;
    }
  }

  for (const [name, record] of remoteByName) {
    if (!localNames.has(name)) {
      deletes.push(record.record_id);
    }
  }

  return {
    creates,
    updates,
    deletes,
    summary: {
      created: creates.length,
      updated: updates.length,
      deleted: deletes.length,
      skipped,
      uploadedImages: 0,
    },
  };
}

const NAME_FIELD = "名称";

function fieldsDiffer(
  local: Record<string, string>,
  remote: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(local)) {
    if (extractBaseTextValue(remote[key]) !== value) {
      return true;
    }
  }
  return false;
}

function withoutDisplayImageFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...fields };
  delete result[DISPLAY_IMAGE_ID_FIELD_NAME];
  delete result[DISPLAY_IMAGE_FIELD_NAME];
  return result;
}

function mapCreatedRecordIds(
  requestedCreates: readonly RecordFieldsWrite[],
  createdRecords: readonly BaseRecord[],
): Map<string, string> {
  const expectedNames = new Set<string>();
  for (const { fields } of requestedCreates) {
    const name = readRecordName(fields);
    if (expectedNames.has(name)) {
      throw new BaseApiError(
        "invalid_response",
        null,
        `新建镜像计划包含重名条目「${name}」。`,
      );
    }
    expectedNames.add(name);
  }

  const recordIdByName = new Map<string, string>();
  const nameByRecordId = new Map<string, string>();
  for (const record of createdRecords) {
    const name = readRecordName(record.fields);
    if (!expectedNames.has(name)) {
      throw new BaseApiError(
        "invalid_response",
        null,
        `新建记录响应包含无法映射的条目「${name}」。`,
      );
    }
    if (recordIdByName.has(name)) {
      throw new BaseApiError(
        "invalid_response",
        null,
        `新建记录响应包含重名条目「${name}」。`,
      );
    }
    if (record.record_id === "") {
      throw new BaseApiError(
        "invalid_response",
        null,
        `新建记录响应缺少「${name}」的 record_id。`,
      );
    }
    const mappedName = nameByRecordId.get(record.record_id);
    if (mappedName !== undefined) {
      throw new BaseApiError(
        "invalid_response",
        null,
        `新建记录响应让「${mappedName}」与「${name}」共用了 record_id。`,
      );
    }
    recordIdByName.set(name, record.record_id);
    nameByRecordId.set(record.record_id, name);
  }

  const missingNames = [...expectedNames].filter(
    (name) => !recordIdByName.has(name),
  );
  if (missingNames.length > 0) {
    throw new BaseApiError(
      "invalid_response",
      null,
      `新建记录响应缺少条目：${missingNames.join("、")}。`,
    );
  }
  return recordIdByName;
}

function requireUploadedToken(
  tokenByName: ReadonlyMap<string, string>,
  name: string,
): string {
  const token = tokenByName.get(name);
  if (!token) {
    throw new BaseApiError(
      "invalid_response",
      null,
      `条目「${name}」缺少已上传的展示图素材。`,
    );
  }
  return token;
}

async function executeInChunks<T>(
  items: T[],
  size: number,
  signal: AbortSignal | undefined,
  run: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let index = 0; index < items.length; index += size) {
    throwIfAborted(signal);
    await run(items.slice(index, index + size));
  }
}

async function executeInChunksCollect<T, R>(
  items: T[],
  size: number,
  signal: AbortSignal | undefined,
  run: (chunk: T[]) => Promise<R[]>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    throwIfAborted(signal);
    results.push(...(await run(items.slice(index, index + size))));
  }
  return results;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new BaseApiError("cancelled", null, "操作已取消。");
  }
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  if (error instanceof BaseApiError && error.kind === "cancelled") {
    return true;
  }
  return signal?.aborted === true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
