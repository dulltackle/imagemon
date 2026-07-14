import { describe, expect, it } from "vitest";

import { createSqliteBusinessCallAttentionStore } from "../business-call-attentions/repository";
import type { ApplicationDatabase, StorageValue } from "../storage";
import { createSqliteImageTaskRepository } from "./repository";
import type { ImageTaskSnapshot } from "./types";

const snapshot: ImageTaskSnapshot = {
  source: "manual",
  prompt: "一只蓝色玻璃花瓶",
  imageSpec: {
    size: "1024x1024",
    quality: "auto",
    format: "png",
    n: 1,
  },
  modelConfiguration: {
    type: "image",
    baseUrl: "https://api.openai.com/v1",
    modelName: "gpt-image-2",
  },
};

describe("SQLite ImageTaskRepository 删除", () => {
  it("事务内显式解除图片关联、删除历史并清除提示", async () => {
    const db = new ImageTaskDeletionFakeDatabase();
    db.historyRow = createHistoryRow("history-delete", "completed");
    db.detachedImageRows = [{ id: "image-1" }, { id: "image-2" }];
    const repository = createSqliteImageTaskRepository({
      db,
      attentionStore: createSqliteBusinessCallAttentionStore(db),
    });

    await expect(repository.deleteHistory("history-delete")).resolves.toEqual({
      history: expect.objectContaining({
        id: "history-delete",
        status: "completed",
      }),
      detachedImageResultIds: ["image-1", "image-2"],
    });

    expect(db.transactionCount).toBe(1);
    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining("SET task_history_id = NULL"),
        params: ["history-delete"],
      },
      {
        source: expect.stringContaining("DELETE FROM image_task_histories"),
        params: ["history-delete"],
      },
      {
        source: expect.stringContaining("DELETE FROM business_call_attentions"),
        params: ["image_task", "history-delete"],
      },
    ]);
  });

  it("删除单张图片记录、保留历史并条件清除成功提示", async () => {
    const db = new ImageTaskDeletionFakeDatabase();
    db.imageResultRow = {
      id: "image-delete",
      task_history_id: "history-keep",
      file_path: "image-results/image-delete.png",
      format: "png",
      width: 1024,
      height: 1024,
      created_at: "2026-07-13T00:01:00.000Z",
    };
    const repository = createSqliteImageTaskRepository({
      db,
      attentionStore: createSqliteBusinessCallAttentionStore(db),
    });

    await expect(repository.deleteImageResult("image-delete")).resolves.toEqual({
      id: "image-delete",
      taskHistoryId: "history-keep",
      filePath: "image-results/image-delete.png",
      format: "png",
      width: 1024,
      height: 1024,
      createdAt: "2026-07-13T00:01:00.000Z",
    });

    expect(db.transactionCount).toBe(1);
    expect(db.runStatements).toEqual([
      {
        source: expect.stringContaining("DELETE FROM image_results"),
        params: ["image-delete"],
      },
      {
        source: expect.stringContaining(
          "WHERE subject_type = ? AND subject_id = ? AND kind = ?",
        ),
        params: ["image_task", "history-keep", "succeeded"],
      },
    ]);
    expect(
      db.runStatements.some(({ source }) =>
        source.includes("DELETE FROM image_task_histories"),
      ),
    ).toBe(false);
  });

  it("进行中的 SQLite 历史拒绝删除且不执行写语句", async () => {
    const db = new ImageTaskDeletionFakeDatabase();
    db.historyRow = createHistoryRow("history-running", "running");
    const repository = createSqliteImageTaskRepository({ db });

    await expect(repository.deleteHistory("history-running")).rejects.toMatchObject({
      code: "invalid_state",
    });

    expect(db.transactionCount).toBe(1);
    expect(db.runStatements).toEqual([]);
  });
});

class ImageTaskDeletionFakeDatabase implements ApplicationDatabase {
  historyRow: ImageTaskHistorySqliteRow | null = null;
  imageResultRow: ImageResultSqliteRow | null = null;
  detachedImageRows: Array<{ id: string }> = [];
  transactionCount = 0;
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
    return { changes: 1 };
  }

  async getFirstAsync<T>(source: string): Promise<T | null> {
    if (source.includes("FROM image_task_histories")) {
      return this.historyRow as T | null;
    }
    if (source.includes("FROM image_results")) {
      return this.imageResultRow as T | null;
    }
    return null;
  }

  async getAllAsync<T>(source: string): Promise<T[]> {
    if (
      source.includes("SELECT id") &&
      source.includes("FROM image_results")
    ) {
      return this.detachedImageRows as T[];
    }
    return [];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.transactionCount += 1;
    await task();
  }
}

function createHistoryRow(
  id: string,
  status: ImageTaskHistorySqliteRow["status"],
): ImageTaskHistorySqliteRow {
  return {
    id,
    task_type: "generate",
    status,
    snapshot_json: JSON.stringify(snapshot),
    error_summary_json: null,
    created_at: "2026-07-13T00:00:00.000Z",
    updated_at: "2026-07-13T00:00:00.000Z",
    completed_at:
      status === "completed" ? "2026-07-13T00:01:00.000Z" : null,
  };
}

interface ImageTaskHistorySqliteRow {
  id: string;
  task_type: "generate" | "edit";
  status: "running" | "completed" | "failed" | "unknown";
  snapshot_json: string;
  error_summary_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ImageResultSqliteRow {
  id: string;
  task_history_id: string | null;
  file_path: string;
  format: "png";
  width: number | null;
  height: number | null;
  created_at: string;
}
