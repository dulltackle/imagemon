// 镜像引擎（方案 2.3）：把本机个人图鉴条目镜像到备份数据表。
//
// 语义为幂等镜像（last-write-wins）：本机有表格无→create，两边都有且任一契约字段值
// 不同→update，表格有本机无→delete；同名多条记录保留第一条参与 diff、其余删除。
// 任一步失败即中止，半写状态靠下次镜像幂等修平——不删表，只做记录级增删改。
import { createUtcTimestamp } from "../storage";
import type { PersonalPromptdexEntryRepository } from "../promptdex/personal-entry-repository";
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
  BACKUP_TABLE_NAME,
  buildBackupTableFields,
  ensureBackupFieldContract,
  entryToBackupFields,
  extractBaseTextValue,
  readRecordName,
} from "./field-contract";
import type { TableBackupConnectionRepository } from "./connection-repository";

export const DEFAULT_BACKUP_BATCH_SIZE = 500;
export const DEFAULT_BACKUP_RECORD_PAGE_SIZE = 500;

export type RunBackupResult =
  | { status: "not_configured" }
  | { status: "blocked"; reason: "migration" | "model_call" }
  | { status: "cancelled" }
  | { status: "failed"; message: string }
  | { status: "succeeded"; summary: BackupSummary; succeededAt: string };

type MigrationLock = Pick<
  MigrationLockStore,
  "beginMigrationOperation" | "endMigrationOperation"
>;

export interface RunBackupOptions {
  connection: TableBackupConnectionRepository;
  entries: Pick<PersonalPromptdexEntryRepository, "list">;
  createClient: (appToken: string, token: string) => BaseApiClient;
  migrationLock: MigrationLock;
  signal?: AbortSignal;
  now?: () => string;
  batchSize?: number;
  recordPageSize?: number;
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

    const tableId = await ensureBackupTable(client, options.connection, connection.backupTableId, signal);

    const entries = await options.entries.list();
    const records = await fetchAllRecords(client, tableId, pageSize, signal);

    const plan = planMirror(entries.map(entryToBackupFields), records);

    await executeInChunks(plan.creates, batchSize, signal, (chunk) =>
      client.batchCreateRecords(tableId, chunk, { signal }),
    );
    await executeInChunks(plan.updates, batchSize, signal, (chunk) =>
      client.batchUpdateRecords(tableId, chunk, { signal }),
    );
    await executeInChunks(plan.deletes, batchSize, signal, (chunk) =>
      client.batchDeleteRecords(tableId, chunk, { signal }),
    );

    const succeededAt = now();
    await options.connection.markBackupSucceeded(succeededAt);
    return { status: "succeeded", summary: plan.summary, succeededAt };
  } catch (error) {
    if (isCancellation(error, signal)) {
      return { status: "cancelled" };
    }
    return { status: "failed", message: `${errorMessage(error)}（${HALF_WRITE_HINT}）` };
  } finally {
    options.migrationLock.endMigrationOperation(operationId);
  }
}

async function ensureBackupTable(
  client: BaseApiClient,
  connection: TableBackupConnectionRepository,
  existingTableId: string | null,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (existingTableId) {
    try {
      await ensureBackupFieldContract(client, existingTableId, { signal });
      return existingTableId;
    } catch (error) {
      // 表被删了：重建；契约类型不符等其它错误照常抛出。
      if (!(error instanceof BaseApiError && error.kind === "not_found")) {
        throw error;
      }
    }
  }

  const tableId = await client.createTable(
    { name: BACKUP_TABLE_NAME, fields: buildBackupTableFields() },
    { signal },
  );
  await connection.setBackupTableId(tableId);
  return tableId;
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
