import {
  BASE_FIELD_TYPE_TEXT,
  type BaseField,
  type CreateTableFieldSpec,
} from "./base-api-client";

export const BACKUP_BINDING_MARKER_PREFIX = "__imagemon_backup_target_v";
export const CURRENT_BACKUP_BINDING_MARKER_VERSION = 1;

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

export type BackupBindingMarkerInvalidReason =
  | "malformed_marker"
  | "invalid_version"
  | "invalid_uuid"
  | "invalid_field_type";

export type ParsedBackupBindingMarker =
  | { readonly status: "none" }
  | {
      readonly status: "managed";
      readonly version: typeof CURRENT_BACKUP_BINDING_MARKER_VERSION;
      readonly bindingId: string;
    }
  | {
      readonly status: "future";
      readonly version: number;
      readonly bindingId: string;
    }
  | {
      readonly status: "unsupported";
      readonly versionText: string;
    }
  | {
      readonly status: "invalid";
      readonly reason: Exclude<
        BackupBindingMarkerInvalidReason,
        "invalid_field_type"
      >;
    };

export type BackupBindingMarkerInspection =
  | { readonly status: "none" }
  | {
      readonly status: "managed";
      readonly version: typeof CURRENT_BACKUP_BINDING_MARKER_VERSION;
      readonly bindingId: string;
      readonly field: BaseField;
    }
  | {
      readonly status: "future";
      readonly version: number;
      readonly bindingId: string;
      readonly field: BaseField;
    }
  | {
      readonly status: "unsupported";
      readonly versionText: string;
      readonly field: BaseField;
    }
  | {
      readonly status: "invalid";
      readonly reason: BackupBindingMarkerInvalidReason;
      readonly field: BaseField;
    }
  | {
      readonly status: "conflict";
      readonly fields: readonly BaseField[];
    };

export class TableBindingMarkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableBindingMarkerError";
  }
}

/** 构造当前版本的管理字段名；UUID 允许大写输入，但输出始终为 canonical 小写。 */
export function buildBackupBindingMarkerName(backupBindingId: string): string {
  return (
    `${BACKUP_BINDING_MARKER_PREFIX}${CURRENT_BACKUP_BINDING_MARKER_VERSION}__` +
    normalizeBackupBindingId(backupBindingId)
  );
}

/** 管理 marker 是业务十字段之外、随建表请求原子创建的额外文本字段。 */
export function buildBackupBindingMarkerField(
  backupBindingId: string,
): CreateTableFieldSpec {
  return {
    field_name: buildBackupBindingMarkerName(backupBindingId),
    type: BASE_FIELD_TYPE_TEXT,
  };
}

/**
 * 只解析保留前缀开头的字段名。未知更高版本保留 binding ID 供调用方展示，
 * 但不能按当前版本继续写入。
 */
export function parseBackupBindingMarkerName(
  fieldName: string,
): ParsedBackupBindingMarker {
  if (!fieldName.startsWith(BACKUP_BINDING_MARKER_PREFIX)) {
    return { status: "none" };
  }

  const payload = fieldName.slice(BACKUP_BINDING_MARKER_PREFIX.length);
  const separatorIndex = payload.indexOf("__");
  if (separatorIndex < 0) {
    return { status: "invalid", reason: "malformed_marker" };
  }

  const versionText = payload.slice(0, separatorIndex);
  const bindingIdText = payload.slice(separatorIndex + 2);
  if (versionText === "0") {
    return { status: "unsupported", versionText };
  }
  if (!CANONICAL_POSITIVE_INTEGER_PATTERN.test(versionText)) {
    return { status: "invalid", reason: "invalid_version" };
  }

  const version = Number(versionText);
  if (!Number.isSafeInteger(version)) {
    return { status: "unsupported", versionText };
  }

  const bindingId = tryNormalizeBackupBindingId(bindingIdText);
  if (bindingId === null) {
    return { status: "invalid", reason: "invalid_uuid" };
  }

  if (version === CURRENT_BACKUP_BINDING_MARKER_VERSION) {
    return { status: "managed", version, bindingId };
  }
  return { status: "future", version, bindingId };
}

/** 同一张表只允许一个管理 marker；多个候选一律冲突，禁止按字段顺序选择。 */
export function inspectBackupBindingMarkers(
  fields: readonly BaseField[],
): BackupBindingMarkerInspection {
  const markerFields = fields.filter((field) =>
    field.field_name.startsWith(BACKUP_BINDING_MARKER_PREFIX),
  );
  if (markerFields.length === 0) {
    return { status: "none" };
  }
  if (markerFields.length > 1) {
    return { status: "conflict", fields: markerFields };
  }

  const field = markerFields[0];
  if (field.type !== BASE_FIELD_TYPE_TEXT) {
    return { status: "invalid", reason: "invalid_field_type", field };
  }

  const parsed = parseBackupBindingMarkerName(field.field_name);
  switch (parsed.status) {
    case "none":
      return { status: "none" };
    case "managed":
    case "future":
      return { ...parsed, field };
    case "unsupported":
      return { ...parsed, field };
    case "invalid":
      return { ...parsed, field };
  }
}

function normalizeBackupBindingId(backupBindingId: string): string {
  const normalized = tryNormalizeBackupBindingId(backupBindingId);
  if (normalized === null) {
    throw new TableBindingMarkerError("backupBindingId 必须是 canonical UUID。");
  }
  return normalized;
}

function tryNormalizeBackupBindingId(value: string): string | null {
  if (typeof value !== "string" || !CANONICAL_UUID_PATTERN.test(value)) {
    return null;
  }
  return value.toLowerCase();
}
