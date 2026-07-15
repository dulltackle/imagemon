import type { SQLiteDatabase } from "expo-sqlite";

export const APPLICATION_DATABASE_NAME = "imagemon.db";
export const APP_SETTINGS_ID = "app";
export const CURRENT_SCHEMA_VERSION = 9;
const SCHEMA_VERSION_WITHOUT_CONFIGURATION_NAMES = 2;
const SCHEMA_VERSION_WITH_IMAGE_TASKS = 3;
const SCHEMA_VERSION_WITH_EDIT_TASKS = 4;
const SCHEMA_VERSION_WITH_PERSONAL_PROMPTDEX_ENTRIES = 5;
export const SCHEMA_VERSION_WITH_TEMPLATE_REFINEMENT_DRAFTS = 6;
export const SCHEMA_VERSION_WITH_APPLICATION_DEFAULT_IMAGE_SPEC = 7;
const SCHEMA_VERSION_WITH_BUSINESS_CALL_ATTENTIONS = 8;

export type StorageValue = string | number | boolean | null;

export interface ApplicationDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: StorageValue[]): Promise<unknown>;
  getFirstAsync<T>(source: string, ...params: StorageValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: StorageValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export type StorageInitializationResult =
  | {
      status: "ready";
      db: ApplicationDatabase;
    }
  | {
      status: "failed";
      error: Error;
    };

interface InitializeApplicationStorageOptions {
  databaseName?: string;
  now?: () => string;
  openDatabase?: (databaseName: string) => Promise<ApplicationDatabase>;
}

export async function openApplicationDatabase(
  databaseName = APPLICATION_DATABASE_NAME,
): Promise<ApplicationDatabase> {
  const sqlite = await import("expo-sqlite");
  return sqlite.openDatabaseAsync(databaseName) as Promise<SQLiteDatabase>;
}

export async function initializeApplicationStorage(
  options: InitializeApplicationStorageOptions = {},
): Promise<StorageInitializationResult> {
  const databaseName = options.databaseName ?? APPLICATION_DATABASE_NAME;
  const now = options.now ?? createUtcTimestamp;
  const openDatabase = options.openDatabase ?? openApplicationDatabase;

  try {
    const db = await openDatabase(databaseName);
    await initializeSchema(db, now);
    return { status: "ready", db };
  } catch (error) {
    return {
      status: "failed",
      error: normalizeStorageError(error),
    };
  }
}

export function assertStorageReady(
  result: StorageInitializationResult,
): asserts result is Extract<StorageInitializationResult, { status: "ready" }> {
  if (result.status !== "ready") {
    throw result.error;
  }
}

async function initializeSchema(
  db: ApplicationDatabase,
  now: () => string,
): Promise<void> {
  await enableForeignKeys(db);
  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const migrations = await db.getAllAsync<SchemaMigrationRow>(`
      SELECT version
      FROM schema_migrations
      ORDER BY version ASC
    `);
    let appliedVersion = migrations.reduce(
      (highest, migration) => Math.max(highest, migration.version),
      0,
    );

    if (appliedVersion === 0) {
      await createSchemaV9(db);
      const appliedAt = now();
      await insertSchemaVersion(db, CURRENT_SCHEMA_VERSION, appliedAt);
      await insertDefaultSettings(db, appliedAt);
      return;
    }

    if (appliedVersion < SCHEMA_VERSION_WITHOUT_CONFIGURATION_NAMES) {
      await migrateSchemaV1ToV2(db, now());
      appliedVersion = SCHEMA_VERSION_WITHOUT_CONFIGURATION_NAMES;
    }

    if (appliedVersion < SCHEMA_VERSION_WITH_IMAGE_TASKS) {
      await migrateSchemaV2ToV3(db, now());
      appliedVersion = SCHEMA_VERSION_WITH_IMAGE_TASKS;
    }

    if (appliedVersion < SCHEMA_VERSION_WITH_EDIT_TASKS) {
      await migrateSchemaV3ToV4(db, now());
      appliedVersion = SCHEMA_VERSION_WITH_EDIT_TASKS;
    }

    if (appliedVersion < SCHEMA_VERSION_WITH_PERSONAL_PROMPTDEX_ENTRIES) {
      await migrateSchemaV4ToV5(db, now());
      appliedVersion = SCHEMA_VERSION_WITH_PERSONAL_PROMPTDEX_ENTRIES;
    }

    if (appliedVersion < SCHEMA_VERSION_WITH_TEMPLATE_REFINEMENT_DRAFTS) {
      await migrateSchemaV5ToV6(db, now());
      appliedVersion = SCHEMA_VERSION_WITH_TEMPLATE_REFINEMENT_DRAFTS;
    }

    if (appliedVersion < SCHEMA_VERSION_WITH_APPLICATION_DEFAULT_IMAGE_SPEC) {
      await migrateSchemaV6ToV7(db, now());
      appliedVersion = SCHEMA_VERSION_WITH_APPLICATION_DEFAULT_IMAGE_SPEC;
    }

    if (appliedVersion < SCHEMA_VERSION_WITH_BUSINESS_CALL_ATTENTIONS) {
      await migrateSchemaV7ToV8(db);
      appliedVersion = SCHEMA_VERSION_WITH_BUSINESS_CALL_ATTENTIONS;
    }

    if (appliedVersion < CURRENT_SCHEMA_VERSION) {
      await migrateSchemaV8ToV9(db, now());
    }

    await createSchemaV9(db);
    await insertDefaultSettings(db, now());
  });
}

async function enableForeignKeys(db: ApplicationDatabase): Promise<void> {
  await db.execAsync("PRAGMA foreign_keys = ON;");
  const state = await db.getFirstAsync<{ foreign_keys: number }>(
    "PRAGMA foreign_keys;",
  );
  if (state?.foreign_keys !== 1) {
    throw new Error("无法启用 SQLite 外键约束。");
  }
}

async function createSchemaV9(db: ApplicationDatabase): Promise<void> {
  await createBaseSchemaV9(db);
  await createBusinessCallAttentionsTable(db);
}

async function createBaseSchemaV9(db: ApplicationDatabase): Promise<void> {
  await db.execAsync(`
      CREATE TABLE IF NOT EXISTS model_configurations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('image', 'text')),
        base_url TEXT NOT NULL,
        model_name TEXT NOT NULL,
        has_credential INTEGER NOT NULL CHECK (has_credential IN (0, 1)),
        is_ready INTEGER NOT NULL CHECK (is_ready IN (0, 1)),
        last_test_succeeded_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        id TEXT PRIMARY KEY CHECK (id = 'app'),
        default_image_model_configuration_id TEXT,
        default_text_model_configuration_id TEXT,
        first_run_setup_completed_at TEXT,
        default_image_size TEXT NOT NULL DEFAULT '1024x1024',
        default_image_quality TEXT NOT NULL DEFAULT 'auto',
        default_image_format TEXT NOT NULL DEFAULT 'png',
        default_image_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (default_image_model_configuration_id)
          REFERENCES model_configurations(id) ON DELETE SET NULL,
        FOREIGN KEY (default_text_model_configuration_id)
          REFERENCES model_configurations(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS image_task_histories (
        id TEXT PRIMARY KEY,
        task_type TEXT NOT NULL CHECK (task_type IN ('generate', 'edit')),
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'unknown')),
        snapshot_json TEXT NOT NULL,
        error_summary_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS image_results (
        id TEXT PRIMARY KEY,
        task_history_id TEXT,
        file_path TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('png', 'jpeg', 'webp')),
        width INTEGER,
        height INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_history_id)
          REFERENCES image_task_histories(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS image_task_histories_created_at_idx
        ON image_task_histories(created_at DESC);

      CREATE INDEX IF NOT EXISTS image_results_created_at_idx
        ON image_results(created_at DESC);

      CREATE INDEX IF NOT EXISTS image_results_task_history_id_idx
        ON image_results(task_history_id);
    `);

  await createPersonalPromptdexEntriesTable(db);
  await createTemplateRefinementDraftsTable(db);
}

async function migrateSchemaV1ToV2(
  db: ApplicationDatabase,
  appliedAt: string,
): Promise<void> {
  await db.execAsync(`
    CREATE TABLE model_configurations_v2 (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('image', 'text')),
      base_url TEXT NOT NULL,
      model_name TEXT NOT NULL,
      has_credential INTEGER NOT NULL CHECK (has_credential IN (0, 1)),
      is_ready INTEGER NOT NULL CHECK (is_ready IN (0, 1)),
      last_test_succeeded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO model_configurations_v2 (
      id,
      type,
      base_url,
      model_name,
      has_credential,
      is_ready,
      last_test_succeeded_at,
      created_at,
      updated_at
    )
    SELECT
      id,
      type,
      base_url,
      model_name,
      has_credential,
      is_ready,
      last_test_succeeded_at,
      created_at,
      updated_at
    FROM model_configurations;

    CREATE TABLE app_settings_v2 (
      id TEXT PRIMARY KEY CHECK (id = 'app'),
      default_image_model_configuration_id TEXT,
      default_text_model_configuration_id TEXT,
      first_run_setup_completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO app_settings_v2 (
      id,
      default_image_model_configuration_id,
      default_text_model_configuration_id,
      first_run_setup_completed_at,
      created_at,
      updated_at
    )
    SELECT
      id,
      default_image_model_configuration_id,
      default_text_model_configuration_id,
      first_run_setup_completed_at,
      created_at,
      updated_at
    FROM app_settings;

    DROP TABLE app_settings;
    DROP TABLE model_configurations;
    ALTER TABLE model_configurations_v2 RENAME TO model_configurations;

    CREATE TABLE app_settings (
      id TEXT PRIMARY KEY CHECK (id = 'app'),
      default_image_model_configuration_id TEXT,
      default_text_model_configuration_id TEXT,
      first_run_setup_completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (default_image_model_configuration_id)
        REFERENCES model_configurations(id) ON DELETE SET NULL,
      FOREIGN KEY (default_text_model_configuration_id)
        REFERENCES model_configurations(id) ON DELETE SET NULL
    );

    INSERT INTO app_settings (
      id,
      default_image_model_configuration_id,
      default_text_model_configuration_id,
      first_run_setup_completed_at,
      created_at,
      updated_at
    )
    SELECT
      id,
      default_image_model_configuration_id,
      default_text_model_configuration_id,
      first_run_setup_completed_at,
      created_at,
      updated_at
    FROM app_settings_v2;

    DROP TABLE app_settings_v2;
  `);

  await insertSchemaVersion(
    db,
    SCHEMA_VERSION_WITHOUT_CONFIGURATION_NAMES,
    appliedAt,
  );
}

async function migrateSchemaV2ToV3(
  db: ApplicationDatabase,
  appliedAt: string,
): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS image_task_histories (
      id TEXT PRIMARY KEY,
      task_type TEXT NOT NULL CHECK (task_type IN ('generate')),
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'unknown')),
      snapshot_json TEXT NOT NULL,
      error_summary_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS image_results (
      id TEXT PRIMARY KEY,
      task_history_id TEXT,
      file_path TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('png')),
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_history_id)
        REFERENCES image_task_histories(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS image_task_histories_created_at_idx
      ON image_task_histories(created_at DESC);

    CREATE INDEX IF NOT EXISTS image_results_created_at_idx
      ON image_results(created_at DESC);

    CREATE INDEX IF NOT EXISTS image_results_task_history_id_idx
      ON image_results(task_history_id);
  `);

  await insertSchemaVersion(db, SCHEMA_VERSION_WITH_IMAGE_TASKS, appliedAt);
}

async function migrateSchemaV3ToV4(
  db: ApplicationDatabase,
  appliedAt: string,
): Promise<void> {
  await db.execAsync(`
    CREATE TABLE image_task_histories_v4 (
      id TEXT PRIMARY KEY,
      task_type TEXT NOT NULL CHECK (task_type IN ('generate', 'edit')),
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'unknown')),
      snapshot_json TEXT NOT NULL,
      error_summary_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    INSERT INTO image_task_histories_v4 (
      id,
      task_type,
      status,
      snapshot_json,
      error_summary_json,
      created_at,
      updated_at,
      completed_at
    )
    SELECT
      id,
      task_type,
      status,
      snapshot_json,
      error_summary_json,
      created_at,
      updated_at,
      completed_at
    FROM image_task_histories;

    CREATE TABLE image_results_v4 (
      id TEXT PRIMARY KEY,
      task_history_id TEXT,
      file_path TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('png')),
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_history_id)
        REFERENCES image_task_histories_v4(id) ON DELETE SET NULL
    );

    INSERT INTO image_results_v4 (
      id,
      task_history_id,
      file_path,
      format,
      width,
      height,
      created_at
    )
    SELECT
      id,
      task_history_id,
      file_path,
      format,
      width,
      height,
      created_at
    FROM image_results;

    DROP TABLE image_results;
    DROP TABLE image_task_histories;
    ALTER TABLE image_task_histories_v4 RENAME TO image_task_histories;
    ALTER TABLE image_results_v4 RENAME TO image_results;

    CREATE INDEX IF NOT EXISTS image_task_histories_created_at_idx
      ON image_task_histories(created_at DESC);

    CREATE INDEX IF NOT EXISTS image_results_created_at_idx
      ON image_results(created_at DESC);

    CREATE INDEX IF NOT EXISTS image_results_task_history_id_idx
      ON image_results(task_history_id);
  `);

  await insertSchemaVersion(db, SCHEMA_VERSION_WITH_EDIT_TASKS, appliedAt);
}

async function migrateSchemaV4ToV5(
  db: ApplicationDatabase,
  appliedAt: string,
): Promise<void> {
  await createPersonalPromptdexEntriesTable(db);
  await insertSchemaVersion(
    db,
    SCHEMA_VERSION_WITH_PERSONAL_PROMPTDEX_ENTRIES,
    appliedAt,
  );
}

async function migrateSchemaV5ToV6(
  db: ApplicationDatabase,
  appliedAt: string,
): Promise<void> {
  await createTemplateRefinementDraftsTable(db);
  await insertSchemaVersion(
    db,
    SCHEMA_VERSION_WITH_TEMPLATE_REFINEMENT_DRAFTS,
    appliedAt,
  );
}

async function migrateSchemaV6ToV7(
  db: ApplicationDatabase,
  appliedAt: string,
): Promise<void> {
  await addApplicationDefaultImageSpecColumns(db);
  await insertSchemaVersion(
    db,
    SCHEMA_VERSION_WITH_APPLICATION_DEFAULT_IMAGE_SPEC,
    appliedAt,
  );
}

async function migrateSchemaV7ToV8(db: ApplicationDatabase): Promise<void> {
  await createBusinessCallAttentionsTable(db);
}

async function migrateSchemaV8ToV9(
  db: ApplicationDatabase,
  appliedAt: string,
): Promise<void> {
  await db.execAsync(`
    CREATE TABLE image_results_v9 (
      id TEXT PRIMARY KEY,
      task_history_id TEXT,
      file_path TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('png', 'jpeg', 'webp')),
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_history_id)
        REFERENCES image_task_histories(id) ON DELETE SET NULL
    );

    INSERT INTO image_results_v9 (
      id,
      task_history_id,
      file_path,
      format,
      width,
      height,
      created_at
    )
    SELECT
      id,
      task_history_id,
      file_path,
      format,
      width,
      height,
      created_at
    FROM image_results;

    DROP TABLE image_results;
    ALTER TABLE image_results_v9 RENAME TO image_results;

    CREATE INDEX IF NOT EXISTS image_results_created_at_idx
      ON image_results(created_at DESC);

    CREATE INDEX IF NOT EXISTS image_results_task_history_id_idx
      ON image_results(task_history_id);
  `);

  await insertSchemaVersion(db, CURRENT_SCHEMA_VERSION, appliedAt);
}

async function addApplicationDefaultImageSpecColumns(
  db: ApplicationDatabase,
): Promise<void> {
  await db.execAsync(`
    ALTER TABLE app_settings ADD COLUMN default_image_size TEXT NOT NULL DEFAULT '1024x1024';
    ALTER TABLE app_settings ADD COLUMN default_image_quality TEXT NOT NULL DEFAULT 'auto';
    ALTER TABLE app_settings ADD COLUMN default_image_format TEXT NOT NULL DEFAULT 'png';
    ALTER TABLE app_settings ADD COLUMN default_image_count INTEGER NOT NULL DEFAULT 1;
  `);
}

async function createPersonalPromptdexEntriesTable(
  db: ApplicationDatabase,
): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS personal_promptdex_entries (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      version_json TEXT,
      inputs_json TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

async function createTemplateRefinementDraftsTable(
  db: ApplicationDatabase,
): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS template_refinement_drafts (
      id TEXT PRIMARY KEY CHECK (id = 'template_refinement'),
      status TEXT NOT NULL CHECK (status IN ('editing_input', 'generating', 'ready_for_review', 'failed')),
      external_prompt TEXT NOT NULL,
      planned_use TEXT NOT NULL,
      proposal_json TEXT,
      error_summary_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

async function createBusinessCallAttentionsTable(
  db: ApplicationDatabase,
): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS business_call_attentions (
      subject_type TEXT NOT NULL CHECK (subject_type IN ('image_task', 'template_refinement')),
      subject_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('succeeded', 'failed', 'uncertain')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (subject_type, subject_id)
    );
  `);
}

async function insertSchemaVersion(
  db: ApplicationDatabase,
  version: number,
  appliedAt: string,
): Promise<void> {
  await db.runAsync(
      `
        INSERT OR IGNORE INTO schema_migrations (version, applied_at)
        VALUES (?, ?)
      `,
      version,
      appliedAt,
  );
}

async function insertDefaultSettings(
  db: ApplicationDatabase,
  appliedAt: string,
): Promise<void> {
  await db.runAsync(
      `
        INSERT OR IGNORE INTO app_settings (id, created_at, updated_at)
        VALUES (?, ?, ?)
      `,
      APP_SETTINGS_ID,
      appliedAt,
      appliedAt,
  );
}

interface SchemaMigrationRow {
  version: number;
}

export function createUtcTimestamp(): string {
  return new Date().toISOString();
}

export * from "./credentials";
export * from "./ids";

function normalizeStorageError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
