import {
  validatePromptdexTemplate,
  type PromptdexTemplate,
  type PromptdexTemplateInput,
} from "@imagemon/core";

import {
  type ApplicationDatabase,
  createUtcTimestamp,
} from "../storage";

export type PersonalPromptdexEntryRepositoryErrorCode =
  | "duplicate_name"
  | "not_found"
  | "validation_failed";

export class PersonalPromptdexEntryRepositoryError extends Error {
  constructor(
    readonly code: PersonalPromptdexEntryRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PersonalPromptdexEntryRepositoryError";
  }
}

export interface PersonalPromptdexEntry extends PromptdexTemplate {
  sourceType: "personal";
  createdAt: string;
  updatedAt: string;
}

/** 表格恢复写入项：模板 + 沿用表格记录的时间戳（灾备保真）。 */
export interface RestorePromptdexEntryInput {
  template: PromptdexTemplate;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalPromptdexEntryRepository {
  list(): Promise<PersonalPromptdexEntry[]>;
  get(name: string): Promise<PersonalPromptdexEntry | null>;
  saveFromTemplate(template: PromptdexTemplate): Promise<PersonalPromptdexEntry>;
  delete(name: string): Promise<void>;
  /**
   * 表格恢复专用：单事务批量写入，同名覆盖（delete + insert）、本机独有保留、
   * 时间戳沿用入参。刻意独立于 saveFromTemplate，不放宽其 duplicate_name 校验。
   */
  replaceFromRestore(entries: RestorePromptdexEntryInput[]): Promise<void>;
}

export interface PersonalPromptdexEntryStore {
  withTransaction<T>(task: () => Promise<T>): Promise<T>;
  listEntries(): Promise<PersonalPromptdexEntryRecord[]>;
  getEntry(name: string): Promise<PersonalPromptdexEntryRecord | null>;
  insertEntry(entry: PersonalPromptdexEntryRecord): Promise<void>;
  deleteEntry(name: string): Promise<void>;
}

interface PersonalPromptdexEntryRecord {
  name: string;
  description: string;
  version: string | boolean | null;
  inputs: Record<string, PromptdexTemplateInput>;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface CreatePersonalPromptdexEntryRepositoryOptions {
  store: PersonalPromptdexEntryStore;
  now?: () => string;
}

interface CreateSqlitePersonalPromptdexEntryRepositoryOptions {
  db: ApplicationDatabase;
  now?: () => string;
}

export function createPersonalPromptdexEntryRepository({
  store,
  now = createUtcTimestamp,
}: CreatePersonalPromptdexEntryRepositoryOptions): PersonalPromptdexEntryRepository {
  return {
    async list() {
      const records = await store.listEntries();
      return records.map(recordToPersonalPromptdexEntry);
    },

    async get(name) {
      const record = await store.getEntry(name);
      return record ? recordToPersonalPromptdexEntry(record) : null;
    },

    async saveFromTemplate(template) {
      const validated = validatePersonalPromptdexTemplate(template);
      return store.withTransaction(async () => {
        const existing = await store.getEntry(validated.name);
        if (existing) {
          throw new PersonalPromptdexEntryRepositoryError(
            "duplicate_name",
            "个人图鉴条目名称已存在。",
          );
        }

        const timestamp = now();
        const record = templateToRecord(validated, timestamp, timestamp);
        await store.insertEntry(record);
        return recordToPersonalPromptdexEntry(record);
      });
    },

    async delete(name) {
      const existing = await store.getEntry(name);
      if (!existing) {
        throw new PersonalPromptdexEntryRepositoryError(
          "not_found",
          "个人图鉴条目不存在。",
        );
      }
      await store.deleteEntry(name);
    },

    async replaceFromRestore(entries) {
      const records = entries.map((entry) => {
        const validated = validatePersonalPromptdexTemplate(entry.template);
        return templateToRecord(validated, entry.createdAt, entry.updatedAt);
      });
      await store.withTransaction(async () => {
        for (const record of records) {
          // 同名覆盖：先删后插，本机独有条目不在入参中因此不受影响。
          await store.deleteEntry(record.name);
          await store.insertEntry(record);
        }
      });
    },
  };
}

export function createSqlitePersonalPromptdexEntryRepository({
  db,
  now,
}: CreateSqlitePersonalPromptdexEntryRepositoryOptions): PersonalPromptdexEntryRepository {
  return createPersonalPromptdexEntryRepository({
    store: createSqlitePersonalPromptdexEntryStore(db),
    now,
  });
}

export function createMemoryPersonalPromptdexEntryStore(): PersonalPromptdexEntryStore {
  let entries = new Map<string, PersonalPromptdexEntryRecord>();

  return {
    async withTransaction(task) {
      const snapshot = cloneEntryMap(entries);
      try {
        return await task();
      } catch (error) {
        entries = snapshot;
        throw error;
      }
    },

    async listEntries() {
      return [...entries.values()]
        .map(cloneRecord)
        .sort(compareNameAscending);
    },

    async getEntry(name) {
      const entry = entries.get(name);
      return entry ? cloneRecord(entry) : null;
    },

    async insertEntry(entry) {
      entries.set(entry.name, cloneRecord(entry));
    },

    async deleteEntry(name) {
      entries.delete(name);
    },
  };
}

export function createSqlitePersonalPromptdexEntryStore(
  db: ApplicationDatabase,
): PersonalPromptdexEntryStore {
  return {
    async withTransaction(task) {
      let result: Awaited<ReturnType<typeof task>> | undefined;
      await db.withTransactionAsync(async () => {
        result = await task();
      });
      return result as Awaited<ReturnType<typeof task>>;
    },

    async listEntries() {
      const rows = await db.getAllAsync<PersonalPromptdexEntryRow>(`
        SELECT *
        FROM personal_promptdex_entries
        ORDER BY name ASC
      `);
      return rows.map(mapRowToRecord);
    },

    async getEntry(name) {
      const row = await db.getFirstAsync<PersonalPromptdexEntryRow>(
        `
          SELECT *
          FROM personal_promptdex_entries
          WHERE name = ?
        `,
        name,
      );
      return row ? mapRowToRecord(row) : null;
    },

    async insertEntry(entry) {
      await db.runAsync(
        `
          INSERT INTO personal_promptdex_entries (
            name,
            description,
            version_json,
            inputs_json,
            body,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        entry.name,
        entry.description,
        entry.version === null ? null : JSON.stringify(entry.version),
        JSON.stringify(entry.inputs),
        entry.body,
        entry.createdAt,
        entry.updatedAt,
      );
    },

    async deleteEntry(name) {
      await db.runAsync(
        `
          DELETE FROM personal_promptdex_entries
          WHERE name = ?
        `,
        name,
      );
    },
  };
}

function validatePersonalPromptdexTemplate(
  template: PromptdexTemplate,
): PromptdexTemplate {
  try {
    if (
      Object.hasOwn(template, "version") &&
      typeof template.version !== "string" &&
      typeof template.version !== "boolean"
    ) {
      throw new Error("version 必须是字符串或布尔值。");
    }

    return validatePromptdexTemplate(
      {
        name: template.name,
        description: template.description,
        ...(Object.hasOwn(template, "version")
          ? { version: template.version }
          : {}),
        inputs: template.inputs,
        body: template.body,
        fileName: template.fileName,
      },
      template.fileName,
    );
  } catch (error) {
    throw new PersonalPromptdexEntryRepositoryError(
      "validation_failed",
      error instanceof Error ? error.message : "个人图鉴条目校验失败。",
    );
  }
}

function recordToPersonalPromptdexEntry(
  record: PersonalPromptdexEntryRecord,
): PersonalPromptdexEntry {
  const template = validatePersonalPromptdexTemplate({
    name: record.name,
    description: record.description,
    ...(record.version !== null ? { version: record.version } : {}),
    inputs: record.inputs,
    body: record.body,
    fileName: `${record.name}.md`,
    taskType: "generate",
  });

  return {
    ...template,
    sourceType: "personal",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function templateToRecord(
  template: PromptdexTemplate,
  createdAt: string,
  updatedAt: string,
): PersonalPromptdexEntryRecord {
  return {
    name: template.name,
    description: template.description,
    version: Object.hasOwn(template, "version") ? template.version ?? null : null,
    inputs: cloneInputs(template.inputs),
    body: template.body,
    createdAt,
    updatedAt,
  };
}

function mapRowToRecord(row: PersonalPromptdexEntryRow): PersonalPromptdexEntryRecord {
  const version = row.version_json
    ? parseJsonField<unknown>(row.version_json, "version_json")
    : null;
  if (
    version !== null &&
    typeof version !== "string" &&
    typeof version !== "boolean"
  ) {
    throw new Error("version_json 不是有效 Promptdex 版本。");
  }

  return {
    name: row.name,
    description: row.description,
    version,
    inputs: parseJsonField<Record<string, PromptdexTemplateInput>>(
      row.inputs_json,
      "inputs_json",
    ),
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJsonField<T>(value: string, fieldName: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`${fieldName} 不是有效 JSON。`, { cause: error });
  }
}

function cloneEntryMap(
  entries: Map<string, PersonalPromptdexEntryRecord>,
): Map<string, PersonalPromptdexEntryRecord> {
  return new Map(
    [...entries.entries()].map(([name, entry]) => [name, cloneRecord(entry)]),
  );
}

function cloneRecord(
  record: PersonalPromptdexEntryRecord,
): PersonalPromptdexEntryRecord {
  return {
    ...record,
    inputs: cloneInputs(record.inputs),
  };
}

function cloneInputs(
  inputs: Record<string, PromptdexTemplateInput>,
): Record<string, PromptdexTemplateInput> {
  return Object.fromEntries(
    Object.entries(inputs).map(([name, input]) => [name, { ...input }]),
  );
}

function compareNameAscending(
  left: Pick<PersonalPromptdexEntryRecord, "name">,
  right: Pick<PersonalPromptdexEntryRecord, "name">,
): number {
  return left.name.localeCompare(right.name);
}

interface PersonalPromptdexEntryRow {
  name: string;
  description: string;
  version_json: string | null;
  inputs_json: string;
  body: string;
  created_at: string;
  updated_at: string;
}
