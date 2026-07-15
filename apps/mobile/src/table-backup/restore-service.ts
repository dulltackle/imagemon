// 表格恢复的读取与预检报告生成（方案 3.1 步骤 1-4）。
//
// 预检只读、不写库：把备份数据表的记录逐条映射为模板草稿并校验，分类为新增/覆盖/非法。
// 同名多条记录全部列入非法（名称即身份，重复无法裁决）。写入在使用者确认后单独进行。
import type { PromptdexTemplate } from "@imagemon/core";
import {
  BaseApiError,
  type BaseApiClient,
  type BaseRecord,
} from "./base-api-client";
import type { TableBackupConnectionRepository } from "./connection-repository";
import {
  assertRestoreFieldContract,
  readRecordName,
  recordFieldsToTemplate,
} from "./field-contract";
import type { MigrationLockStore } from "./migration-lock";

export const DEFAULT_RESTORE_RECORD_PAGE_SIZE = 500;

export type RestoreRecordKind = "addition" | "overwrite";

export interface RestoreValidRecord {
  name: string;
  template: PromptdexTemplate;
  createdAt: string;
  updatedAt: string;
  kind: RestoreRecordKind;
}

export interface RestoreInvalidRecord {
  name: string;
  reason: string;
}

export interface RestorePreflight {
  /** 表格有、本机无。 */
  additions: RestoreValidRecord[];
  /** 同名条目，将被覆盖。 */
  overwrites: RestoreValidRecord[];
  /** 校验失败或同名多条，附具体原因。 */
  invalid: RestoreInvalidRecord[];
}

export type RunRestorePreflightResult =
  | { status: "ready"; preflight: RestorePreflight }
  | { status: "not_configured" }
  | { status: "blocked"; reason: "migration" | "model_call" }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

type MigrationLock = Pick<
  MigrationLockStore,
  "beginMigrationOperation" | "endMigrationOperation"
>;

export interface RunRestorePreflightOptions {
  connection: TableBackupConnectionRepository;
  /** 本机已有的个人图鉴条目名集合，用于区分新增/覆盖。 */
  existingNames: () => Promise<Set<string>>;
  createClient: (appToken: string, token: string) => BaseApiClient;
  migrationLock: MigrationLock;
  signal?: AbortSignal;
  recordPageSize?: number;
}

const DUPLICATE_NAME_REASON = "表格中存在同名多条记录，名称即身份，无法裁决。";

/** 记录分类（纯函数，可单测）。 */
export function classifyRestoreRecords(
  records: BaseRecord[],
  existingNames: Set<string>,
): RestorePreflight {
  const nameCounts = new Map<string, number>();
  for (const record of records) {
    const name = readRecordName(record.fields);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  const additions: RestoreValidRecord[] = [];
  const overwrites: RestoreValidRecord[] = [];
  const invalid: RestoreInvalidRecord[] = [];

  for (const record of records) {
    const rawName = readRecordName(record.fields);
    if ((nameCounts.get(rawName) ?? 0) > 1) {
      invalid.push({ name: rawName, reason: DUPLICATE_NAME_REASON });
      continue;
    }

    let candidate;
    try {
      candidate = recordFieldsToTemplate(record.fields);
    } catch (error) {
      invalid.push({ name: rawName, reason: errorMessage(error) });
      continue;
    }

    const valid: RestoreValidRecord = {
      name: candidate.template.name,
      template: candidate.template,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      kind: existingNames.has(candidate.template.name) ? "overwrite" : "addition",
    };
    if (valid.kind === "overwrite") {
      overwrites.push(valid);
    } else {
      additions.push(valid);
    }
  }

  return { additions, overwrites, invalid };
}

export async function runRestorePreflight(
  options: RunRestorePreflightOptions,
): Promise<RunRestorePreflightResult> {
  const pageSize = options.recordPageSize ?? DEFAULT_RESTORE_RECORD_PAGE_SIZE;
  const signal = options.signal;

  const connection = await options.connection.get();
  const token = await options.connection.getToken();
  if (!connection || !token || !connection.backupTableId) {
    return { status: "not_configured" };
  }

  const begin = options.migrationLock.beginMigrationOperation("table_restore");
  if (begin.status === "blocked") {
    return { status: "blocked", reason: begin.reason };
  }
  const operationId = begin.operation.id;

  try {
    const client = options.createClient(connection.appToken, token);
    const tableId = connection.backupTableId;

    // 恢复是读方向：契约不满足直接失败，不补建。
    await assertRestoreFieldContract(client, tableId, { signal });

    const records = await fetchAllRecords(client, tableId, pageSize, signal);
    const existingNames = await options.existingNames();
    const preflight = classifyRestoreRecords(records, existingNames);
    return { status: "ready", preflight };
  } catch (error) {
    if (isCancellation(error, signal)) {
      return { status: "cancelled" };
    }
    return { status: "failed", message: errorMessage(error) };
  } finally {
    options.migrationLock.endMigrationOperation(operationId);
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
    if (signal?.aborted) {
      throw new BaseApiError("cancelled", null, "操作已取消。");
    }
    const page = await client.listRecords(tableId, { pageSize, pageToken }, { signal });
    records.push(...page.items);
    pageToken = page.pageToken ?? undefined;
  } while (pageToken);
  return records;
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
