import {
  BaseApiError,
  type BaseApiClient,
  type BaseField,
  type BasePage,
  type BaseTableSummary,
} from "./base-api-client";
import {
  BACKUP_TABLE_NAME,
  FieldContractError,
  RESTORE_OPTIONAL_FIELD_CONTRACT,
  RESTORE_REQUIRED_FIELD_CONTRACT,
  analyzeFieldContract,
  buildBackupTableFields,
  ensureBackupFieldContract,
} from "./field-contract";
import {
  buildBackupBindingMarkerField,
  inspectBackupBindingMarkers,
  type BackupBindingMarkerInspection,
} from "./table-binding-marker";
import type { TableBackupConnectionRepository } from "./connection-repository";

export const DEFAULT_TABLE_RESOLUTION_PAGE_SIZE = 100;

export type TableCandidateKind =
  | "legacy7"
  | "partial8_9"
  | "current10"
  | "managed_matching"
  | "managed_other"
  | "incompatible"
  | "future_managed"
  | "ambiguous";

export interface TableCandidate {
  tableId: string;
  name: string;
  kind: TableCandidateKind;
  bindingId: string | null;
  missingFieldNames: string[];
  mismatchedFieldNames: string[];
}

export interface TableCandidateInspection extends TableCandidate {
  fields: BaseField[];
  marker: BackupBindingMarkerInspection;
}

export interface TableResolutionError {
  kind:
    | "stored_table_unavailable"
    | "contract_incompatible"
    | "binding_conflict"
    | "future_marker"
    | "ambiguous_marker"
    | "discovery_incomplete"
    | "upgrade_contract"
    | "table_create_failed";
  message: string;
  retryable: boolean;
  cause?: unknown;
}

export type TableResolution =
  | { status: "ready"; tableId: string; recovered: boolean }
  | { status: "needs_table_choice"; candidates: TableCandidate[] }
  | { status: "not_found" }
  | { status: "failed"; error: TableResolutionError };

export interface ResolveTableOptions {
  client: BaseApiClient;
  connection: TableBackupConnectionRepository;
  signal?: AbortSignal;
  pageSize?: number;
}

type TableListClient = Pick<BaseApiClient, "listTables">;
type FieldListClient = Pick<BaseApiClient, "listFields">;

/**
 * 先验证已保存的强身份。无 ID 或明确 TableIdNotFound 暂返回 not_found，
 * 后续发现/建表阶段会在同一入口继续扩展；其它读错误一律保留本地状态。
 */
export async function resolveTableForBackup(
  options: ResolveTableOptions,
): Promise<TableResolution> {
  const state = await options.connection.get();
  if (!state) {
    return { status: "not_found" };
  }

  if (state.backupTableId) {
    const stored = await verifyStoredTable(options, state);
    if (stored.status !== "not_found") {
      return stored;
    }
  }

  const discovered = await discoverMatchingBinding(
    options,
    state.appToken,
    state.backupBindingId,
  );
  if (discovered.status !== "not_found") {
    return discovered;
  }

  if (state.backupTableId) {
    try {
      await options.connection.startNewBackupTarget(state.appToken);
    } catch (error) {
      return {
        status: "failed",
        error: resolutionError(
          "binding_conflict",
          error,
          "备份目标失效后连接已变化。",
        ),
      };
    }
  }
  return createManagedTable(options);
}

async function verifyStoredTable(
  options: ResolveTableOptions,
  state: NonNullable<Awaited<ReturnType<TableBackupConnectionRepository["get"]>>>,
): Promise<TableResolution> {
  const tableId = state.backupTableId;
  if (!tableId) {
    return { status: "not_found" };
  }

  let candidate: TableCandidateInspection;
  try {
    candidate = await inspectTableCandidate(
      options.client,
      { table_id: tableId, name: "" },
      {
        expectedBindingId: state.backupBindingId,
        signal: options.signal,
        pageSize: options.pageSize,
      },
    );
  } catch (error) {
    if (error instanceof BaseApiError && error.code === 1254041) {
      return { status: "not_found" };
    }
    return {
      status: "failed",
      error: resolutionError(
        "stored_table_unavailable",
        error,
        "无法验证已保存的备份数据表，未创建新表。",
      ),
    };
  }

  if (candidate.kind === "ambiguous") {
    return failedResolution(
      "ambiguous_marker",
      "已保存的数据表存在多个备份目标标识，已停止写入。",
    );
  }
  if (candidate.kind === "future_managed") {
    return failedResolution(
      "future_marker",
      "备份数据表由更高版本应用管理，请升级应用后再操作。",
    );
  }
  if (
    candidate.marker.status === "invalid" ||
    candidate.marker.status === "unsupported" ||
    candidate.mismatchedFieldNames.length > 0
  ) {
    return failedResolution(
      "contract_incompatible",
      "已保存的数据表字段或管理标识不兼容，未修改远端内容。",
    );
  }
  if (
    state.backupBindingId !== null &&
    candidate.kind === "managed_other"
  ) {
    return failedResolution(
      "binding_conflict",
      "已保存的数据表绑定标识与本机状态不一致，已停止写入。",
    );
  }

  return prepareOwnedTable(options, {
    expectedAppToken: state.appToken,
    tableId,
    candidate,
    recovered: false,
  });
}

async function discoverMatchingBinding(
  options: ResolveTableOptions,
  expectedAppToken: string,
  bindingId: string | null,
): Promise<TableResolution> {
  if (!bindingId) {
    return { status: "not_found" };
  }

  let tables: BaseTableSummary[];
  try {
    tables = await listTablesForResolution(options.client, {
      signal: options.signal,
      pageSize: options.pageSize,
    });
  } catch (error) {
    return {
      status: "failed",
      error: resolutionError(
        "discovery_incomplete",
        error,
        "无法完整读取数据表列表，未创建或认领数据表。",
      ),
    };
  }

  const matches: TableCandidateInspection[] = [];
  for (const table of tables) {
    let candidate: TableCandidateInspection;
    try {
      candidate = await inspectTableCandidate(options.client, table, {
        expectedBindingId: bindingId,
        signal: options.signal,
        pageSize: options.pageSize,
      });
    } catch (error) {
      return {
        status: "failed",
        error: resolutionError(
          "discovery_incomplete",
          error,
          "无法完整读取候选字段，未创建或认领数据表。",
        ),
      };
    }

    if (candidate.kind === "ambiguous") {
      return failedResolution(
        "ambiguous_marker",
        "发现包含多个备份目标标识的数据表，已停止写入。",
      );
    }
    if (candidate.kind === "future_managed") {
      return failedResolution(
        "future_marker",
        "发现由更高版本应用管理的数据表，请升级应用后再操作。",
      );
    }
    if (
      candidate.bindingId === bindingId &&
      candidate.marker.status === "managed"
    ) {
      if (candidate.mismatchedFieldNames.length > 0) {
        return failedResolution(
          "contract_incompatible",
          "匹配绑定标识的数据表存在字段类型冲突，未修改远端内容。",
        );
      }
      matches.push(candidate);
    }
  }

  if (matches.length === 0) {
    return { status: "not_found" };
  }
  if (matches.length > 1) {
    return failedResolution(
      "ambiguous_marker",
      "多个数据表使用同一个备份目标标识，无法自动选择。",
    );
  }

  const match = matches[0];
  try {
    await options.connection.bindBackupTable({
      expectedAppToken,
      expectedBindingId: bindingId,
      tableId: match.tableId,
    });
  } catch (error) {
    return {
      status: "failed",
      error: resolutionError(
        "binding_conflict",
        error,
        "保存恢复的备份目标时连接已变化。",
      ),
    };
  }
  return prepareOwnedTable(options, {
    expectedAppToken,
    tableId: match.tableId,
    candidate: match,
    recovered: true,
  });
}

export async function createManagedTable(
  options: ResolveTableOptions,
  requestedName?: string,
): Promise<TableResolution> {
  const state = await options.connection.get();
  if (!state) {
    return { status: "not_found" };
  }

  let bindingId: string;
  try {
    bindingId =
      state.backupBindingId ??
      (await options.connection.ensureBackupBindingId(state.appToken));
    const tableName = requestedName ?? state.pendingTableName ?? BACKUP_TABLE_NAME;
    await options.connection.markCreatePending({
      expectedAppToken: state.appToken,
      bindingId,
      tableName,
    });
    const tableId = await options.client.createTable(
      {
        name: tableName,
        fields: [
          ...buildBackupTableFields(),
          buildBackupBindingMarkerField(bindingId),
        ],
      },
      { signal: options.signal },
    );
    await options.connection.bindBackupTable({
      expectedAppToken: state.appToken,
      expectedBindingId: bindingId,
      tableId,
    });
    return { status: "ready", tableId, recovered: false };
  } catch (error) {
    return {
      status: "failed",
      error: resolutionError(
        "table_create_failed",
        error,
        "创建受管备份数据表失败。",
      ),
    };
  }
}

async function prepareOwnedTable(
  options: ResolveTableOptions,
  input: {
    expectedAppToken: string;
    tableId: string;
    candidate: TableCandidateInspection;
    recovered: boolean;
  },
): Promise<TableResolution> {
  let bindingId: string;
  try {
    if (input.candidate.marker.status === "managed") {
      bindingId = await options.connection.adoptBackupBindingId(
        input.expectedAppToken,
        input.candidate.marker.bindingId,
      );
    } else {
      bindingId = await options.connection.ensureBackupBindingId(
        input.expectedAppToken,
      );
    }

    await ensureBackupFieldContract(options.client, input.tableId, {
      signal: options.signal,
    });
    if (input.candidate.marker.status === "none") {
      await ensureOwnedMarker(options, input.tableId, bindingId);
    }
    return {
      status: "ready",
      tableId: input.tableId,
      recovered: input.recovered,
    };
  } catch (error) {
    return {
      status: "failed",
      error: resolutionError(
        "upgrade_contract",
        error,
        "升级已确认备份数据表的字段契约失败。",
      ),
    };
  }
}

async function ensureOwnedMarker(
  options: ResolveTableOptions,
  tableId: string,
  bindingId: string,
): Promise<void> {
  const markerField = buildBackupBindingMarkerField(bindingId);
  try {
    await options.client.createField(tableId, markerField, {
      signal: options.signal,
    });
  } catch (error) {
    if (isCreateResultUncertain(error)) {
      try {
        const fields = await collectAllTableFields(options.client, tableId, {
          signal: options.signal,
          pageSize: options.pageSize,
        });
        const marker = inspectBackupBindingMarkers(fields);
        if (marker.status === "managed" && marker.bindingId === bindingId) {
          return;
        }
      } catch {
        // 外层保留原始 createField cause，避免用二次读取错误掩盖提交结果。
      }
    }
    throw new FieldContractError("补建备份目标管理标识失败。", error);
  }
}

export async function listTablesForResolution(
  client: TableListClient,
  options: { signal?: AbortSignal; pageSize?: number } = {},
): Promise<BaseTableSummary[]> {
  return collectAllPages(
    (pageToken) =>
      client.listTables(
        {
          pageSize: options.pageSize ?? DEFAULT_TABLE_RESOLUTION_PAGE_SIZE,
          pageToken,
        },
        { signal: options.signal },
      ),
    options.signal,
    "数据表",
  );
}

export async function collectAllTableFields(
  client: FieldListClient,
  tableId: string,
  options: { signal?: AbortSignal; pageSize?: number } = {},
): Promise<BaseField[]> {
  return collectAllPages(
    (pageToken) =>
      client.listFields(
        tableId,
        {
          pageSize: options.pageSize ?? DEFAULT_TABLE_RESOLUTION_PAGE_SIZE,
          pageToken,
        },
        { signal: options.signal },
      ),
    options.signal,
    "字段",
  );
}

/** 候选身份确认前的只读检查；只允许 listFields，不补字段或写记录。 */
export async function inspectTableCandidate(
  client: FieldListClient,
  table: BaseTableSummary,
  options: {
    expectedBindingId?: string | null;
    signal?: AbortSignal;
    pageSize?: number;
  } = {},
): Promise<TableCandidateInspection> {
  const fields = await collectAllTableFields(client, table.table_id, options);
  const marker = inspectBackupBindingMarkers(fields);
  const contract = analyzeFieldContract(fields);
  const missingNames = contract.missing.map((field) => field.name);
  const mismatchedNames = contract.mismatched.map((field) => field.name);
  const requiredNames = new Set(
    RESTORE_REQUIRED_FIELD_CONTRACT.map((field) => field.name),
  );
  const requiredMissing = missingNames.some((name) => requiredNames.has(name));

  let kind: TableCandidateKind;
  let bindingId: string | null = null;
  if (marker.status === "conflict") {
    kind = "ambiguous";
  } else if (marker.status === "future") {
    kind = "future_managed";
    bindingId = marker.bindingId;
  } else if (marker.status === "invalid" || marker.status === "unsupported") {
    kind = "incompatible";
  } else if (requiredMissing || mismatchedNames.length > 0) {
    kind = "incompatible";
    if (marker.status === "managed") {
      bindingId = marker.bindingId;
    }
  } else if (marker.status === "managed") {
    bindingId = marker.bindingId;
    kind =
      options.expectedBindingId === marker.bindingId
        ? "managed_matching"
        : "managed_other";
  } else {
    const optionalNames = new Set(
      RESTORE_OPTIONAL_FIELD_CONTRACT.map((field) => field.name),
    );
    const optionalMissingCount = missingNames.filter((name) =>
      optionalNames.has(name),
    ).length;
    kind =
      optionalMissingCount === RESTORE_OPTIONAL_FIELD_CONTRACT.length
        ? "legacy7"
        : optionalMissingCount > 0
          ? "partial8_9"
          : "current10";
  }

  return {
    tableId: table.table_id,
    name: table.name,
    kind,
    bindingId,
    missingFieldNames: missingNames,
    mismatchedFieldNames: mismatchedNames,
    fields,
    marker,
  };
}

async function collectAllPages<T>(
  fetchPage: (pageToken: string | undefined) => Promise<BasePage<T>>,
  signal: AbortSignal | undefined,
  resourceName: string,
): Promise<T[]> {
  const items: T[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  do {
    throwIfAborted(signal);
    const page = await fetchPage(pageToken);
    items.push(...page.items);
    if (!page.hasMore) {
      return items;
    }
    const nextToken = page.pageToken;
    if (!nextToken || seenTokens.has(nextToken)) {
      throw new BaseApiError(
        "invalid_response",
        null,
        `${resourceName}分页响应不完整或重复。`,
      );
    }
    seenTokens.add(nextToken);
    pageToken = nextToken;
  } while (true);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new BaseApiError("cancelled", null, "操作已取消。");
  }
}

function failedResolution(
  kind: TableResolutionError["kind"],
  message: string,
): Extract<TableResolution, { status: "failed" }> {
  return {
    status: "failed",
    error: { kind, message, retryable: false },
  };
}

function resolutionError(
  kind: TableResolutionError["kind"],
  cause: unknown,
  fallbackMessage: string,
): TableResolutionError {
  return {
    kind,
    message: cause instanceof Error ? cause.message : fallbackMessage,
    retryable:
      cause instanceof BaseApiError &&
      [
        "rate_limited",
        "not_ready",
        "write_conflict",
        "server_error",
        "network_error",
        "timeout",
      ].includes(cause.kind),
    cause,
  };
}

function isCreateResultUncertain(error: unknown): boolean {
  return (
    error instanceof BaseApiError &&
    [
      "conflict",
      "server_error",
      "network_error",
      "timeout",
      "invalid_response",
    ].includes(error.kind)
  );
}
