import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  createMemoryFeishuPersonalBaseTokenCredentialAdapter,
  type ApplicationDatabase,
  type StorageValue,
} from "../storage";
import {
  TableBackupConnectionError,
  createSqliteTableBackupStateStore,
  createTableBackupConnectionRepository,
} from "./connection-repository";

class NodeSqliteDatabase implements ApplicationDatabase {
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
    return (this.db.prepare(source).get(...params.map(normalizeParam)) as T) ?? null;
  }

  async getAllAsync<T>(source: string, ...params: StorageValue[]): Promise<T[]> {
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
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}

function createSchema(sqlite: DatabaseSync): void {
  sqlite.exec(`
    CREATE TABLE table_backup_state (
      id TEXT PRIMARY KEY CHECK (id = 'feishu'),
      app_token TEXT NOT NULL,
      backup_table_id TEXT,
      backup_binding_id TEXT,
      pending_table_name TEXT,
      last_backup_succeeded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

describe("SQLite table backup state CAS", () => {
  it("只清理完全匹配 Base、binding 和表名的 pending", async () => {
    const sqlite = new DatabaseSync(":memory:");
    createSchema(sqlite);
    const repository = createTableBackupConnectionRepository({
      store: createSqliteTableBackupStateStore(new NodeSqliteDatabase(sqlite)),
      credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
      now: () => "2026-07-17T00:00:00.000Z",
      generateBindingId: () => "11111111-1111-4111-8111-111111111111",
    });
    await repository.save({ appToken: "bascnA", token: "pt-a" });
    const bindingId = await repository.ensureBackupBindingId("bascnA");
    await repository.markCreatePending({
      expectedAppToken: "bascnA",
      bindingId,
      tableName: "Imagemon 图鉴备份",
    });

    await expect(
      repository.clearCreatePending({
        expectedAppToken: "bascnA",
        bindingId,
        tableName: "其他名称",
      }),
    ).rejects.toBeInstanceOf(TableBackupConnectionError);
    expect((await repository.get())?.pendingTableName).toBe(
      "Imagemon 图鉴备份",
    );

    await repository.clearCreatePending({
      expectedAppToken: "bascnA",
      bindingId,
      tableName: "Imagemon 图鉴备份",
    });
    expect((await repository.get())?.pendingTableName).toBeNull();
    sqlite.close();
  });

  it("单条条件 UPDATE 阻止旧 Base 的异步结果污染新 Base", async () => {
    const sqlite = new DatabaseSync(":memory:");
    createSchema(sqlite);
    const repository = createTableBackupConnectionRepository({
      store: createSqliteTableBackupStateStore(new NodeSqliteDatabase(sqlite)),
      credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
      now: () => "2026-07-17T00:00:00.000Z",
      generateBindingId: () => "11111111-1111-4111-8111-111111111111",
    });

    await repository.save({ appToken: "bascnA", token: "pt-a" });
    const bindingId = await repository.ensureBackupBindingId("bascnA");
    await expect(
      repository.adoptBackupTable({
        expectedAppToken: "bascnA",
        bindingId: "22222222-2222-4222-8222-222222222222",
        tableId: "tblSelected",
      }),
    ).resolves.toMatchObject({
      backupTableId: "tblSelected",
      backupBindingId: "22222222-2222-4222-8222-222222222222",
    });
    await repository.save({ appToken: "bascnB", token: "pt-b" });

    await expect(
      repository.bindBackupTable({
        expectedAppToken: "bascnA",
        expectedBindingId: bindingId,
        tableId: "tblA",
      }),
    ).rejects.toBeInstanceOf(TableBackupConnectionError);
    await expect(
      repository.adoptBackupTable({
        expectedAppToken: "bascnA",
        bindingId,
        tableId: "tblA",
      }),
    ).rejects.toBeInstanceOf(TableBackupConnectionError);
    const row = sqlite
      .prepare(
        `SELECT app_token, backup_table_id, backup_binding_id
         FROM table_backup_state WHERE id = 'feishu'`,
      )
      .get();
    expect(row).toEqual({
      app_token: "bascnB",
      backup_table_id: null,
      backup_binding_id: null,
    });

    sqlite.close();
  });
});
