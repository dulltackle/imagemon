import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initializeApplicationStorage } from "./index";
import {
  SCHEMA_V8_FIXTURE_HISTORY_ID,
  SCHEMA_V8_FIXTURE_LINKED_RESULT_ID,
  SCHEMA_V8_RELEASE_FIXTURE_SQL,
} from "./schema-v8.test-fixture";
import {
  createSqlJsApplicationDatabase,
  type SqlJsApplicationDatabase,
} from "./sql-js.test-support";

interface SchemaMigrationRow {
  version: number;
  applied_at: string;
}

interface ImageResultRow {
  id: string;
  task_history_id: string | null;
  file_path: string;
  format: string;
  width: number | null;
  height: number | null;
  created_at: string;
}

describe("schema v8 到 v9 真实 SQLite 迁移", () => {
  let db: SqlJsApplicationDatabase | undefined;

  beforeEach(async () => {
    db = await createSqlJsApplicationDatabase();
    await db.execAsync(SCHEMA_V8_RELEASE_FIXTURE_SQL);
  });

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("从发布版 v8 迁移到 v9 时保留旧结果并开放 JPEG/WebP", async () => {
    const database = requireDatabase(db);
    const oldImageResults = await listImageResults(database);

    await expect(
      insertImageResult(database, {
        id: "v8-rejected-jpeg",
        format: "jpeg",
        filePath: "image-results/v8-rejected.jpeg",
        createdAt: "2026-07-15T00:00:00.000Z",
      }),
    ).rejects.toThrow(/CHECK constraint failed/);

    const initialized = await initializeApplicationStorage({
      now: () => "2026-07-15T01:00:00.000Z",
      openDatabase: async () => database,
    });

    expect(initialized.status).toBe("ready");
    expect(await listSchemaMigrations(database)).toEqual([
      { version: 8, applied_at: "2026-07-13T00:00:00.000Z" },
      { version: 9, applied_at: "2026-07-15T01:00:00.000Z" },
    ]);
    expect(await listImageResults(database)).toEqual(oldImageResults);
    expect(oldImageResults).toHaveLength(2);
    expect(oldImageResults[1]).toMatchObject({
      task_history_id: null,
      width: null,
      height: null,
    });
    await expect(listImageResultTableNames(database)).resolves.toEqual([
      "image_results",
    ]);

    await expect(
      insertImageResult(database, {
        id: "v9-jpeg",
        format: "jpeg",
        filePath: "image-results/v9.jpeg",
        createdAt: "2026-07-15T02:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
    await expect(
      insertImageResult(database, {
        id: "v9-webp",
        format: "webp",
        filePath: "image-results/v9.webp",
        createdAt: "2026-07-15T02:01:00.000Z",
      }),
    ).resolves.toBeUndefined();
    await expect(
      insertImageResult(database, {
        id: "v9-rejected-gif",
        format: "gif",
        filePath: "image-results/v9.gif",
        createdAt: "2026-07-15T02:02:00.000Z",
      }),
    ).rejects.toThrow(/CHECK constraint failed/);

    await expect(listImageResultIndexes(database)).resolves.toEqual({
      image_results_created_at_idx: ["created_at"],
      image_results_task_history_id_idx: ["task_history_id"],
    });
    await expect(
      database.getAllAsync<{
        table: string;
        from: string;
        to: string;
        on_delete: string;
      }>("PRAGMA foreign_key_list('image_results');"),
    ).resolves.toEqual([
      expect.objectContaining({
        table: "image_task_histories",
        from: "task_history_id",
        to: "id",
        on_delete: "SET NULL",
      }),
    ]);

    await database.runAsync(
      "DELETE FROM image_task_histories WHERE id = ?",
      SCHEMA_V8_FIXTURE_HISTORY_ID,
    );
    await expect(
      database.getFirstAsync<{ task_history_id: string | null }>(
        "SELECT task_history_id FROM image_results WHERE id = ?",
        SCHEMA_V8_FIXTURE_LINKED_RESULT_ID,
      ),
    ).resolves.toEqual({ task_history_id: null });

    const migrationsBeforeSecondInitialization =
      await listSchemaMigrations(database);
    const resultsBeforeSecondInitialization = await listImageResults(database);
    const secondInitialization = await initializeApplicationStorage({
      now: () => "2026-07-15T03:00:00.000Z",
      openDatabase: async () => database,
    });

    expect(secondInitialization.status).toBe("ready");
    expect(await listSchemaMigrations(database)).toEqual(
      migrationsBeforeSecondInitialization,
    );
    expect(await listImageResults(database)).toEqual(
      resultsBeforeSecondInitialization,
    );
    expect(
      (await listSchemaMigrations(database)).filter(({ version }) => version === 9),
    ).toHaveLength(1);
  });

  it("v8→v9 写版本失败时原子回滚并可重试", async () => {
    const database = requireDatabase(db);
    const oldImageResults = await listImageResults(database);
    await database.execAsync(`
      CREATE TRIGGER fail_schema_v9_version_insert
      BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 9
      BEGIN
        SELECT RAISE(ABORT, 'forced schema v9 migration failure');
      END;
    `);

    const failedInitialization = await initializeApplicationStorage({
      now: () => "2026-07-15T04:00:00.000Z",
      openDatabase: async () => database,
    });

    expect(failedInitialization.status).toBe("failed");
    expect(await listSchemaMigrations(database)).toEqual([
      { version: 8, applied_at: "2026-07-13T00:00:00.000Z" },
    ]);
    expect(await listImageResults(database)).toEqual(oldImageResults);
    await expect(listImageResultTableNames(database)).resolves.toEqual([
      "image_results",
    ]);
    await expect(
      database.getFirstAsync<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'image_results'",
      ),
    ).resolves.toEqual({
      sql: expect.stringContaining("format IN ('png')"),
    });
    await expect(
      insertImageResult(database, {
        id: "rollback-rejected-jpeg",
        format: "jpeg",
        filePath: "image-results/rollback-rejected.jpeg",
        createdAt: "2026-07-15T04:01:00.000Z",
      }),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(listImageResultIndexes(database)).resolves.toEqual({
      image_results_created_at_idx: ["created_at"],
      image_results_task_history_id_idx: ["task_history_id"],
    });

    await database.execAsync("DROP TRIGGER fail_schema_v9_version_insert;");
    const retry = await initializeApplicationStorage({
      now: () => "2026-07-15T05:00:00.000Z",
      openDatabase: async () => database,
    });

    expect(retry.status).toBe("ready");
    expect(await listSchemaMigrations(database)).toEqual([
      { version: 8, applied_at: "2026-07-13T00:00:00.000Z" },
      { version: 9, applied_at: "2026-07-15T05:00:00.000Z" },
    ]);
    expect(await listImageResults(database)).toEqual(oldImageResults);
    await expect(
      insertImageResult(database, {
        id: "retry-webp",
        format: "webp",
        filePath: "image-results/retry.webp",
        createdAt: "2026-07-15T05:01:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });
});

function requireDatabase(
  database: SqlJsApplicationDatabase | undefined,
): SqlJsApplicationDatabase {
  if (!database) {
    throw new Error("sql.js 测试数据库尚未初始化");
  }
  return database;
}

async function listSchemaMigrations(
  database: SqlJsApplicationDatabase,
): Promise<SchemaMigrationRow[]> {
  return database.getAllAsync<SchemaMigrationRow>(`
    SELECT version, applied_at
    FROM schema_migrations
    ORDER BY version ASC
  `);
}

async function listImageResults(
  database: SqlJsApplicationDatabase,
): Promise<ImageResultRow[]> {
  return database.getAllAsync<ImageResultRow>(`
    SELECT
      id,
      task_history_id,
      file_path,
      format,
      width,
      height,
      created_at
    FROM image_results
    ORDER BY created_at ASC, id ASC
  `);
}

async function listImageResultTableNames(
  database: SqlJsApplicationDatabase,
): Promise<string[]> {
  const rows = await database.getAllAsync<{ name: string }>(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('image_results', 'image_results_v9')
    ORDER BY name ASC
  `);
  return rows.map(({ name }) => name);
}

async function listImageResultIndexes(
  database: SqlJsApplicationDatabase,
): Promise<Record<string, string[]>> {
  const indexNames = [
    "image_results_created_at_idx",
    "image_results_task_history_id_idx",
  ] as const;
  return Object.fromEntries(
    await Promise.all(
      indexNames.map(async (indexName) => {
        const columns = await database.getAllAsync<{ name: string }>(
          `PRAGMA index_info('${indexName}');`,
        );
        return [indexName, columns.map(({ name }) => name)] as const;
      }),
    ),
  );
}

async function insertImageResult(
  database: SqlJsApplicationDatabase,
  input: {
    id: string;
    format: string;
    filePath: string;
    createdAt: string;
  },
): Promise<void> {
  await database.runAsync(
    `
      INSERT INTO image_results (
        id,
        task_history_id,
        file_path,
        format,
        width,
        height,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    input.id,
    null,
    input.filePath,
    input.format,
    1024,
    1024,
    input.createdAt,
  );
}
