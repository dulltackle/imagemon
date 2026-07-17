import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_VERSION_WITH_BUSINESS_CALL_ATTENTIONS,
  SCHEMA_VERSION_WITH_TABLE_BACKUP_STATE,
  type ApplicationDatabase,
  type StorageValue,
  initializeApplicationStorage,
} from "./index";

// 用 Node 22 的 node:sqlite 让**生产迁移代码**跑在真实 SQLite 上，
// 验证 v9→v10 的 ALTER 真的可执行、老库数据保住、重复初始化幂等且失败回滚。
// 仓库既有 schema 单测只断言 SQL 文本，不执行，光靠它们迁移写错发现不了。
class NodeSqliteApplicationDatabase implements ApplicationDatabase {
  constructor(
    private readonly db: DatabaseSync,
    private readonly failExecWhen?: (source: string) => boolean,
  ) {}

  async execAsync(source: string): Promise<void> {
    if (this.failExecWhen?.(source)) {
      throw new Error("模拟 pending_table_name 迁移失败。");
    }
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

const EXISTING_CONNECTION = {
  appToken: "bascn-existing",
  backupTableId: "tbl-existing",
  lastBackupSucceededAt: "2026-07-16T23:30:00.000Z",
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-16T23:30:00.000Z",
};

function seedSchemaV9(sqlite: DatabaseSync): void {
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE table_backup_state (
      id TEXT PRIMARY KEY CHECK (id = 'feishu'),
      app_token TEXT NOT NULL,
      backup_table_id TEXT,
      last_backup_succeeded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqlite
    .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
    .run(SCHEMA_VERSION_WITH_TABLE_BACKUP_STATE, "2026-07-15T00:00:00.000Z");
  sqlite
    .prepare(
      `INSERT INTO table_backup_state (
         id,
         app_token,
         backup_table_id,
         last_backup_succeeded_at,
         created_at,
         updated_at
       ) VALUES ('feishu', ?, ?, ?, ?, ?)`,
    )
    .run(
      EXISTING_CONNECTION.appToken,
      EXISTING_CONNECTION.backupTableId,
      EXISTING_CONNECTION.lastBackupSucceededAt,
      EXISTING_CONNECTION.createdAt,
      EXISTING_CONNECTION.updatedAt,
    );
}

function tableBackupStateColumns(sqlite: DatabaseSync): string[] {
  return (
    sqlite.prepare("PRAGMA table_info(table_backup_state)").all() as Array<{
      name: string;
    }>
  ).map((column) => column.name);
}

describe("真实 SQLite 上的 v10 迁移", () => {
  it("全新库初始化后直接创建含绑定恢复字段的 table_backup_state", async () => {
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
      .prepare(
        `SELECT
           app_token,
           backup_table_id,
           backup_binding_id,
           pending_table_name
         FROM table_backup_state
         WHERE id = 'feishu'`,
      )
      .get() as {
        app_token: string;
        backup_table_id: string | null;
        backup_binding_id: string | null;
        pending_table_name: string | null;
      };
    expect(row).toEqual({
      app_token: "bascn123",
      backup_table_id: null,
      backup_binding_id: null,
      pending_table_name: null,
    });
    expect(tableBackupStateColumns(sqlite)).toEqual(
      expect.arrayContaining(["backup_binding_id", "pending_table_name"]),
    );
    const version = sqlite
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get() as { version: number };
    expect(version.version).toBe(CURRENT_SCHEMA_VERSION);

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

  it("从 v9 迁移到 v10 时保留既有连接、表 ID 和成功时间", async () => {
    const sqlite = new DatabaseSync(":memory:");
    seedSchemaV9(sqlite);
    const db = new NodeSqliteApplicationDatabase(sqlite);

    const result = await initializeApplicationStorage({
      now: () => "2026-07-17T00:00:00.000Z",
      openDatabase: async () => db,
    });
    expect(result.status).toBe("ready");

    const row = sqlite
      .prepare(
        `SELECT
           app_token,
           backup_table_id,
           backup_binding_id,
           pending_table_name,
           last_backup_succeeded_at,
           created_at,
           updated_at
         FROM table_backup_state
         WHERE id = 'feishu'`,
      )
      .get();
    expect(row).toEqual({
      app_token: EXISTING_CONNECTION.appToken,
      backup_table_id: EXISTING_CONNECTION.backupTableId,
      backup_binding_id: null,
      pending_table_name: null,
      last_backup_succeeded_at: EXISTING_CONNECTION.lastBackupSucceededAt,
      created_at: EXISTING_CONNECTION.createdAt,
      updated_at: EXISTING_CONNECTION.updatedAt,
    });
    expect(tableBackupStateColumns(sqlite)).toEqual(
      expect.arrayContaining(["backup_binding_id", "pending_table_name"]),
    );
    const versions = sqlite
      .prepare("SELECT version FROM schema_migrations ORDER BY version ASC")
      .all() as Array<{ version: number }>;
    expect(versions.map(({ version }) => version)).toEqual([
      SCHEMA_VERSION_WITH_TABLE_BACKUP_STATE,
      CURRENT_SCHEMA_VERSION,
    ]);

    sqlite.close();
  });

  it("v10 数据库重复初始化不重复改表", async () => {
    const sqlite = new DatabaseSync(":memory:");
    seedSchemaV9(sqlite);
    const db = new NodeSqliteApplicationDatabase(sqlite);

    const firstResult = await initializeApplicationStorage({
      now: () => "2026-07-17T00:00:00.000Z",
      openDatabase: async () => db,
    });
    const secondResult = await initializeApplicationStorage({
      now: () => "2026-07-17T01:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(firstResult.status).toBe("ready");
    expect(secondResult.status).toBe("ready");
    const columns = tableBackupStateColumns(sqlite);
    expect(
      columns.filter((name) => name === "backup_binding_id"),
    ).toHaveLength(1);
    expect(
      columns.filter((name) => name === "pending_table_name"),
    ).toHaveLength(1);
    const currentVersionCount = sqlite
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?")
      .get(CURRENT_SCHEMA_VERSION) as { count: number };
    expect(currentVersionCount.count).toBe(1);
    const connection = sqlite
      .prepare(
        `SELECT app_token, backup_table_id, last_backup_succeeded_at
         FROM table_backup_state
         WHERE id = 'feishu'`,
      )
      .get();
    expect(connection).toEqual({
      app_token: EXISTING_CONNECTION.appToken,
      backup_table_id: EXISTING_CONNECTION.backupTableId,
      last_backup_succeeded_at: EXISTING_CONNECTION.lastBackupSucceededAt,
    });

    sqlite.close();
  });

  it("v9→v10 迁移失败时回滚新增列和迁移记录", async () => {
    const sqlite = new DatabaseSync(":memory:");
    seedSchemaV9(sqlite);
    const db = new NodeSqliteApplicationDatabase(
      sqlite,
      (source) => source.includes("ADD COLUMN pending_table_name"),
    );

    const result = await initializeApplicationStorage({
      now: () => "2026-07-17T00:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.message).toBe("模拟 pending_table_name 迁移失败。");
    }
    const columns = tableBackupStateColumns(sqlite);
    expect(columns).not.toContain("backup_binding_id");
    expect(columns).not.toContain("pending_table_name");
    const versions = sqlite
      .prepare("SELECT version FROM schema_migrations ORDER BY version ASC")
      .all() as Array<{ version: number }>;
    expect(versions.map(({ version }) => version)).toEqual([
      SCHEMA_VERSION_WITH_TABLE_BACKUP_STATE,
    ]);
    const connection = sqlite
      .prepare(
        `SELECT app_token, backup_table_id, last_backup_succeeded_at
         FROM table_backup_state
         WHERE id = 'feishu'`,
      )
      .get();
    expect(connection).toEqual({
      app_token: EXISTING_CONNECTION.appToken,
      backup_table_id: EXISTING_CONNECTION.backupTableId,
      last_backup_succeeded_at: EXISTING_CONNECTION.lastBackupSucceededAt,
    });

    sqlite.close();
  });

  it("从 v8 迁移到 v10 时补建备份状态表并保住既有条目", async () => {
    const sqlite = new DatabaseSync(":memory:");
    const db = new NodeSqliteApplicationDatabase(sqlite);

    // 先手工搭出一个处于 v8 的老库：schema_migrations 记到 8，
    // 并写入一条个人图鉴条目，连续迁移到 v10 后应原样保留。
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

    // 迁移记录推进到 v10
    const versions = sqlite
      .prepare("SELECT version FROM schema_migrations ORDER BY version ASC")
      .all() as Array<{ version: number }>;
    expect(versions.map((r) => r.version)).toContain(CURRENT_SCHEMA_VERSION);

    // 备份状态表建好且可写
    sqlite
      .prepare(
        `INSERT INTO table_backup_state (
           id,
           app_token,
           backup_binding_id,
           pending_table_name,
           created_at,
           updated_at
         ) VALUES (
           'feishu',
           'bascn123',
           'binding-1',
           'Imagemon 图鉴备份',
           '2026-07-15T00:00:00.000Z',
           '2026-07-15T00:00:00.000Z'
         )`,
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
