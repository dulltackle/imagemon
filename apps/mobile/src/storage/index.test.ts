import { describe, expect, it } from "vitest";

import {
  APP_SETTINGS_ID,
  CURRENT_SCHEMA_VERSION,
  type ApplicationDatabase,
  initializeApplicationStorage,
} from "./index";

class FakeApplicationDatabase implements ApplicationDatabase {
  readonly execStatements: string[] = [];
  readonly runStatements: Array<{ source: string; params: unknown[] }> = [];
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

  async getAllAsync<T>(): Promise<T[]> {
    return [];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.transactionCount += 1;
    await task();
  }
}

describe("initializeApplicationStorage", () => {
  it("在事务内初始化 schema v1、默认设置行和迁移记录", async () => {
    const db = new FakeApplicationDatabase();
    const result = await initializeApplicationStorage({
      now: () => "2026-06-25T00:00:00.000Z",
      openDatabase: async () => db,
    });

    expect(result.status).toBe("ready");
    expect(db.transactionCount).toBe(1);
    expect(db.execStatements.join("\n")).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
    expect(db.execStatements.join("\n")).toContain("CREATE TABLE IF NOT EXISTS model_configurations");
    expect(db.execStatements.join("\n")).toContain("CREATE TABLE IF NOT EXISTS app_settings");
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
