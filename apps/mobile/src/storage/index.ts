import type { SQLiteDatabase } from "expo-sqlite";

export const APPLICATION_DATABASE_NAME = "imagemon.db";
export const APP_SETTINGS_ID = "app";
export const CURRENT_SCHEMA_VERSION = 1;

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
    await initializeSchemaV1(db, now);
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

async function initializeSchemaV1(
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

      CREATE TABLE IF NOT EXISTS model_configurations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('image', 'text')),
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model_name TEXT NOT NULL,
        has_credential INTEGER NOT NULL CHECK (has_credential IN (0, 1)),
        is_ready INTEGER NOT NULL CHECK (is_ready IN (0, 1)),
        last_test_succeeded_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (type, name)
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
    `);

    const appliedAt = now();
    await db.runAsync(
      `
        INSERT OR IGNORE INTO schema_migrations (version, applied_at)
        VALUES (?, ?)
      `,
      CURRENT_SCHEMA_VERSION,
      appliedAt,
    );
    await db.runAsync(
      `
        INSERT OR IGNORE INTO app_settings (id, created_at, updated_at)
        VALUES (?, ?, ?)
      `,
      APP_SETTINGS_ID,
      appliedAt,
      appliedAt,
    );
  });
}

export function createUtcTimestamp(): string {
  return new Date().toISOString();
}

function normalizeStorageError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
