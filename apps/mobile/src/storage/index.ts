import type { SQLiteDatabase } from "expo-sqlite";

export const APPLICATION_DATABASE_NAME = "imagemon.db";
export const APP_SETTINGS_ID = "app";
export const CURRENT_SCHEMA_VERSION = 3;
const SCHEMA_VERSION_WITHOUT_CONFIGURATION_NAMES = 2;

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
  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      PRAGMA foreign_keys = ON;

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
    const appliedVersions = new Set(
      migrations.map((migration) => migration.version),
    );

    if (appliedVersions.size === 0) {
      await createSchemaV3(db);
      const appliedAt = now();
      await insertSchemaVersion(db, CURRENT_SCHEMA_VERSION, appliedAt);
      await insertDefaultSettings(db, appliedAt);
      return;
    }

    if (
      appliedVersions.has(1) &&
      !appliedVersions.has(SCHEMA_VERSION_WITHOUT_CONFIGURATION_NAMES)
    ) {
      await migrateSchemaV1ToV2(db, now());
      appliedVersions.add(SCHEMA_VERSION_WITHOUT_CONFIGURATION_NAMES);
    }

    if (!appliedVersions.has(CURRENT_SCHEMA_VERSION)) {
      await migrateSchemaV2ToV3(db, now());
      appliedVersions.add(CURRENT_SCHEMA_VERSION);
    }

    await createSchemaV3(db);
    await insertDefaultSettings(db, now());
  });
}

async function createSchemaV3(db: ApplicationDatabase): Promise<void> {
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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (default_image_model_configuration_id)
          REFERENCES model_configurations(id) ON DELETE SET NULL,
        FOREIGN KEY (default_text_model_configuration_id)
          REFERENCES model_configurations(id) ON DELETE SET NULL
      );

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

  await insertSchemaVersion(db, CURRENT_SCHEMA_VERSION, appliedAt);
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
