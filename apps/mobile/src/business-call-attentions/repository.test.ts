import { describe, expect, it, vi } from "vitest";

import type { ApplicationDatabase, StorageValue } from "../storage";
import {
  TEMPLATE_REFINEMENT_ATTENTION_SUBJECT_ID,
  createBusinessCallAttentionRepository,
  createMemoryBusinessCallAttentionStore,
  createSqliteBusinessCallAttentionStore,
} from "./repository";

describe("BusinessCallAttentionRepository", () => {
  it("同一底层对象的新状态覆盖旧状态且保留单条提示", async () => {
    const timestamps = [
      "2026-07-13T01:00:00.000Z",
      "2026-07-13T02:00:00.000Z",
    ];
    const repository = createBusinessCallAttentionRepository({
      store: createMemoryBusinessCallAttentionStore(),
      now: () => timestamps.shift() ?? "2026-07-13T03:00:00.000Z",
    });

    await repository.markImageTask("history-1", "failed");
    await repository.markImageTask("history-1", "succeeded");

    await expect(repository.list()).resolves.toEqual([
      {
        subjectType: "image_task",
        subjectId: "history-1",
        kind: "succeeded",
        createdAt: "2026-07-13T02:00:00.000Z",
      },
    ]);
  });

  it("模板提炼使用固定底层对象 id，跨对象清除互不影响", async () => {
    const store = createMemoryBusinessCallAttentionStore();
    const repository = createBusinessCallAttentionRepository({
      store,
      now: () => "2026-07-13T01:00:00.000Z",
    });

    await repository.markImageTask("history-1", "uncertain");
    await repository.markTemplateRefinement("succeeded");
    await repository.clearImageTask("history-1");
    await repository.clearImageTask("history-1");

    await expect(repository.list()).resolves.toEqual([
      {
        subjectType: "template_refinement",
        subjectId: TEMPLATE_REFINEMENT_ATTENTION_SUBJECT_ID,
        kind: "succeeded",
        createdAt: "2026-07-13T01:00:00.000Z",
      },
    ]);

    await repository.clearTemplateRefinement();
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("只在显式发布后通知订阅者，取消订阅后停止通知", async () => {
    const store = createMemoryBusinessCallAttentionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await store.upsertAttention({
      subjectType: "image_task",
      subjectId: "history-1",
      kind: "succeeded",
      createdAt: "2026-07-13T01:00:00.000Z",
    });
    expect(listener).not.toHaveBeenCalled();

    store.publish();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.publish();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("写入失败时不发布未提交的提示状态", async () => {
    const baseStore = createMemoryBusinessCallAttentionStore();
    const publish = vi.fn();
    const repository = createBusinessCallAttentionRepository({
      store: {
        ...baseStore,
        async upsertAttention() {
          throw new Error("write failed");
        },
        publish,
      },
    });

    await expect(
      repository.markImageTask("history-1", "failed"),
    ).rejects.toThrow("write failed");
    expect(publish).not.toHaveBeenCalled();
  });

  it("隔离订阅者异常并继续通知后续订阅者", async () => {
    const store = createMemoryBusinessCallAttentionStore();
    const consoleWarning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const laterListener = vi.fn();
    store.subscribe(() => {
      throw new Error("listener failed");
    });
    store.subscribe(laterListener);

    expect(() => store.publish()).not.toThrow();
    expect(laterListener).toHaveBeenCalledTimes(1);
    expect(consoleWarning).toHaveBeenCalledWith(
      "业务调用提示订阅者执行失败，已忽略本次刷新异常。",
    );

    consoleWarning.mockRestore();
  });

  it("条件清除只移除指定类型的提示", async () => {
    const store = createMemoryBusinessCallAttentionStore();
    await store.upsertAttention({
      subjectType: "image_task",
      subjectId: "history-succeeded",
      kind: "succeeded",
      createdAt: "2026-07-13T01:00:00.000Z",
    });
    await store.upsertAttention({
      subjectType: "image_task",
      subjectId: "history-failed",
      kind: "failed",
      createdAt: "2026-07-13T02:00:00.000Z",
    });

    await expect(
      store.clearAttentionIfKind(
        "image_task",
        "history-succeeded",
        "succeeded",
      ),
    ).resolves.toBe(true);
    await expect(
      store.clearAttentionIfKind(
        "image_task",
        "history-failed",
        "succeeded",
      ),
    ).resolves.toBe(false);
    await expect(store.listAttentions()).resolves.toEqual([
      {
        subjectType: "image_task",
        subjectId: "history-failed",
        kind: "failed",
        createdAt: "2026-07-13T02:00:00.000Z",
      },
    ]);
  });
});

describe("createSqliteBusinessCallAttentionStore", () => {
  it("使用复合主键 upsert、精确清除并映射 SQLite 行", async () => {
    const db = new AttentionFakeDatabase();
    db.rows = [
      {
        subject_type: "image_task",
        subject_id: "history-sqlite",
        kind: "failed",
        created_at: "2026-07-13T01:00:00.000Z",
      },
    ];
    const store = createSqliteBusinessCallAttentionStore(db);

    await expect(store.listAttentions()).resolves.toEqual([
      {
        subjectType: "image_task",
        subjectId: "history-sqlite",
        kind: "failed",
        createdAt: "2026-07-13T01:00:00.000Z",
      },
    ]);
    await store.upsertAttention({
      subjectType: "image_task",
      subjectId: "history-sqlite",
      kind: "succeeded",
      createdAt: "2026-07-13T02:00:00.000Z",
    });
    await store.clearAttention("image_task", "history-sqlite");

    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining(
          "ON CONFLICT(subject_type, subject_id) DO UPDATE SET",
        ),
        params: [
          "image_task",
          "history-sqlite",
          "succeeded",
          "2026-07-13T02:00:00.000Z",
        ],
      },
      {
        source: expect.stringContaining(
          "WHERE subject_type = ? AND subject_id = ?",
        ),
        params: ["image_task", "history-sqlite"],
      },
    ]);
  });

  it("用 kind 条件原子清除提示并返回是否命中", async () => {
    const db = new AttentionFakeDatabase();
    db.changedRows = 1;
    const store = createSqliteBusinessCallAttentionStore(db);

    await expect(
      store.clearAttentionIfKind(
        "image_task",
        "history-sqlite",
        "succeeded",
      ),
    ).resolves.toBe(true);

    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining(
          "WHERE subject_type = ? AND subject_id = ? AND kind = ?",
        ),
        params: ["image_task", "history-sqlite", "succeeded"],
      },
    ]);
  });
});

class AttentionFakeDatabase implements ApplicationDatabase {
  rows: AttentionFakeRow[] = [];
  changedRows = 0;
  readonly runStatements: Array<{
    source: string;
    params: StorageValue[];
  }> = [];

  async execAsync(): Promise<void> {}

  async runAsync(
    source: string,
    ...params: StorageValue[]
  ): Promise<unknown> {
    this.runStatements.push({ source, params });
    return { changes: this.changedRows };
  }

  async getFirstAsync<T>(): Promise<T | null> {
    return null;
  }

  async getAllAsync<T>(): Promise<T[]> {
    return this.rows as T[];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    await task();
  }
}

interface AttentionFakeRow {
  subject_type: "image_task" | "template_refinement";
  subject_id: string;
  kind: "succeeded" | "failed" | "uncertain";
  created_at: string;
}
