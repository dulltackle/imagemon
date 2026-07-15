// 飞书连接配置仓储：table_backup_state 单行读写 + 个人授权码凭据适配器的组合。
//
// - 个人授权码不入库，只经安全存储；清除连接时同步删凭据。
// - 更换 app_token 或授权码后，backup_table_id 与 last_backup_succeeded_at 一并清空
//   （新表格从头镜像，方案 2.5）。
import {
  type ApplicationDatabase,
  type FeishuPersonalBaseTokenCredentialAdapter,
  createUtcTimestamp,
} from "../storage";

export const TABLE_BACKUP_STATE_ID = "feishu";

export interface TableBackupConnection {
  appToken: string;
  backupTableId: string | null;
  lastBackupSucceededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveConnectionInput {
  appToken: string;
  /** 新授权码；缺省或空串表示保留已存凭据（不回显语义）。 */
  token?: string | null;
}

export interface TableBackupConnectionRepository {
  get(): Promise<TableBackupConnection | null>;
  getToken(): Promise<string | null>;
  save(input: SaveConnectionInput): Promise<TableBackupConnection>;
  setBackupTableId(tableId: string | null): Promise<TableBackupConnection>;
  markBackupSucceeded(succeededAt?: string): Promise<TableBackupConnection>;
  clear(): Promise<void>;
}

export interface TableBackupStateStore {
  get(): Promise<TableBackupConnection | null>;
  upsert(connection: TableBackupConnection): Promise<void>;
  delete(): Promise<void>;
}

export class TableBackupConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableBackupConnectionError";
  }
}

interface CreateTableBackupConnectionRepositoryOptions {
  store: TableBackupStateStore;
  credentials: FeishuPersonalBaseTokenCredentialAdapter;
  now?: () => string;
}

export function createTableBackupConnectionRepository({
  store,
  credentials,
  now = createUtcTimestamp,
}: CreateTableBackupConnectionRepositoryOptions): TableBackupConnectionRepository {
  async function requireExisting(): Promise<TableBackupConnection> {
    const existing = await store.get();
    if (!existing) {
      throw new TableBackupConnectionError("尚未保存飞书连接配置。");
    }
    return existing;
  }

  return {
    async get() {
      return store.get();
    },

    async getToken() {
      return credentials.get();
    },

    async save(input) {
      const appToken = input.appToken.trim();
      if (appToken === "") {
        throw new TableBackupConnectionError("app_token 不能为空。");
      }
      const nextToken = input.token?.trim();
      const replaceToken = typeof nextToken === "string" && nextToken.length > 0;

      const existing = await store.get();
      // app_token 变更或授权码替换都意味着换了备份目标，镜像状态清零。
      const resetMirror =
        existing === null ||
        existing.appToken !== appToken ||
        replaceToken;

      if (replaceToken) {
        await credentials.save(nextToken);
      }

      const timestamp = now();
      const next: TableBackupConnection = {
        appToken,
        backupTableId: resetMirror ? null : existing?.backupTableId ?? null,
        lastBackupSucceededAt: resetMirror
          ? null
          : existing?.lastBackupSucceededAt ?? null,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      await store.upsert(next);
      return next;
    },

    async setBackupTableId(tableId) {
      const existing = await requireExisting();
      const next: TableBackupConnection = {
        ...existing,
        backupTableId: tableId,
        updatedAt: now(),
      };
      await store.upsert(next);
      return next;
    },

    async markBackupSucceeded(succeededAt = now()) {
      const existing = await requireExisting();
      const next: TableBackupConnection = {
        ...existing,
        lastBackupSucceededAt: succeededAt,
        updatedAt: succeededAt,
      };
      await store.upsert(next);
      return next;
    },

    async clear() {
      await credentials.delete();
      await store.delete();
    },
  };
}

export function createMemoryTableBackupStateStore(): TableBackupStateStore {
  let connection: TableBackupConnection | null = null;
  return {
    async get() {
      return connection;
    },
    async upsert(next) {
      connection = next;
    },
    async delete() {
      connection = null;
    },
  };
}

export function createSqliteTableBackupStateStore(
  db: ApplicationDatabase,
): TableBackupStateStore {
  return {
    async get() {
      const row = await db.getFirstAsync<TableBackupStateRow>(
        `
          SELECT *
          FROM table_backup_state
          WHERE id = ?
        `,
        TABLE_BACKUP_STATE_ID,
      );
      return row ? mapRow(row) : null;
    },

    async upsert(connection) {
      await db.runAsync(
        `
          INSERT INTO table_backup_state (
            id,
            app_token,
            backup_table_id,
            last_backup_succeeded_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            app_token = excluded.app_token,
            backup_table_id = excluded.backup_table_id,
            last_backup_succeeded_at = excluded.last_backup_succeeded_at,
            updated_at = excluded.updated_at
        `,
        TABLE_BACKUP_STATE_ID,
        connection.appToken,
        connection.backupTableId,
        connection.lastBackupSucceededAt,
        connection.createdAt,
        connection.updatedAt,
      );
    },

    async delete() {
      await db.runAsync(
        `
          DELETE FROM table_backup_state
          WHERE id = ?
        `,
        TABLE_BACKUP_STATE_ID,
      );
    },
  };
}

interface TableBackupStateRow {
  app_token: string;
  backup_table_id: string | null;
  last_backup_succeeded_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: TableBackupStateRow): TableBackupConnection {
  return {
    appToken: row.app_token,
    backupTableId: row.backup_table_id,
    lastBackupSucceededAt: row.last_backup_succeeded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
