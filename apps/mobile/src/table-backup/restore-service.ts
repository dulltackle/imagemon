// 表格恢复的读取与预检报告生成（方案 3.1 步骤 1-4）。
//
// 预检只读、不写库：先按来源类型分流，再把 personal 记录映射为模板草稿并校验，
// 分类为新增/覆盖/非法/内置记录。同名 personal 记录全部列入非法（名称即身份，
// 重复无法裁决）；built-in 记录只明示计数，不进入写入集合。
import type { PromptdexTemplate } from "@imagemon/core";
import type { PersonalPromptdexEntryRepository } from "../promptdex/personal-entry-repository";
import {
  BaseApiError,
  type BaseApiClient,
  type BaseRecord,
} from "./base-api-client";
import { collectAllBasePages } from "./base-pagination";
import type { TableBackupConnectionRepository } from "./connection-repository";
import {
  inspectRestoreFieldContract,
  readRecordName,
  readRecordSourceType,
  recordFieldsToTemplate,
} from "./field-contract";
import type { MigrationLockStore } from "./migration-lock";
import {
  resolveTableForRestore,
  type RestoreTableSelection,
  type TableCandidate,
} from "./table-resolver";

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

export interface RestoreBuiltInRecord {
  name: string;
}

export interface RestorePreflight {
  /** 表格有、本机无。 */
  additions: RestoreValidRecord[];
  /** 同名条目，将被覆盖。 */
  overwrites: RestoreValidRecord[];
  /** 校验失败或同名多条，附具体原因。 */
  invalid: RestoreInvalidRecord[];
  /** 内置图鉴记录：预检明示，但绝不写入个人图鉴。 */
  builtInRecords: RestoreBuiltInRecord[];
}

export type RunRestorePreflightResult =
  | { status: "ready"; tableId: string; preflight: RestorePreflight }
  | {
      status: "needs_table_choice";
      appToken: string;
      candidates: TableCandidate[];
    }
  | { status: "not_found" }
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
  /** 本次预检明确选择的只读来源；不写入备份目标身份。 */
  selection?: RestoreTableSelection;
}

const DUPLICATE_NAME_REASON = "表格中存在同名多条记录，名称即身份，无法裁决。";
const UNRECOGNIZED_SOURCE_TYPE_REASON = "来源类型无法识别。";

export interface ClassifyRestoreRecordsOptions {
  /** false 表示 v0.11.0 旧契约表，此时整表按 personal 处理。 */
  sourceTypeFieldPresent?: boolean;
}

/** 记录分类（纯函数，可单测）。 */
export function classifyRestoreRecords(
  records: BaseRecord[],
  existingNames: Set<string>,
  options: ClassifyRestoreRecordsOptions = {},
): RestorePreflight {
  const sourceTypeFieldPresent = options.sourceTypeFieldPresent ?? true;
  const personalRecords: BaseRecord[] = [];
  const invalid: RestoreInvalidRecord[] = [];
  const builtInRecords: RestoreBuiltInRecord[] = [];

  for (const record of records) {
    const rawName = readRecordName(record.fields);
    if (!sourceTypeFieldPresent) {
      personalRecords.push(record);
      continue;
    }

    const sourceType = readRecordSourceType(record.fields);
    if (sourceType === "personal") {
      personalRecords.push(record);
    } else if (sourceType === "built-in") {
      builtInRecords.push({ name: rawName });
    } else {
      invalid.push({ name: rawName, reason: UNRECOGNIZED_SOURCE_TYPE_REASON });
    }
  }

  const nameCounts = new Map<string, number>();
  for (const record of personalRecords) {
    const name = readRecordName(record.fields);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  const additions: RestoreValidRecord[] = [];
  const overwrites: RestoreValidRecord[] = [];

  for (const record of personalRecords) {
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

  return { additions, overwrites, invalid, builtInRecords };
}

export async function runRestorePreflight(
  options: RunRestorePreflightOptions,
): Promise<RunRestorePreflightResult> {
  const pageSize = options.recordPageSize ?? DEFAULT_RESTORE_RECORD_PAGE_SIZE;
  const signal = options.signal;

  const connection = await options.connection.get();
  const token = await options.connection.getToken();
  if (!connection || !token) {
    return { status: "not_configured" };
  }

  const begin = options.migrationLock.beginMigrationOperation("table_restore");
  if (begin.status === "blocked") {
    return { status: "blocked", reason: begin.reason };
  }
  const operationId = begin.operation.id;

  try {
    const client = options.createClient(connection.appToken, token);
    const resolution = await resolveTableForRestore({
      client,
      connection: options.connection,
      expectedAppToken: connection.appToken,
      selection: options.selection,
      signal,
    });
    if (resolution.status === "needs_table_choice") {
      return {
        status: "needs_table_choice",
        appToken: connection.appToken,
        candidates: resolution.candidates,
      };
    }
    if (resolution.status === "not_found") {
      return { status: "not_found" };
    }
    if (resolution.status === "failed") {
      return isCancellation(resolution.error.cause, signal)
        ? { status: "cancelled" }
        : { status: "failed", message: resolution.error.message };
    }
    const tableId = resolution.tableId;

    // 恢复是读方向：契约不满足直接失败，不补建。
    const contract = await inspectRestoreFieldContract(client, tableId, { signal });

    const records = await fetchAllRecords(client, tableId, pageSize, signal);
    const existingNames = await options.existingNames();
    const preflight = classifyRestoreRecords(records, existingNames, {
      sourceTypeFieldPresent: contract.sourceTypeFieldPresent,
    });
    return { status: "ready", tableId, preflight };
  } catch (error) {
    if (isCancellation(error, signal)) {
      return { status: "cancelled" };
    }
    return { status: "failed", message: errorMessage(error) };
  } finally {
    options.migrationLock.endMigrationOperation(operationId);
  }
}

export type RunRestoreCommitResult =
  | { status: "succeeded"; restored: number }
  | { status: "blocked"; reason: "migration" | "model_call" }
  | { status: "failed"; message: string };

export interface RunRestoreCommitOptions {
  entries: Pick<PersonalPromptdexEntryRepository, "replaceFromRestore">;
  /** 预检产出的有效记录（新增 ∪ 覆盖）。 */
  records: RestoreValidRecord[];
  migrationLock: MigrationLock;
}

/**
 * 使用者确认后的写入（方案 3.1 步骤 5-6）：取迁移锁、单事务写入、确认后不可取消。
 * 事务失败自动回滚（由仓储保证）。
 */
export async function runRestoreCommit(
  options: RunRestoreCommitOptions,
): Promise<RunRestoreCommitResult> {
  const begin = options.migrationLock.beginMigrationOperation("table_restore");
  if (begin.status === "blocked") {
    return { status: "blocked", reason: begin.reason };
  }
  const operationId = begin.operation.id;
  try {
    await options.entries.replaceFromRestore(
      options.records.map((record) => ({
        template: record.template,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      })),
    );
    return { status: "succeeded", restored: options.records.length };
  } catch (error) {
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
  return collectAllBasePages(
    (pageToken) => client.listRecords(tableId, { pageSize, pageToken }, { signal }),
    { signal, resourceName: "记录" },
  );
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
