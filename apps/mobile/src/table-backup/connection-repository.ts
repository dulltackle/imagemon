// 飞书连接配置仓储：table_backup_state 单行读写 + 个人授权码凭据适配器的组合。
//
// - 个人授权码不入库，只经安全存储；清除连接时同步删凭据。
// - 同一 Base 轮换授权码只改变访问凭据；切换 Base 才清空目标身份。
// - SQLite 与安全存储没有共同事务，保存失败时补偿恢复旧凭据。
import {
  type ApplicationDatabase,
  type FeishuPersonalBaseTokenCredentialAdapter,
  createRandomId,
  createUtcTimestamp,
} from "../storage";

export const TABLE_BACKUP_STATE_ID = "feishu";

export interface TableBackupConnection {
  appToken: string;
  backupTableId: string | null;
  backupBindingId: string | null;
  pendingTableName: string | null;
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
  ensureBackupBindingId(expectedAppToken: string): Promise<string>;
  adoptBackupBindingId(expectedAppToken: string, bindingId: string): Promise<string>;
  markCreatePending(input: MarkCreatePendingInput): Promise<void>;
  clearCreatePending(input: MarkCreatePendingInput): Promise<void>;
  bindBackupTable(input: BindBackupTableInput): Promise<TableBackupConnection>;
  adoptBackupTable(input: {
    expectedAppToken: string;
    bindingId: string;
    tableId: string;
  }): Promise<TableBackupConnection>;
  startNewBackupTarget(expectedAppToken: string): Promise<TableBackupConnection>;
  /** 兼容旧服务；新代码应使用 bindBackupTable。 */
  setBackupTableId(tableId: string | null): Promise<TableBackupConnection>;
  markBackupSucceeded(
    input?: string | MarkBackupSucceededInput,
  ): Promise<TableBackupConnection>;
  clear(): Promise<void>;
}

export interface MarkCreatePendingInput {
  expectedAppToken: string;
  bindingId: string;
  tableName: string;
}

export interface BindBackupTableInput {
  expectedAppToken: string;
  expectedBindingId: string;
  tableId: string;
}

export interface MarkBackupSucceededInput {
  expectedAppToken: string;
  expectedTableId: string;
  succeededAt: string;
}

export interface TableBackupStateStore {
  get(): Promise<TableBackupConnection | null>;
  upsert(connection: TableBackupConnection): Promise<void>;
  ensureBindingIfMissing(input: {
    expectedAppToken: string;
    bindingId: string;
    updatedAt: string;
  }): Promise<boolean>;
  adoptBinding(input: {
    expectedAppToken: string;
    bindingId: string;
    updatedAt: string;
  }): Promise<boolean>;
  setCreatePending(input: MarkCreatePendingInput & { updatedAt: string }): Promise<boolean>;
  clearCreatePending(
    input: MarkCreatePendingInput & { updatedAt: string },
  ): Promise<boolean>;
  bindTable(input: BindBackupTableInput & { updatedAt: string }): Promise<boolean>;
  adoptTable(input: {
    expectedAppToken: string;
    bindingId: string;
    tableId: string;
    updatedAt: string;
  }): Promise<boolean>;
  markSucceeded(input: MarkBackupSucceededInput): Promise<boolean>;
  rotateTarget(input: {
    expectedAppToken: string;
    bindingId: string;
    updatedAt: string;
  }): Promise<boolean>;
  touchConnection(input: {
    expectedAppToken: string;
    updatedAt: string;
  }): Promise<boolean>;
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
  generateBindingId?: () => string;
}

export function createTableBackupConnectionRepository({
  store,
  credentials,
  now = createUtcTimestamp,
  generateBindingId = createRandomId,
}: CreateTableBackupConnectionRepositoryOptions): TableBackupConnectionRepository {
  async function requireExisting(): Promise<TableBackupConnection> {
    const existing = await store.get();
    if (!existing) {
      throw new TableBackupConnectionError("尚未保存飞书连接配置。");
    }
    return existing;
  }

  async function requireCurrent(
    expectedAppToken: string,
    expectedBindingId?: string,
    expectedTableId?: string,
  ): Promise<TableBackupConnection> {
    const current = await requireExisting();
    if (
      current.appToken !== expectedAppToken ||
      (expectedBindingId !== undefined &&
        current.backupBindingId !== expectedBindingId) ||
      (expectedTableId !== undefined && current.backupTableId !== expectedTableId)
    ) {
      throw new TableBackupConnectionError(
        "飞书连接或备份目标已变化，本次操作已停止。",
      );
    }
    return current;
  }

  function requireChanged(changed: boolean): void {
    if (!changed) {
      throw new TableBackupConnectionError(
        "飞书连接或备份目标已变化，本次操作已停止。",
      );
    }
  }

  async function restoreCredential(previousToken: string | null): Promise<void> {
    if (previousToken === null) {
      await credentials.delete();
    } else {
      await credentials.save(previousToken);
    }
  }

  async function compensateCredential(previousToken: string | null): Promise<void> {
    try {
      await restoreCredential(previousToken);
    } catch {
      try {
        await credentials.delete();
      } catch {
        // 无法跨存储提供真正事务；最终错误明确要求重新配置，不吞掉主失败。
      }
      throw new TableBackupConnectionError(
        "保存连接失败，且无法恢复原凭据。请重新填写当前 Base 的个人授权码。",
      );
    }
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
      const previousToken = await credentials.get();
      const appChanged = existing !== null && existing.appToken !== appToken;
      if ((existing === null || appChanged) && !replaceToken) {
        throw new TableBackupConnectionError(
          "首次连接或更换 Base 时必须填写对应的个人授权码。",
        );
      }

      const timestamp = now();
      if (existing && !appChanged) {
        if (replaceToken) {
          await credentials.save(nextToken);
        }
        try {
          requireChanged(
            await store.touchConnection({
              expectedAppToken: appToken,
              updatedAt: timestamp,
            }),
          );
        } catch (error) {
          if (replaceToken) {
            await compensateCredential(previousToken);
          }
          throw error;
        }
        return requireCurrent(appToken);
      }

      const next: TableBackupConnection = {
        appToken,
        backupTableId: null,
        backupBindingId: null,
        pendingTableName: null,
        lastBackupSucceededAt: null,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      await credentials.save(nextToken!);
      try {
        await store.upsert(next);
      } catch (error) {
        await compensateCredential(previousToken);
        throw error;
      }
      return next;
    },

    async ensureBackupBindingId(expectedAppToken) {
      const bindingId = generateBindingId();
      if (bindingId.trim() === "") {
        throw new TableBackupConnectionError("无法生成备份目标绑定标识。");
      }
      requireChanged(
        await store.ensureBindingIfMissing({
          expectedAppToken,
          bindingId,
          updatedAt: now(),
        }),
      );
      const current = await requireCurrent(expectedAppToken);
      if (!current.backupBindingId) {
        throw new TableBackupConnectionError("无法保存备份目标绑定标识。");
      }
      return current.backupBindingId;
    },

    async adoptBackupBindingId(expectedAppToken, bindingId) {
      requireChanged(
        await store.adoptBinding({
          expectedAppToken,
          bindingId,
          updatedAt: now(),
        }),
      );
      return (await requireCurrent(expectedAppToken, bindingId)).backupBindingId!;
    },

    async markCreatePending(input) {
      requireChanged(
        await store.setCreatePending({
          ...input,
          updatedAt: now(),
        }),
      );
    },

    async clearCreatePending(input) {
      requireChanged(
        await store.clearCreatePending({
          ...input,
          updatedAt: now(),
        }),
      );
    },

    async bindBackupTable(input) {
      requireChanged(
        await store.bindTable({
          ...input,
          updatedAt: now(),
        }),
      );
      return requireCurrent(
        input.expectedAppToken,
        input.expectedBindingId,
        input.tableId,
      );
    },

    async adoptBackupTable(input) {
      requireChanged(
        await store.adoptTable({
          ...input,
          updatedAt: now(),
        }),
      );
      return requireCurrent(
        input.expectedAppToken,
        input.bindingId,
        input.tableId,
      );
    },

    async startNewBackupTarget(expectedAppToken) {
      const bindingId = generateBindingId();
      if (bindingId.trim() === "") {
        throw new TableBackupConnectionError("无法生成备份目标绑定标识。");
      }
      requireChanged(
        await store.rotateTarget({
          expectedAppToken,
          bindingId,
          updatedAt: now(),
        }),
      );
      return requireCurrent(expectedAppToken, bindingId);
    },

    async setBackupTableId(tableId) {
      const existing = await requireExisting();
      const next: TableBackupConnection = {
        ...existing,
        backupTableId: tableId,
        pendingTableName: null,
        lastBackupSucceededAt:
          existing.backupTableId !== null && existing.backupTableId !== tableId
            ? null
            : existing.lastBackupSucceededAt,
        updatedAt: now(),
      };
      await store.upsert(next);
      return next;
    },

    async markBackupSucceeded(input = now()) {
      if (typeof input !== "string") {
        requireChanged(await store.markSucceeded(input));
        return requireCurrent(
          input.expectedAppToken,
          undefined,
          input.expectedTableId,
        );
      }
      const succeededAt = input;
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
    async ensureBindingIfMissing(input) {
      if (!connection || connection.appToken !== input.expectedAppToken) {
        return false;
      }
      if (!connection.backupBindingId) {
        connection = {
          ...connection,
          backupBindingId: input.bindingId,
          updatedAt: input.updatedAt,
        };
      }
      return true;
    },
    async adoptBinding(input) {
      if (
        !connection ||
        connection.appToken !== input.expectedAppToken ||
        (connection.backupBindingId !== null &&
          connection.backupBindingId !== input.bindingId)
      ) {
        return false;
      }
      connection = {
        ...connection,
        backupBindingId: input.bindingId,
        updatedAt: input.updatedAt,
      };
      return true;
    },
    async setCreatePending(input) {
      if (
        !connection ||
        connection.appToken !== input.expectedAppToken ||
        connection.backupBindingId !== input.bindingId
      ) {
        return false;
      }
      connection = {
        ...connection,
        pendingTableName: input.tableName,
        updatedAt: input.updatedAt,
      };
      return true;
    },
    async clearCreatePending(input) {
      if (
        !connection ||
        connection.appToken !== input.expectedAppToken ||
        connection.backupBindingId !== input.bindingId ||
        connection.pendingTableName !== input.tableName
      ) {
        return false;
      }
      connection = {
        ...connection,
        pendingTableName: null,
        updatedAt: input.updatedAt,
      };
      return true;
    },
    async bindTable(input) {
      if (
        !connection ||
        connection.appToken !== input.expectedAppToken ||
        connection.backupBindingId !== input.expectedBindingId
      ) {
        return false;
      }
      connection = {
        ...connection,
        backupTableId: input.tableId,
        pendingTableName: null,
        lastBackupSucceededAt:
          connection.backupTableId !== null &&
          connection.backupTableId !== input.tableId
            ? null
            : connection.lastBackupSucceededAt,
        updatedAt: input.updatedAt,
      };
      return true;
    },
    async adoptTable(input) {
      if (!connection || connection.appToken !== input.expectedAppToken) {
        return false;
      }
      connection = {
        ...connection,
        backupTableId: input.tableId,
        backupBindingId: input.bindingId,
        pendingTableName: null,
        lastBackupSucceededAt: null,
        updatedAt: input.updatedAt,
      };
      return true;
    },
    async markSucceeded(input) {
      if (
        !connection ||
        connection.appToken !== input.expectedAppToken ||
        connection.backupTableId !== input.expectedTableId
      ) {
        return false;
      }
      connection = {
        ...connection,
        lastBackupSucceededAt: input.succeededAt,
        updatedAt: input.succeededAt,
      };
      return true;
    },
    async rotateTarget(input) {
      if (!connection || connection.appToken !== input.expectedAppToken) {
        return false;
      }
      connection = {
        ...connection,
        backupTableId: null,
        backupBindingId: input.bindingId,
        pendingTableName: null,
        lastBackupSucceededAt: null,
        updatedAt: input.updatedAt,
      };
      return true;
    },
    async touchConnection(input) {
      if (!connection || connection.appToken !== input.expectedAppToken) {
        return false;
      }
      connection = { ...connection, updatedAt: input.updatedAt };
      return true;
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
            backup_binding_id,
            pending_table_name,
            last_backup_succeeded_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            app_token = excluded.app_token,
            backup_table_id = excluded.backup_table_id,
            backup_binding_id = excluded.backup_binding_id,
            pending_table_name = excluded.pending_table_name,
            last_backup_succeeded_at = excluded.last_backup_succeeded_at,
            updated_at = excluded.updated_at
        `,
        TABLE_BACKUP_STATE_ID,
        connection.appToken,
        connection.backupTableId,
        connection.backupBindingId,
        connection.pendingTableName,
        connection.lastBackupSucceededAt,
        connection.createdAt,
        connection.updatedAt,
      );
    },

    async ensureBindingIfMissing(input) {
      const result = await db.runAsync(
        `
          UPDATE table_backup_state
          SET
            backup_binding_id = COALESCE(backup_binding_id, ?),
            updated_at = CASE
              WHEN backup_binding_id IS NULL THEN ?
              ELSE updated_at
            END
          WHERE id = ? AND app_token = ?
        `,
        input.bindingId,
        input.updatedAt,
        TABLE_BACKUP_STATE_ID,
        input.expectedAppToken,
      );
      return getChangedRowCount(result) > 0;
    },

    async adoptBinding(input) {
      const result = await db.runAsync(
        `
          UPDATE table_backup_state
          SET backup_binding_id = ?, updated_at = ?
          WHERE
            id = ?
            AND app_token = ?
            AND (backup_binding_id IS NULL OR backup_binding_id = ?)
        `,
        input.bindingId,
        input.updatedAt,
        TABLE_BACKUP_STATE_ID,
        input.expectedAppToken,
        input.bindingId,
      );
      return getChangedRowCount(result) > 0;
    },

    async setCreatePending(input) {
      const result = await db.runAsync(
        `
          UPDATE table_backup_state
          SET pending_table_name = ?, updated_at = ?
          WHERE id = ? AND app_token = ? AND backup_binding_id = ?
        `,
        input.tableName,
        input.updatedAt,
        TABLE_BACKUP_STATE_ID,
        input.expectedAppToken,
        input.bindingId,
      );
      return getChangedRowCount(result) > 0;
    },

    async clearCreatePending(input) {
      const result = await db.runAsync(
        `
          UPDATE table_backup_state
          SET pending_table_name = NULL, updated_at = ?
          WHERE
            id = ?
            AND app_token = ?
            AND backup_binding_id = ?
            AND pending_table_name = ?
        `,
        input.updatedAt,
        TABLE_BACKUP_STATE_ID,
        input.expectedAppToken,
        input.bindingId,
        input.tableName,
      );
      return getChangedRowCount(result) > 0;
    },

    async bindTable(input) {
      const result = await db.runAsync(
        `
          UPDATE table_backup_state
          SET
            last_backup_succeeded_at = CASE
              WHEN backup_table_id IS NULL OR backup_table_id = ?
                THEN last_backup_succeeded_at
              ELSE NULL
            END,
            backup_table_id = ?,
            pending_table_name = NULL,
            updated_at = ?
          WHERE id = ? AND app_token = ? AND backup_binding_id = ?
        `,
        input.tableId,
        input.tableId,
        input.updatedAt,
        TABLE_BACKUP_STATE_ID,
        input.expectedAppToken,
        input.expectedBindingId,
      );
      return getChangedRowCount(result) > 0;
    },

    async adoptTable(input) {
      const result = await db.runAsync(
        `
          UPDATE table_backup_state
          SET
            backup_table_id = ?,
            backup_binding_id = ?,
            pending_table_name = NULL,
            last_backup_succeeded_at = NULL,
            updated_at = ?
          WHERE id = ? AND app_token = ?
        `,
        input.tableId,
        input.bindingId,
        input.updatedAt,
        TABLE_BACKUP_STATE_ID,
        input.expectedAppToken,
      );
      return getChangedRowCount(result) > 0;
    },

    async markSucceeded(input) {
      const result = await db.runAsync(
        `
          UPDATE table_backup_state
          SET last_backup_succeeded_at = ?, updated_at = ?
          WHERE id = ? AND app_token = ? AND backup_table_id = ?
        `,
        input.succeededAt,
        input.succeededAt,
        TABLE_BACKUP_STATE_ID,
        input.expectedAppToken,
        input.expectedTableId,
      );
      return getChangedRowCount(result) > 0;
    },

    async rotateTarget(input) {
      const result = await db.runAsync(
        `
          UPDATE table_backup_state
          SET
            backup_table_id = NULL,
            backup_binding_id = ?,
            pending_table_name = NULL,
            last_backup_succeeded_at = NULL,
            updated_at = ?
          WHERE id = ? AND app_token = ?
        `,
        input.bindingId,
        input.updatedAt,
        TABLE_BACKUP_STATE_ID,
        input.expectedAppToken,
      );
      return getChangedRowCount(result) > 0;
    },

    async touchConnection(input) {
      const result = await db.runAsync(
        `
          UPDATE table_backup_state
          SET updated_at = ?
          WHERE id = ? AND app_token = ?
        `,
        input.updatedAt,
        TABLE_BACKUP_STATE_ID,
        input.expectedAppToken,
      );
      return getChangedRowCount(result) > 0;
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
  backup_binding_id: string | null;
  pending_table_name: string | null;
  last_backup_succeeded_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: TableBackupStateRow): TableBackupConnection {
  return {
    appToken: row.app_token,
    backupTableId: row.backup_table_id,
    backupBindingId: row.backup_binding_id,
    pendingTableName: row.pending_table_name,
    lastBackupSucceededAt: row.last_backup_succeeded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getChangedRowCount(result: unknown): number {
  if (
    result !== null &&
    typeof result === "object" &&
    "changes" in result &&
    typeof result.changes === "number"
  ) {
    return result.changes;
  }
  return 0;
}
