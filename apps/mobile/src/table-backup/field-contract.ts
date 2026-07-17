// 备份数据表字段契约 v2（方案 1.1、1.3）+ 校验/补建 + 记录⇄条目双向映射。
//
// 恢复真正消费的原 7 个文本字段是必需集；来源类型、展示图标识和展示图是可选集。
// 备份方向始终补齐全部 10 个字段；恢复方向只因必需字段缺失而拦截，
// 但任意已存在契约字段的类型不符都是致命错误。
import {
  validatePromptdexTemplate,
  type PromptdexTemplate,
  type PromptdexTemplateInput,
} from "@imagemon/core";

import type { PromptdexCatalogEntrySourceType } from "../promptdex";
import {
  BASE_FIELD_TYPE_ATTACHMENT,
  BASE_FIELD_TYPE_TEXT,
  type BaseApiClient,
  type BaseField,
  type CreateTableFieldSpec,
} from "./base-api-client";

export const BACKUP_TABLE_NAME = "Imagemon 图鉴备份";
export const SOURCE_TYPE_FIELD_NAME = "来源类型";
export const DISPLAY_IMAGE_ID_FIELD_NAME = "展示图标识";
export const DISPLAY_IMAGE_FIELD_NAME = "展示图";

export type ContractColumn =
  | "name"
  | "description"
  | "version"
  | "inputs"
  | "body"
  | "createdAt"
  | "updatedAt"
  | "sourceType"
  | "displayImageId"
  | "displayImage";

export interface ContractFieldDef {
  column: ContractColumn;
  /** 多维表格中的字段名（仅展示用，身份以字段类型契约为准）。 */
  name: string;
  type: number;
  /** 主字段（镜像与恢复的匹配键），建表时须为首字段。 */
  primary?: boolean;
}

// 顺序即建表字段顺序：名称必须首位以成为主字段。
export const RESTORE_REQUIRED_FIELD_CONTRACT: readonly ContractFieldDef[] = [
  { column: "name", name: "名称", type: BASE_FIELD_TYPE_TEXT, primary: true },
  { column: "description", name: "用途说明", type: BASE_FIELD_TYPE_TEXT },
  { column: "version", name: "版本", type: BASE_FIELD_TYPE_TEXT },
  { column: "inputs", name: "输入声明JSON", type: BASE_FIELD_TYPE_TEXT },
  { column: "body", name: "模板正文", type: BASE_FIELD_TYPE_TEXT },
  { column: "createdAt", name: "条目创建时间", type: BASE_FIELD_TYPE_TEXT },
  { column: "updatedAt", name: "条目更新时间", type: BASE_FIELD_TYPE_TEXT },
];

export const RESTORE_OPTIONAL_FIELD_CONTRACT: readonly ContractFieldDef[] = [
  { column: "sourceType", name: SOURCE_TYPE_FIELD_NAME, type: BASE_FIELD_TYPE_TEXT },
  {
    column: "displayImageId",
    name: DISPLAY_IMAGE_ID_FIELD_NAME,
    type: BASE_FIELD_TYPE_TEXT,
  },
  {
    column: "displayImage",
    name: DISPLAY_IMAGE_FIELD_NAME,
    type: BASE_FIELD_TYPE_ATTACHMENT,
  },
];

export const FIELD_CONTRACT: readonly ContractFieldDef[] = [
  ...RESTORE_REQUIRED_FIELD_CONTRACT,
  ...RESTORE_OPTIONAL_FIELD_CONTRACT,
];

const FIELD_BY_COLUMN: Record<ContractColumn, ContractFieldDef> = Object.fromEntries(
  FIELD_CONTRACT.map((def) => [def.column, def]),
) as Record<ContractColumn, ContractFieldDef>;

const RESTORE_REQUIRED_COLUMNS = new Set(
  RESTORE_REQUIRED_FIELD_CONTRACT.map((def) => def.column),
);

export class FieldContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldContractError";
  }
}

export interface FieldContractAnalysis {
  /** 契约字段缺失，需补建。 */
  missing: ContractFieldDef[];
  /** 契约字段存在但类型不符（被使用者改类型），致命。 */
  mismatched: ContractFieldDef[];
}

export interface RestoreFieldContractStatus {
  /** 旧契约表没有该字段时，恢复需把整表按 personal 处理。 */
  sourceTypeFieldPresent: boolean;
  displayImageIdFieldPresent: boolean;
  displayImageFieldPresent: boolean;
}

export function buildBackupTableFields(): CreateTableFieldSpec[] {
  return FIELD_CONTRACT.map((def) => ({ field_name: def.name, type: def.type }));
}

export function analyzeFieldContract(
  existingFields: BaseField[],
): FieldContractAnalysis {
  const byName = new Map(existingFields.map((field) => [field.field_name, field]));
  const missing: ContractFieldDef[] = [];
  const mismatched: ContractFieldDef[] = [];
  for (const def of FIELD_CONTRACT) {
    const existing = byName.get(def.name);
    if (!existing) {
      missing.push(def);
    } else if (existing.type !== def.type) {
      mismatched.push(def);
    }
  }
  return { missing, mismatched };
}

type FieldContractClient = Pick<BaseApiClient, "listFields" | "createField">;

/** 备份方向：缺失字段尝试补建，类型不符或补建失败即失败。 */
export async function ensureBackupFieldContract(
  client: FieldContractClient,
  tableId: string,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const existing = await collectAllFields(client, tableId, options.signal);
  const { missing, mismatched } = analyzeFieldContract(existing);
  assertNoMismatch(mismatched);

  for (const def of missing) {
    try {
      await client.createField(
        tableId,
        { field_name: def.name, type: def.type },
        options,
      );
    } catch (error) {
      throw new FieldContractError(
        `补建字段「${def.name}」失败：${errorMessage(error)}`,
      );
    }
  }
}

/**
 * 恢复方向：只校验不补建。原 7 字段缺失直接失败，新 3 字段缺失不拦路；
 * 任意已存在契约字段的类型不符都直接失败。
 */
export async function assertRestoreFieldContract(
  client: FieldContractClient,
  tableId: string,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  await inspectRestoreFieldContract(client, tableId, options);
}

/** 恢复服务在完成同样的契约断言后，可据此判断是否启用来源分流。 */
export async function inspectRestoreFieldContract(
  client: FieldContractClient,
  tableId: string,
  options: { signal?: AbortSignal } = {},
): Promise<RestoreFieldContractStatus> {
  const existing = await collectAllFields(client, tableId, options.signal);
  const { missing, mismatched } = analyzeFieldContract(existing);
  assertNoMismatch(mismatched);
  const missingRequired = missing.filter((def) =>
    RESTORE_REQUIRED_COLUMNS.has(def.column),
  );
  if (missingRequired.length > 0) {
    throw new FieldContractError(
      `备份数据表缺少契约字段：${missingRequired.map((def) => def.name).join("、")}。` +
        "恢复不自动补建，请先在飞书侧修复或换表格重建。",
    );
  }

  const missingColumns = new Set(missing.map((def) => def.column));
  return {
    sourceTypeFieldPresent: !missingColumns.has("sourceType"),
    displayImageIdFieldPresent: !missingColumns.has("displayImageId"),
    displayImageFieldPresent: !missingColumns.has("displayImage"),
  };
}

async function collectAllFields(
  client: FieldContractClient,
  tableId: string,
  signal?: AbortSignal,
): Promise<BaseField[]> {
  const fields: BaseField[] = [];
  let pageToken: string | undefined;
  do {
    const page = await client.listFields(tableId, { pageToken }, { signal });
    fields.push(...page.items);
    pageToken = page.pageToken ?? undefined;
  } while (pageToken);
  return fields;
}

function assertNoMismatch(mismatched: ContractFieldDef[]): void {
  if (mismatched.length > 0) {
    const guidance = mismatched.every((def) => def.type === BASE_FIELD_TYPE_TEXT)
      ? "请在飞书侧改回文本类型，或换新表格重建备份。"
      : "请在飞书侧改回契约要求的字段类型，或换新表格重建备份。";
    throw new FieldContractError(
      `字段类型不符：${mismatched.map((def) => def.name).join("、")}。` +
        guidance,
    );
  }
}

// ── 记录 ⇄ 条目 双向映射（纯函数，可单测） ──────────────────────────

export interface BackupEntryFieldsInput
  extends Pick<
    PromptdexTemplate,
    "name" | "description" | "version" | "inputs" | "body"
  > {
  sourceType: PromptdexCatalogEntrySourceType;
  createdAt?: string;
  updatedAt?: string;
  displayImageId: string;
}

/**
 * 条目 → 备份记录的 9 个契约文本字段（供 batch_create/update 与 diff）。
 * 展示图是附件值，只由单记录 PUT 写入，刻意不进入本映射。
 */
export function entryToBackupFields(
  entry: BackupEntryFieldsInput,
): Record<string, string> {
  return {
    [FIELD_BY_COLUMN.name.name]: entry.name,
    [FIELD_BY_COLUMN.description.name]: entry.description,
    [FIELD_BY_COLUMN.version.name]:
      entry.version === undefined ? "" : JSON.stringify(entry.version),
    [FIELD_BY_COLUMN.inputs.name]: JSON.stringify(entry.inputs),
    [FIELD_BY_COLUMN.body.name]: entry.body,
    [FIELD_BY_COLUMN.createdAt.name]: entry.createdAt ?? "",
    [FIELD_BY_COLUMN.updatedAt.name]: entry.updatedAt ?? "",
    [FIELD_BY_COLUMN.sourceType.name]: entry.sourceType,
    [FIELD_BY_COLUMN.displayImageId.name]: entry.displayImageId,
  };
}

export interface RestoreCandidate {
  template: PromptdexTemplate;
  createdAt: string;
  updatedAt: string;
}

/** 备份记录 → 模板草稿 + 时间戳；非法记录抛 Error（供恢复预检分类）。 */
export function recordFieldsToTemplate(
  fields: Record<string, unknown>,
): RestoreCandidate {
  const name = readContractText(fields, "name");
  const description = readContractText(fields, "description");
  const body = readContractText(fields, "body");
  const versionText = readContractText(fields, "version");
  const inputsText = readContractText(fields, "inputs");
  const createdAt = readContractText(fields, "createdAt");
  const updatedAt = readContractText(fields, "updatedAt");

  const version = parseVersion(versionText);
  const inputs = parseInputs(inputsText);

  const template = validatePromptdexTemplate(
    {
      name,
      description,
      ...(version !== undefined ? { version } : {}),
      inputs,
      body,
      fileName: `${name}.md`,
    },
    `${name}.md`,
  );

  return { template, createdAt, updatedAt };
}

/** 读取记录中的「名称」原文（用于重名检测，即使其余字段非法也能取到）。 */
export function readRecordName(fields: Record<string, unknown>): string {
  return readContractText(fields, "name");
}

/** 读取记录中的来源类型原文，恢复预检据此分流。 */
export function readRecordSourceType(fields: Record<string, unknown>): string {
  return readContractText(fields, "sourceType");
}

function readContractText(
  fields: Record<string, unknown>,
  column: Exclude<ContractColumn, "displayImage">,
): string {
  return extractBaseTextValue(fields[FIELD_BY_COLUMN[column].name]);
}

/**
 * 多维表格文本字段读回时可能是纯字符串，也可能是富文本段数组
 * `[{ type: "text", text: "…" }]`，两种形态都归一为字符串。
 */
export function extractBaseTextValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractBaseTextValue).join("");
  }
  if (isObject(value) && typeof value.text === "string") {
    return value.text;
  }
  return String(value);
}

function parseVersion(text: string): string | boolean | undefined {
  if (text.trim() === "") {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("「版本」不是有效 JSON。");
  }
  if (typeof parsed !== "string" && typeof parsed !== "boolean") {
    throw new Error("「版本」必须是字符串或布尔值。");
  }
  return parsed;
}

function parseInputs(text: string): Record<string, PromptdexTemplateInput> {
  if (text.trim() === "") {
    throw new Error("「输入声明JSON」为空。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("「输入声明JSON」不是有效 JSON。");
  }
  if (!isObject(parsed)) {
    throw new Error("「输入声明JSON」必须是对象。");
  }
  return parsed as Record<string, PromptdexTemplateInput>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
