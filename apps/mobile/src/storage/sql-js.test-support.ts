import { createRequire } from "node:module";

import initSqlJs, {
  type Database as SqlJsDatabase,
  type SqlValue,
} from "sql.js";

import type {
  ApplicationDatabase,
  StorageValue,
} from "./index";

export interface SqlJsApplicationDatabase extends ApplicationDatabase {
  close(): void;
}

export async function createSqlJsApplicationDatabase(): Promise<SqlJsApplicationDatabase> {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  const sqlJs = await initSqlJs({
    locateFile: () => wasmPath,
  });
  return createApplicationDatabaseAdapter(new sqlJs.Database());
}

function createApplicationDatabaseAdapter(
  database: SqlJsDatabase,
): SqlJsApplicationDatabase {
  return {
    async execAsync(source) {
      database.exec(source);
    },

    async runAsync(source, ...params) {
      const statement = database.prepare(source);
      try {
        statement.bind(normalizeParams(params));
        statement.step();
        return { changes: database.getRowsModified() };
      } finally {
        statement.free();
      }
    },

    async getFirstAsync<T>(source: string, ...params: StorageValue[]) {
      const statement = database.prepare(source);
      try {
        statement.bind(normalizeParams(params));
        if (!statement.step()) {
          return null;
        }
        return statement.getAsObject() as unknown as T;
      } finally {
        statement.free();
      }
    },

    async getAllAsync<T>(source: string, ...params: StorageValue[]) {
      const statement = database.prepare(source);
      try {
        statement.bind(normalizeParams(params));
        const rows: T[] = [];
        while (statement.step()) {
          rows.push(statement.getAsObject() as unknown as T);
        }
        return rows;
      } finally {
        statement.free();
      }
    },

    async withTransactionAsync(task) {
      database.exec("BEGIN;");
      try {
        await task();
        database.exec("COMMIT;");
      } catch (error) {
        try {
          database.exec("ROLLBACK;");
        } catch {
          // 回滚异常不能掩盖触发回滚的原始错误。
        }
        throw error;
      }
    },

    close() {
      database.close();
    },
  };
}

function normalizeParams(params: readonly StorageValue[]): SqlValue[] {
  return params.map((value) =>
    typeof value === "boolean" ? Number(value) : value,
  );
}
