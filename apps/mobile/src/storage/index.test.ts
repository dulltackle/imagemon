import { describe, expect, it } from "vitest";

import {
  APP_SETTINGS_ID,
  CURRENT_SCHEMA_VERSION,
  type ApplicationDatabase,
  initializeApplicationStorage,
} from "./index";

class FakeApplicationDatabase implements ApplicationDatabase {
  readonly execStatements: string[] = [];
  readonly getAllStatements: string[] = [];
  readonly runStatements: Array<{ source: string; params: unknown[] }> = [];
  migrationRows: Array<{ version: number }> = [];
  transactionCount = 0;

  async execAsync(source: string): Promise<void> {
    this.execStatements.push(source);
  }

  async runAsync(source: string, ...params: unknown[]): Promise<unknown> {
    this.runStatements.push({ source, params });
    return {};
  }

  async getFirstAsync<T>(): Promise<T | null> {
    return null;
  }

  async getAllAsync<T>(source: string): Promise<T[]> {
    this.getAllStatements.push(source);
    return this.migrationRows as T[];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.transactionCount += 1;
    await task();
  }
}

describe("initializeApplicationStorage", () => {
  it("在事务内初始化 schema v5、默认设置行和迁移记录", async () => {
    const db = new FakeApplicationDatabase();
    const result = await initializeApplicationStorage({
      now: () => "2026-06-25T00:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(result.status).toBe("ready");
    expect(db.transactionCount).toBe(1);
    const executedSql = db.execStatements.join("\n");
    expect(executedSql).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
    expect(executedSql).toContain("CREATE TABLE IF NOT EXISTS model_configurations");
    expect(executedSql).toContain("CREATE TABLE IF NOT EXISTS app_settings");
    expect(executedSql).toContain("CREATE TABLE IF NOT EXISTS image_task_histories");
    expect(executedSql).toContain("CREATE TABLE IF NOT EXISTS image_results");
    expect(executedSql).toContain(
      "CREATE TABLE IF NOT EXISTS personal_promptdex_entries",
    );
    expect(executedSql).toContain("version_json TEXT");
    expect(executedSql).toContain("inputs_json TEXT NOT NULL");
    expect(executedSql).toContain(
      "task_type TEXT NOT NULL CHECK (task_type IN ('generate', 'edit'))",
    );
    expect(executedSql).not.toMatch(/^\s*name TEXT NOT NULL\b/m);
    expect(executedSql).not.toContain("UNIQUE (type, name)");
    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [CURRENT_SCHEMA_VERSION, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO app_settings"),
        params: [APP_SETTINGS_ID, "2026-06-25T00:00:00.000Z", "2026-06-25T00:00:00.000Z"],
      },
    ]);
  });

  it("将 v1 模型配置迁移到无名称字段并补齐 v5 schema", async () => {
    const db = new FakeApplicationDatabase();
    db.migrationRows = [{ version: 1 }];

    const result = await initializeApplicationStorage({
      now: () => "2026-06-25T00:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(result.status).toBe("ready");
    const executedSql = db.execStatements.join("\n");
    expect(executedSql).toContain("CREATE TABLE model_configurations_v2");
    expect(executedSql).toContain("INSERT INTO model_configurations_v2");
    expect(executedSql).toContain("CREATE TABLE app_settings_v2");
    expect(executedSql).toContain("default_image_model_configuration_id");
    expect(executedSql).toContain("default_text_model_configuration_id");
    expect(executedSql).toContain("CREATE TABLE IF NOT EXISTS image_task_histories");
    expect(executedSql).toContain("CREATE TABLE IF NOT EXISTS image_results");
    expect(executedSql).toContain("CREATE TABLE image_task_histories_v4");
    expect(executedSql).toContain("CREATE TABLE image_results_v4");
    expect(executedSql).toContain(
      "CREATE TABLE IF NOT EXISTS personal_promptdex_entries",
    );
    expect(executedSql).toContain(
      "task_type TEXT NOT NULL CHECK (task_type IN ('generate', 'edit'))",
    );
    expect(executedSql).not.toMatch(/^\s*name TEXT NOT NULL\b/m);
    expect(executedSql).not.toContain("UNIQUE (type, name)");
    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [2, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [3, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [4, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [CURRENT_SCHEMA_VERSION, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO app_settings"),
        params: [APP_SETTINGS_ID, "2026-06-25T00:00:00.000Z", "2026-06-25T00:00:00.000Z"],
      },
    ]);
  });

  it("将 v2 schema 迁移到包含个人图鉴条目的 v5", async () => {
    const db = new FakeApplicationDatabase();
    db.migrationRows = [{ version: 2 }];

    const result = await initializeApplicationStorage({
      now: () => "2026-06-25T00:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(result.status).toBe("ready");
    const executedSql = db.execStatements.join("\n");
    expect(executedSql).toContain("CREATE TABLE IF NOT EXISTS image_task_histories");
    expect(executedSql).toContain("CREATE TABLE IF NOT EXISTS image_results");
    expect(executedSql).toContain("CREATE TABLE image_task_histories_v4");
    expect(executedSql).toContain("CREATE TABLE image_results_v4");
    expect(executedSql).toContain(
      "CREATE TABLE IF NOT EXISTS personal_promptdex_entries",
    );
    expect(executedSql).toContain(
      "task_type TEXT NOT NULL CHECK (task_type IN ('generate', 'edit'))",
    );
    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [3, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [4, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [CURRENT_SCHEMA_VERSION, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO app_settings"),
        params: [APP_SETTINGS_ID, "2026-06-25T00:00:00.000Z", "2026-06-25T00:00:00.000Z"],
      },
    ]);
  });

  it("将 v3 schema 重建为允许 edit 任务历史并补齐个人图鉴条目的 v5", async () => {
    const db = new FakeApplicationDatabase();
    db.migrationRows = [{ version: 2 }, { version: 3 }];

    const result = await initializeApplicationStorage({
      now: () => "2026-06-25T00:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(result.status).toBe("ready");
    const executedSql = db.execStatements.join("\n");
    expect(executedSql).toContain("CREATE TABLE image_task_histories_v4");
    expect(executedSql).toContain("INSERT INTO image_task_histories_v4");
    expect(executedSql).toContain("DROP TABLE image_task_histories");
    expect(executedSql).toContain(
      "ALTER TABLE image_task_histories_v4 RENAME TO image_task_histories",
    );
    expect(executedSql).toContain(
      "CREATE TABLE IF NOT EXISTS personal_promptdex_entries",
    );
    expect(executedSql).toContain(
      "task_type TEXT NOT NULL CHECK (task_type IN ('generate', 'edit'))",
    );
    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [4, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [CURRENT_SCHEMA_VERSION, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO app_settings"),
        params: [APP_SETTINGS_ID, "2026-06-25T00:00:00.000Z", "2026-06-25T00:00:00.000Z"],
      },
    ]);
  });

  it("将 v4 schema 迁移到个人图鉴条目表", async () => {
    const db = new FakeApplicationDatabase();
    db.migrationRows = [{ version: 2 }, { version: 3 }, { version: 4 }];

    const result = await initializeApplicationStorage({
      now: () => "2026-06-25T00:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(result.status).toBe("ready");
    const executedSql = db.execStatements.join("\n");
    expect(executedSql).toContain(
      "CREATE TABLE IF NOT EXISTS personal_promptdex_entries",
    );
    expect(executedSql).toContain("name TEXT PRIMARY KEY");
    expect(executedSql).toContain("description TEXT NOT NULL");
    expect(executedSql).toContain("version_json TEXT");
    expect(executedSql).toContain("inputs_json TEXT NOT NULL");
    expect(executedSql).toContain("body TEXT NOT NULL");
    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [CURRENT_SCHEMA_VERSION, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO app_settings"),
        params: [APP_SETTINGS_ID, "2026-06-25T00:00:00.000Z", "2026-06-25T00:00:00.000Z"],
      },
    ]);
  });

  it("初始化失败时返回 fail closed 状态", async () => {
    const result = await initializeApplicationStorage({
      openDatabase: async () => {
        throw new Error("database unavailable");
      },
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.message).toBe("database unavailable");
    }
  });
});
