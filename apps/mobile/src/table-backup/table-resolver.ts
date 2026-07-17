import {
  BaseApiError,
  type BaseApiClient,
  type BaseField,
  type BasePage,
  type BaseTableSummary,
} from "./base-api-client";
import {
  RESTORE_OPTIONAL_FIELD_CONTRACT,
  RESTORE_REQUIRED_FIELD_CONTRACT,
  analyzeFieldContract,
} from "./field-contract";
import {
  inspectBackupBindingMarkers,
  type BackupBindingMarkerInspection,
} from "./table-binding-marker";

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

type TableListClient = Pick<BaseApiClient, "listTables">;
type FieldListClient = Pick<BaseApiClient, "listFields">;

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
