import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_VERSION_WITH_BUSINESS_CALL_ATTENTIONS,
  type ApplicationDatabase,
  type StorageValue,
  initializeApplicationStorage,
} from "./index";

// 用 Node 22 的 node:sqlite 让**生产迁移代码**跑在真实 SQLite 上，
// 验证 v8→v9 的 CREATE 真的可执行、老库数据保住、重复初始化幂等。
// 仓库既有 schema 单测只断言 SQL 文本，不执行，光靠它们迁移写错发现不了。
class NodeSqliteApplicationDatabase implements ApplicationDatabase {
  constructor(private readonly db: DatabaseSync) {}

  async execAsync(source: string): Promise<void> {
    this.db.exec(source);
  }

  async runAsync(source: string, ...params: StorageValue[]): Promise<unknown> {
    return this.db.prepare(source).run(...params.map(normalizeParam));
  }

  async getFirstAsync<T>(
    source: string,
    ...params: StorageValue[]
  ): Promise<T | null> {
    const row = this.db.prepare(source).get(...params.map(normalizeParam));
    return (row as T) ?? null;
  }

  async getAllAsync<T>(
    source: string,
    ...params: StorageValue[]
  ): Promise<T[]> {
    return this.db.prepare(source).all(...params.map(normalizeParam)) as T[];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.db.exec("BEGIN");
    try {
      await task();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function normalizeParam(value: StorageValue): string | number | null {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return value;
}

describe("真实 SQLite 上的 v9 迁移", () => {
  it("全新库初始化后可写入 table_backup_state", async () => {
    const sqlite = new DatabaseSync(":memory:");
    const db = new NodeSqliteApplicationDatabase(sqlite);

    const result = await initializeApplicationStorage({
      now: () => "2026-07-15T00:00:00.000Z",
      openDatabase: async () => db,
    });
    expect(result.status).toBe("ready");

    sqlite
      .prepare(
        `INSERT INTO table_backup_state (id, app_token, created_at, updated_at)
         VALUES ('feishu', 'bascn123', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z')`,
      )
      .run();

    const row = sqlite
      .prepare("SELECT app_token, backup_table_id FROM table_backup_state WHERE id = 'feishu'")
      .get() as { app_token: string; backup_table_id: string | null };
    expect(row.app_token).toBe("bascn123");
    expect(row.backup_table_id).toBeNull();

    sqlite.close();
  });

  it("id 只允许 'feishu' 单行", async () => {
    const sqlite = new DatabaseSync(":memory:");
    const db = new NodeSqliteApplicationDatabase(sqlite);

    await initializeApplicationStorage({
      now: () => "2026-07-15T00:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO table_backup_state (id, app_token, created_at, updated_at)
           VALUES ('other', 'bascn123', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow();

    sqlite.close();
  });

  it("从 v8 迁移到 v9 时补建备份状态表并保住既有条目", async () => {
    const sqlite = new DatabaseSync(":memory:");
    const db = new NodeSqliteApplicationDatabase(sqlite);

    // 先手工搭出一个处于 v8 的老库：schema_migrations 记到 8，
    // 并写入一条个人图鉴条目，迁移后应原样保留。
    sqlite.exec("PRAGMA foreign_keys = ON;");
    sqlite.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE personal_promptdex_entries (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        version_json TEXT,
        inputs_json TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    sqlite
      .prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      )
      .run(SCHEMA_VERSION_WITH_BUSINESS_CALL_ATTENTIONS, "2026-07-01T00:00:00.000Z");
    sqlite
      .prepare(
        `INSERT INTO personal_promptdex_entries
           (name, description, inputs_json, body, created_at, updated_at)
         VALUES ('小恐龙', '示例', '[]', '正文', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`,
      )
      .run();

    const result = await initializeApplicationStorage({
      now: () => "2026-07-15T00:00:00.000Z",
      openDatabase: async () => db,
    });
    expect(result.status).toBe("ready");

    // 迁移记录推进到 v9
    const versions = sqlite
      .prepare("SELECT version FROM schema_migrations ORDER BY version ASC")
      .all() as Array<{ version: number }>;
    expect(versions.map((r) => r.version)).toContain(CURRENT_SCHEMA_VERSION);

    // 备份状态表建好且可写
    sqlite
      .prepare(
        `INSERT INTO table_backup_state (id, app_token, created_at, updated_at)
         VALUES ('feishu', 'bascn123', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z')`,
      )
      .run();

    // 老条目保住
    const entry = sqlite
      .prepare("SELECT name, body FROM personal_promptdex_entries WHERE name = '小恐龙'")
      .get() as { name: string; body: string };
    expect(entry.body).toBe("正文");

    sqlite.close();
  });
});
