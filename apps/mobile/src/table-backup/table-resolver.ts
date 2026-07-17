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
    | "table_create_failed"
    | "table_create_uncertain"
    | "table_name_conflict";
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
  /** 固定为创建 client 时读取到的 Base，防止连接切换后跨 Base 绑定。 */
  expectedAppToken: string;
  signal?: AbortSignal;
  pageSize?: number;
}

export interface RestoreTableSelection {
  expectedAppToken: string;
  tableId: string;
}

export interface ResolveTableForRestoreOptions extends ResolveTableOptions {
  /** 使用者明确选择的本次只读恢复来源；不会写入备份目标身份。 */
  selection?: RestoreTableSelection;
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
  if (state.appToken !== options.expectedAppToken) {
    return connectionChangedResolution();
  }

  if (state.backupTableId) {
    const stored = await verifyStoredTable(options, state);
    if (stored.status !== "not_found") {
      return stored;
    }
  }

  const discovered = state.backupBindingId
    ? await discoverMatchingBinding(
        options,
        state.appToken,
        state.backupBindingId,
      )
    : await discoverUnboundCandidates(options);
  if (discovered.status !== "not_found") {
    return discovered;
  }

  if (state.pendingTableName && state.backupBindingId) {
    return reconcilePendingCreate(options, {
      expectedAppToken: state.appToken,
      bindingId: state.backupBindingId,
      cause: new Error("存在尚未确认的建表请求。"),
    });
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

  const current = await options.connection.get();
  if (!current) {
    return { status: "not_found" };
  }
  if (current.appToken !== options.expectedAppToken) {
    return connectionChangedResolution();
  }
  let bindingId = current.backupBindingId;
  try {
    bindingId ??= await options.connection.ensureBackupBindingId(current.appToken);
  } catch (error) {
    return {
      status: "failed",
      error: resolutionError(
        "binding_conflict",
        error,
        "准备新备份目标时连接已变化。",
      ),
    };
  }
  const tableName = await chooseAvailableManagedTableName(options, bindingId);
  if (typeof tableName !== "string") {
    return tableName;
  }
  return createManagedTable(options, tableName);
}

/**
 * 只读解析恢复来源。除找回“本机已有 binding 的唯一 marker”时保存 table ID 外，
 * 不修改本地备份身份；任何路径都不会补字段、补 marker 或写远端记录。
 */
export async function resolveTableForRestore(
  options: ResolveTableForRestoreOptions,
): Promise<TableResolution> {
  const state = await options.connection.get();
  if (!state) {
    return { status: "not_found" };
  }
  if (state.appToken !== options.expectedAppToken) {
    return connectionChangedResolution();
  }

  if (options.selection) {
    if (options.selection.expectedAppToken !== options.expectedAppToken) {
      return connectionChangedResolution();
    }
    return verifyRestoreTable(options, state, options.selection.tableId, true);
  }

  if (state.backupTableId) {
    const stored = await verifyRestoreTable(
      options,
      state,
      state.backupTableId,
      false,
    );
    if (stored.status !== "not_found") {
      return stored;
    }
  }

  return discoverTablesForRestore(options, state);
}

async function verifyRestoreTable(
  options: ResolveTableOptions,
  state: NonNullable<Awaited<ReturnType<TableBackupConnectionRepository["get"]>>>,
  tableId: string,
  explicitlySelected: boolean,
): Promise<TableResolution> {
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
        explicitlySelected
          ? "无法验证所选恢复数据表。"
          : "无法验证已保存的恢复数据表。",
      ),
    };
  }

  const unsafe = restoreCandidateFailure(candidate);
  if (unsafe) {
    return unsafe;
  }
  if (
    !explicitlySelected &&
    state.backupBindingId !== null &&
    candidate.kind === "managed_other"
  ) {
    return failedResolution(
      "binding_conflict",
      "已保存的数据表 marker 与本机备份目标不一致，已停止恢复预检。",
    );
  }
  return { status: "ready", tableId, recovered: false };
}

async function discoverTablesForRestore(
  options: ResolveTableOptions,
  state: NonNullable<Awaited<ReturnType<TableBackupConnectionRepository["get"]>>>,
): Promise<TableResolution> {
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
        "无法完整读取可恢复数据表列表。",
      ),
    };
  }

  const bindingId = state.backupBindingId;
  const inspectedTables = bindingId
    ? tables
    : tables.filter(({ name }) => name === BACKUP_TABLE_NAME);
  const matches: TableCandidateInspection[] = [];
  const choices: TableCandidate[] = [];

  for (const table of inspectedTables) {
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
          "无法完整读取可恢复数据表字段。",
        ),
      };
    }

    if (candidate.kind === "ambiguous") {
      return failedResolution(
        "ambiguous_marker",
        "发现包含多个备份目标 marker 的数据表，无法安全选择恢复来源。",
      );
    }
    if (
      candidate.kind === "future_managed" &&
      (table.name === BACKUP_TABLE_NAME || candidate.bindingId === bindingId)
    ) {
      return failedResolution(
        "future_marker",
        "可恢复数据表由更高版本应用管理，请升级应用后再操作。",
      );
    }
    if (
      candidate.kind === "incompatible" &&
      candidate.marker.status === "managed" &&
      candidate.marker.bindingId === bindingId
    ) {
      return restoreCandidateFailure(candidate)!;
    }
    if (candidate.kind === "managed_matching") {
      matches.push(candidate);
      continue;
    }
    if (
      candidate.kind === "managed_other" ||
      (table.name === BACKUP_TABLE_NAME && isLegacyChoice(candidate.kind))
    ) {
      choices.push(candidate);
    }
  }

  if (matches.length > 1) {
    return failedResolution(
      "ambiguous_marker",
      "多个数据表使用同一个备份目标 marker，无法自动选择恢复来源。",
    );
  }
  if (matches.length === 1 && bindingId) {
    const match = matches[0];
    try {
      await options.connection.bindBackupTable({
        expectedAppToken: options.expectedAppToken,
        expectedBindingId: bindingId,
        tableId: match.tableId,
      });
    } catch (error) {
      return {
        status: "failed",
        error: resolutionError(
          "binding_conflict",
          error,
          "保存找回的恢复数据表时连接已变化。",
        ),
      };
    }
    return { status: "ready", tableId: match.tableId, recovered: true };
  }
  return choices.length > 0
    ? { status: "needs_table_choice", candidates: choices }
    : { status: "not_found" };
}

function restoreCandidateFailure(
  candidate: TableCandidateInspection,
): Extract<TableResolution, { status: "failed" }> | null {
  if (candidate.kind === "ambiguous") {
    return failedResolution(
      "ambiguous_marker",
      "恢复数据表包含多个备份目标 marker，无法安全读取。",
    );
  }
  if (candidate.kind === "future_managed") {
    return failedResolution(
      "future_marker",
      "恢复数据表由更高版本应用管理，请升级应用后再操作。",
    );
  }
  if (candidate.kind !== "incompatible") {
    return null;
  }
  const incompatibleFields = [
    ...candidate.missingFieldNames,
    ...candidate.mismatchedFieldNames,
  ];
  return failedResolution(
    "contract_incompatible",
    incompatibleFields.length > 0
      ? `恢复数据表字段不兼容：${incompatibleFields.join("、")}。`
      : "恢复数据表 marker 不兼容。",
  );
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
    candidate.kind === "incompatible"
  ) {
    const incompatibleFields = [
      ...candidate.missingFieldNames,
      ...candidate.mismatchedFieldNames,
    ];
    return failedResolution(
      "contract_incompatible",
      incompatibleFields.length > 0
        ? `已保存的数据表字段不兼容：${incompatibleFields.join("、")}。未修改远端内容。`
        : "已保存的数据表管理标识不兼容，未修改远端内容。",
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
  const choices: TableCandidate[] = [];
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
      continue;
    }
    if (
      candidate.kind === "managed_other" ||
      (table.name === BACKUP_TABLE_NAME && isLegacyChoice(candidate.kind))
    ) {
      choices.push(candidate);
    }
  }

  if (matches.length === 0) {
    return choices.length > 0
      ? { status: "needs_table_choice", candidates: choices }
      : { status: "not_found" };
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

async function discoverUnboundCandidates(
  options: ResolveTableOptions,
): Promise<TableResolution> {
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

  const choices: TableCandidate[] = [];
  for (const table of tables.filter(({ name }) => name === BACKUP_TABLE_NAME)) {
    let candidate: TableCandidateInspection;
    try {
      candidate = await inspectTableCandidate(options.client, table, {
        signal: options.signal,
        pageSize: options.pageSize,
      });
    } catch (error) {
      return {
        status: "failed",
        error: resolutionError(
          "discovery_incomplete",
          error,
          "无法完整读取同名候选字段，未创建或认领数据表。",
        ),
      };
    }
    if (candidate.kind === "ambiguous") {
      return failedResolution(
        "ambiguous_marker",
        "同名数据表包含多个备份目标标识，已停止写入。",
      );
    }
    if (candidate.kind === "future_managed") {
      return failedResolution(
        "future_marker",
        "同名数据表由更高版本应用管理，请升级应用后再操作。",
      );
    }
    if (candidate.kind === "managed_other" || isLegacyChoice(candidate.kind)) {
      choices.push(candidate);
    }
  }
  return choices.length > 0
    ? { status: "needs_table_choice", candidates: choices }
    : { status: "not_found" };
}

export async function createManagedTable(
  options: ResolveTableOptions,
  requestedName?: string,
): Promise<TableResolution> {
  const state = await options.connection.get();
  if (!state) {
    return { status: "not_found" };
  }
  if (state.appToken !== options.expectedAppToken) {
    return connectionChangedResolution();
  }

  let bindingId: string;
  let tableName: string;
  try {
    bindingId =
      state.backupBindingId ??
      (await options.connection.ensureBackupBindingId(state.appToken));
    tableName = requestedName ?? state.pendingTableName ?? BACKUP_TABLE_NAME;
    await options.connection.markCreatePending({
      expectedAppToken: state.appToken,
      bindingId,
      tableName,
    });
  } catch (error) {
    return {
      status: "failed",
      error: resolutionError(
        "table_create_failed",
        error,
        "准备受管备份数据表失败。",
      ),
    };
  }

  let tableId: string;
  try {
    tableId = await options.client.createTable(
      {
        name: tableName,
        fields: [
          ...buildBackupTableFields(),
          buildBackupBindingMarkerField(bindingId),
        ],
      },
      { signal: options.signal },
    );
  } catch (error) {
    if (!isCreateResultUncertain(error)) {
      return {
        status: "failed",
        error: resolutionError(
          "table_create_failed",
          error,
          "创建受管备份数据表失败。",
        ),
      };
    }
    if (
      options.signal?.aborted ||
      (error instanceof BaseApiError && error.kind === "cancelled")
    ) {
      return uncertainCreateResolution(error);
    }
    return reconcilePendingCreate(options, {
      expectedAppToken: state.appToken,
      bindingId,
      cause: error,
    });
  }

  try {
    await options.connection.bindBackupTable({
      expectedAppToken: state.appToken,
      expectedBindingId: bindingId,
      tableId,
    });
    return { status: "ready", tableId, recovered: false };
  } catch (error) {
    return reconcilePendingCreate(options, {
      expectedAppToken: state.appToken,
      bindingId,
      cause: error,
    });
  }
}

export async function adoptExistingTable(
  options: ResolveTableOptions,
  tableId: string,
): Promise<TableResolution> {
  const state = await options.connection.get();
  if (!state) {
    return { status: "not_found" };
  }
  if (state.appToken !== options.expectedAppToken) {
    return connectionChangedResolution();
  }

  let table: BaseTableSummary | undefined;
  try {
    table = (
      await listTablesForResolution(options.client, {
        signal: options.signal,
        pageSize: options.pageSize,
      })
    ).find((candidate) => candidate.table_id === tableId);
  } catch (error) {
    return {
      status: "failed",
      error: resolutionError(
        "discovery_incomplete",
        error,
        "重新读取候选列表失败，未认领数据表。",
      ),
    };
  }
  if (!table) {
    return { status: "not_found" };
  }

  let candidate: TableCandidateInspection;
  try {
    candidate = await inspectTableCandidate(options.client, table, {
      expectedBindingId: state.backupBindingId,
      signal: options.signal,
      pageSize: options.pageSize,
    });
  } catch (error) {
    return {
      status: "failed",
      error: resolutionError(
        "discovery_incomplete",
        error,
        "重新读取候选字段失败，未认领数据表。",
      ),
    };
  }
  if (
    candidate.kind === "ambiguous" ||
    candidate.kind === "future_managed" ||
    candidate.kind === "incompatible"
  ) {
    return failedResolution(
      candidate.kind === "ambiguous"
        ? "ambiguous_marker"
        : candidate.kind === "future_managed"
          ? "future_marker"
          : "contract_incompatible",
      "候选数据表已变化或不兼容，未执行覆盖。",
    );
  }

  let bindingId: string;
  try {
    if (candidate.marker.status === "managed") {
      bindingId = candidate.marker.bindingId;
      await options.connection.adoptBackupTable({
        expectedAppToken: state.appToken,
        bindingId,
        tableId,
      });
    } else {
      const rotated = await options.connection.startNewBackupTarget(state.appToken);
      bindingId = rotated.backupBindingId!;
      await options.connection.bindBackupTable({
        expectedAppToken: state.appToken,
        expectedBindingId: bindingId,
        tableId,
      });
    }
  } catch (error) {
    return {
      status: "failed",
      error: resolutionError(
        "binding_conflict",
        error,
        "认领候选时连接已变化。",
      ),
    };
  }
  return prepareOwnedTable(options, {
    expectedAppToken: state.appToken,
    tableId,
    candidate,
    recovered: true,
  });
}

export async function createIndependentManagedTable(
  options: ResolveTableOptions,
): Promise<TableResolution> {
  const state = await options.connection.get();
  if (!state) {
    return { status: "not_found" };
  }
  if (state.appToken !== options.expectedAppToken) {
    return connectionChangedResolution();
  }
  let bindingId: string;
  try {
    const rotated = await options.connection.startNewBackupTarget(state.appToken);
    bindingId = rotated.backupBindingId!;
  } catch (error) {
    return {
      status: "failed",
      error: resolutionError(
        "binding_conflict",
        error,
        "准备独立备份目标时连接已变化。",
      ),
    };
  }
  const name = await chooseAvailableManagedTableName(options, bindingId);
  return typeof name === "string" ? createManagedTable(options, name) : name;
}

export async function reconcilePendingCreate(
  options: ResolveTableOptions,
  input: {
    expectedAppToken: string;
    bindingId: string;
    cause: unknown;
  },
): Promise<TableResolution> {
  if (input.expectedAppToken !== options.expectedAppToken) {
    return connectionChangedResolution();
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const resolution = await discoverMatchingBinding(
      options,
      input.expectedAppToken,
      input.bindingId,
    );
    if (resolution.status === "ready") {
      return resolution;
    }
    if (
      resolution.status === "failed" &&
      [
        "ambiguous_marker",
        "future_marker",
        "contract_incompatible",
      ].includes(resolution.error.kind)
    ) {
      return resolution;
    }
  }
  return uncertainCreateResolution(input.cause);
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

function connectionChangedResolution(): Extract<
  TableResolution,
  { status: "failed" }
> {
  return failedResolution(
    "binding_conflict",
    "飞书连接已切换，本次数据表解析已停止。",
  );
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
      "cancelled",
    ].includes(error.kind)
  );
}

function isLegacyChoice(kind: TableCandidateKind): boolean {
  return kind === "legacy7" || kind === "partial8_9" || kind === "current10";
}

async function chooseAvailableManagedTableName(
  options: ResolveTableOptions,
  bindingId: string,
): Promise<
  string | Extract<TableResolution, { status: "failed" }>
> {
  let occupied: Set<string>;
  try {
    occupied = new Set(
      (
        await listTablesForResolution(options.client, {
          signal: options.signal,
          pageSize: options.pageSize,
        })
      ).map(({ name }) => name),
    );
  } catch (error) {
    return {
      status: "failed",
      error: resolutionError(
        "discovery_incomplete",
        error,
        "无法确认可用的数据表名称，未创建新表。",
      ),
    };
  }
  if (!occupied.has(BACKUP_TABLE_NAME)) {
    return BACKUP_TABLE_NAME;
  }
  for (const length of [8, 12, 16, 32]) {
    const name = `${BACKUP_TABLE_NAME} · ${bindingId.replaceAll("-", "").slice(0, length)}`;
    if (!occupied.has(name)) {
      return name;
    }
  }
  return failedResolution(
    "table_name_conflict",
    "无法为独立备份数据表选择不冲突的确定性名称。",
  );
}

function uncertainCreateResolution(
  cause: unknown,
): Extract<TableResolution, { status: "failed" }> {
  return {
    status: "failed",
    error: {
      kind: "table_create_uncertain",
      message:
        "建表结果尚未确认。本次不会重复创建，下次操作会先按绑定标识对账。",
      retryable: true,
      cause,
    },
  };
}
