import { describe, expect, it } from "vitest";

import {
  APP_SETTINGS_ID,
  CURRENT_SCHEMA_VERSION,
  SCHEMA_VERSION_WITH_APPLICATION_DEFAULT_IMAGE_SPEC,
  SCHEMA_VERSION_WITH_TEMPLATE_REFINEMENT_DRAFTS,
  type ApplicationDatabase,
  initializeApplicationStorage,
} from "./index";

class FakeApplicationDatabase implements ApplicationDatabase {
  readonly execStatements: string[] = [];
  readonly getAllStatements: string[] = [];
  readonly runStatements: Array<{ source: string; params: unknown[] }> = [];
  readonly callOrder: string[] = [];
  migrationRows: Array<{ version: number }> = [];
  foreignKeysState = 1;
  transactionCount = 0;

  async execAsync(source: string): Promise<void> {
    this.execStatements.push(source);
    if (source.includes("PRAGMA foreign_keys = ON")) {
      this.callOrder.push("foreign_keys:set");
    }
  }

  async runAsync(source: string, ...params: unknown[]): Promise<unknown> {
    this.runStatements.push({ source, params });
    return {};
  }

  async getFirstAsync<T>(source: string): Promise<T | null> {
    if (source.includes("PRAGMA foreign_keys")) {
      this.callOrder.push("foreign_keys:read");
      return { foreign_keys: this.foreignKeysState } as T;
    }
    return null;
  }

  async getAllAsync<T>(source: string): Promise<T[]> {
    this.getAllStatements.push(source);
    return this.migrationRows as T[];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.callOrder.push("transaction:start");
    this.transactionCount += 1;
    await task();
  }
}

describe("initializeApplicationStorage", () => {
  it("在事务内初始化 schema v8、默认设置行和迁移记录", async () => {
    const db = new FakeApplicationDatabase();
    const result = await initializeApplicationStorage({
      now: () => "2026-06-25T00:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(result.status).toBe("ready");
    expect(db.callOrder.slice(0, 3)).toEqual([
      "foreign_keys:set",
      "foreign_keys:read",
      "transaction:start",
    ]);
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
    expect(executedSql).toContain(
      "CREATE TABLE IF NOT EXISTS template_refinement_drafts",
    );
    expect(executedSql).toContain(
      "CREATE TABLE IF NOT EXISTS business_call_attentions",
    );
    expect(executedSql).toContain(
      "PRIMARY KEY (subject_type, subject_id)",
    );
    expect(executedSql).not.toContain(
      "INSERT INTO business_call_attentions",
    );
    expect(executedSql).toContain(
      "status TEXT NOT NULL CHECK (status IN ('editing_input', 'generating', 'ready_for_review', 'failed'))",
    );
    expect(executedSql).toContain("proposal_json TEXT");
    expect(executedSql).toContain("error_summary_json TEXT");
    expect(executedSql).toContain("version_json TEXT");
    expect(executedSql).toContain("inputs_json TEXT NOT NULL");
    expect(executedSql).toContain(
      "default_image_size TEXT NOT NULL DEFAULT '1024x1024'",
    );
    expect(executedSql).toContain(
      "default_image_quality TEXT NOT NULL DEFAULT 'auto'",
    );
    expect(executedSql).toContain(
      "default_image_format TEXT NOT NULL DEFAULT 'png'",
    );
    expect(executedSql).toContain(
      "default_image_count INTEGER NOT NULL DEFAULT 1",
    );
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

  it("将 v1 模型配置迁移到无名称字段并补齐 v8 schema", async () => {
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
      "CREATE TABLE IF NOT EXISTS template_refinement_drafts",
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
        params: [5, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [
          SCHEMA_VERSION_WITH_TEMPLATE_REFINEMENT_DRAFTS,
          "2026-06-25T00:00:00.000Z",
        ],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [
          SCHEMA_VERSION_WITH_APPLICATION_DEFAULT_IMAGE_SPEC,
          "2026-06-25T00:00:00.000Z",
        ],
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

  it("将 v2 schema 迁移到包含提炼草稿与应用默认规格的 v8", async () => {
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
      "CREATE TABLE IF NOT EXISTS template_refinement_drafts",
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
        params: [5, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [
          SCHEMA_VERSION_WITH_TEMPLATE_REFINEMENT_DRAFTS,
          "2026-06-25T00:00:00.000Z",
        ],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [
          SCHEMA_VERSION_WITH_APPLICATION_DEFAULT_IMAGE_SPEC,
          "2026-06-25T00:00:00.000Z",
        ],
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

  it("将 v3 schema 重建为允许 edit 任务历史并补齐提炼草稿的 v8", async () => {
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
      "CREATE TABLE IF NOT EXISTS template_refinement_drafts",
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
        params: [5, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [
          SCHEMA_VERSION_WITH_TEMPLATE_REFINEMENT_DRAFTS,
          "2026-06-25T00:00:00.000Z",
        ],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [
          SCHEMA_VERSION_WITH_APPLICATION_DEFAULT_IMAGE_SPEC,
          "2026-06-25T00:00:00.000Z",
        ],
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

  it("将 v4 schema 迁移到个人图鉴条目和提炼草稿表", async () => {
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
    expect(executedSql).toContain(
      "CREATE TABLE IF NOT EXISTS template_refinement_drafts",
    );
    expect(executedSql).toContain("external_prompt TEXT NOT NULL");
    expect(executedSql).toContain("planned_use TEXT NOT NULL");
    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [5, "2026-06-25T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [
          SCHEMA_VERSION_WITH_TEMPLATE_REFINEMENT_DRAFTS,
          "2026-06-25T00:00:00.000Z",
        ],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [
          SCHEMA_VERSION_WITH_APPLICATION_DEFAULT_IMAGE_SPEC,
          "2026-06-25T00:00:00.000Z",
        ],
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

  it("将 v5 schema 迁移到提炼草稿表", async () => {
    const db = new FakeApplicationDatabase();
    db.migrationRows = [{ version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }];

    const result = await initializeApplicationStorage({
      now: () => "2026-06-25T00:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(result.status).toBe("ready");
    const executedSql = db.execStatements.join("\n");
    expect(executedSql).toContain(
      "CREATE TABLE IF NOT EXISTS template_refinement_drafts",
    );
    expect(executedSql).toContain("id TEXT PRIMARY KEY CHECK (id = 'template_refinement')");
    expect(executedSql).toContain("proposal_json TEXT");
    expect(executedSql).toContain("error_summary_json TEXT");
    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [
          SCHEMA_VERSION_WITH_TEMPLATE_REFINEMENT_DRAFTS,
          "2026-06-25T00:00:00.000Z",
        ],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [
          SCHEMA_VERSION_WITH_APPLICATION_DEFAULT_IMAGE_SPEC,
          "2026-06-25T00:00:00.000Z",
        ],
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

  it("将 v6 schema 依次迁移到含应用默认规格与业务提示的 v8", async () => {
    const db = new FakeApplicationDatabase();
    db.migrationRows = [
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: SCHEMA_VERSION_WITH_TEMPLATE_REFINEMENT_DRAFTS },
    ];

    const result = await initializeApplicationStorage({
      now: () => "2026-06-25T00:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(result.status).toBe("ready");
    const executedSql = db.execStatements.join("\n");
    expect(executedSql).toContain(
      "ALTER TABLE app_settings ADD COLUMN default_image_size TEXT NOT NULL DEFAULT '1024x1024'",
    );
    expect(executedSql).toContain(
      "ALTER TABLE app_settings ADD COLUMN default_image_quality TEXT NOT NULL DEFAULT 'auto'",
    );
    expect(executedSql).toContain(
      "ALTER TABLE app_settings ADD COLUMN default_image_format TEXT NOT NULL DEFAULT 'png'",
    );
    expect(executedSql).toContain(
      "ALTER TABLE app_settings ADD COLUMN default_image_count INTEGER NOT NULL DEFAULT 1",
    );
    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [
          SCHEMA_VERSION_WITH_APPLICATION_DEFAULT_IMAGE_SPEC,
          "2026-06-25T00:00:00.000Z",
        ],
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

  it("将 v7 迁移到空的业务调用提示表且不回填历史对象", async () => {
    const db = new FakeApplicationDatabase();
    db.migrationRows = [
      { version: SCHEMA_VERSION_WITH_APPLICATION_DEFAULT_IMAGE_SPEC },
    ];

    const result = await initializeApplicationStorage({
      now: () => "2026-07-13T00:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(result.status).toBe("ready");
    const executedSql = db.execStatements.join("\n");
    expect(executedSql).toContain(
      "CREATE TABLE IF NOT EXISTS business_call_attentions",
    );
    expect(executedSql).not.toContain(
      "INSERT INTO business_call_attentions",
    );
    expect(executedSql).not.toContain(
      "ALTER TABLE app_settings ADD COLUMN default_image_size",
    );
    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO schema_migrations"),
        params: [CURRENT_SCHEMA_VERSION, "2026-07-13T00:00:00.000Z"],
      },
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO app_settings"),
        params: [
          APP_SETTINGS_ID,
          "2026-07-13T00:00:00.000Z",
          "2026-07-13T00:00:00.000Z",
        ],
      },
    ]);
  });

  it("全新 v8 数据库重复初始化时不重跑旧迁移", async () => {
    const db = new FakeApplicationDatabase();
    await initializeApplicationStorage({
      now: () => "2026-07-13T00:00:00.000Z",
      openDatabase: async () => db,
    });

    db.migrationRows = [{ version: CURRENT_SCHEMA_VERSION }];
    db.execStatements.length = 0;
    db.runStatements.length = 0;
    const secondResult = await initializeApplicationStorage({
      now: () => "2026-07-13T01:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(secondResult.status).toBe("ready");
    const executedSql = db.execStatements.join("\n");
    expect(executedSql).toContain(
      "CREATE TABLE IF NOT EXISTS business_call_attentions",
    );
    expect(executedSql).not.toContain("CREATE TABLE model_configurations_v2");
    expect(executedSql).not.toContain("CREATE TABLE image_task_histories_v4");
    expect(executedSql).not.toContain("ALTER TABLE app_settings ADD COLUMN");
    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining("INSERT OR IGNORE INTO app_settings"),
        params: [
          APP_SETTINGS_ID,
          "2026-07-13T01:00:00.000Z",
          "2026-07-13T01:00:00.000Z",
        ],
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

  it("外键状态未实际启用时拒绝进入 schema 事务", async () => {
    const db = new FakeApplicationDatabase();
    db.foreignKeysState = 0;

    const result = await initializeApplicationStorage({
      openDatabase: async () => db,
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.message).toBe("无法启用 SQLite 外键约束。");
    }
    expect(db.callOrder).toEqual([
      "foreign_keys:set",
      "foreign_keys:read",
    ]);
    expect(db.transactionCount).toBe(0);
  });
});
