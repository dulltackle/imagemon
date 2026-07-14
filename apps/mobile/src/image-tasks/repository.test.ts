import { beforeEach, describe, expect, it } from "vitest";

import {
  createImageTaskRepository,
  createMemoryImageTaskStore,
} from "./repository";
import type { ImageTaskFailureSummary, ImageTaskSnapshot } from "./types";

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

const editSnapshot: ImageTaskSnapshot = {
  source: "promptdex",
  promptdexEntry: {
    name: "cute-paper-craft-isometric-character",
    description: "把输入图片改造成纸艺角色",
    sourceType: "built-in",
    taskType: "edit",
    inputs: {
      image: {
        required: true,
        description: "输入图片",
      },
      style: {
        required: true,
        description: "风格要求",
      },
    },
    body: "模板正文",
  },
  taskInputs: {
    style: "暖色纸艺",
  },
  inputAttachments: {
    image: {
      role: "image",
      filePath: "task-history-attachments/history-edit-1/image.png",
      mimeType: "image/png",
      originalFileName: "input.png",
      width: 1200,
      height: 800,
      byteSize: 123456,
    },
  },
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
  fullPrompt: "渲染后的编辑完整提示词",
};

describe("ImageTaskRepository", () => {
  let idCounter: number;
  let timeCounter: number;

  beforeEach(() => {
    idCounter = 0;
    timeCounter = 0;
  });

  function repository() {
    return createImageTaskRepository({
      store: createMemoryImageTaskStore(),
      generateId: () => `id-${++idCounter}`,
      now: () => `2026-06-25T00:00:0${++timeCounter}.000Z`,
    });
  }

  it("创建 running 任务历史并按创建时间倒序列出", async () => {
    const repo = repository();

    const first = await repo.createRunningHistory(snapshot);
    const second = await repo.createRunningHistory({
      ...snapshot,
      prompt: "第二张图",
    });

    expect(first).toMatchObject({
      id: "id-1",
      taskType: "generate",
      status: "running",
      snapshot,
      errorSummary: null,
      createdAt: "2026-06-25T00:00:01.000Z",
      updatedAt: "2026-06-25T00:00:01.000Z",
      completedAt: null,
    });
    await expect(repo.listHistories()).resolves.toEqual([second, first]);
  });

  it("使用预生成 ID 创建 edit 任务历史", async () => {
    const repo = repository();

    const history = await repo.createRunningHistory({
      id: "history-edit-1",
      snapshot: editSnapshot,
    });

    expect(history).toMatchObject({
      id: "history-edit-1",
      taskType: "edit",
      status: "running",
      snapshot: editSnapshot,
      createdAt: "2026-06-25T00:00:01.000Z",
      updatedAt: "2026-06-25T00:00:01.000Z",
    });
    await expect(repo.getHistory("history-edit-1")).resolves.toEqual(history);
  });

  it("manual 快照即使显式传入类型也创建 generate 历史", async () => {
    const repo = repository();

    const history = await repo.createRunningHistory({
      id: "history-manual-1",
      snapshot,
      taskType: "edit",
    });

    expect(history.taskType).toBe("generate");
  });

  it("保存图片结果并通过任务历史弱引用读取", async () => {
    const repo = repository();
    const history = await repo.createRunningHistory(snapshot);

    const imageResult = await repo.insertImageResult({
      id: "image-result-1",
      taskHistoryId: history.id,
      filePath: "image-results/image-result-1.png",
      format: "png",
      width: 1024,
      height: 1024,
    });
    const completed = await repo.markCompleted(history.id);

    expect(completed.status).toBe("completed");
    expect(imageResult).toMatchObject({
      id: "image-result-1",
      taskHistoryId: history.id,
      filePath: "image-results/image-result-1.png",
      format: "png",
      width: 1024,
      height: 1024,
      createdAt: "2026-06-25T00:00:02.000Z",
    });
    await expect(repo.getImageResult(imageResult.id)).resolves.toEqual(imageResult);
    await expect(repo.listImageResultsForTaskHistory(history.id)).resolves.toEqual([
      imageResult,
    ]);
  });

  it("失败任务保存结构化错误摘要和完成时间", async () => {
    const repo = repository();
    const history = await repo.createRunningHistory(snapshot);
    const failure: ImageTaskFailureSummary = {
      reason: "rate_limited",
      message: "模型服务请求受到限流，请稍后重试。",
      occurredAt: "2026-06-25T00:01:00.000Z",
      statusCode: 429,
      providerCode: "rate_limit_exceeded",
    };

    const failed = await repo.markFailed(history.id, failure, failure.occurredAt);

    expect(failed).toMatchObject({
      id: history.id,
      status: "failed",
      errorSummary: failure,
      updatedAt: failure.occurredAt,
      completedAt: failure.occurredAt,
    });
  });

  it("启动清理会将遗留 running 历史转为 unknown", async () => {
    const repo = repository();
    const running = await repo.createRunningHistory(snapshot);
    const failed = await repo.createRunningHistory(snapshot);
    await repo.markFailed(failed.id, {
      reason: "network_error",
      message: "无法连接模型服务，请检查网络或 base URL。",
      occurredAt: "2026-06-25T00:02:00.000Z",
    });

    await expect(
      repo.markRunningHistoriesUnknown("2026-06-25T00:03:00.000Z"),
    ).resolves.toBe(1);

    await expect(repo.getHistory(running.id)).resolves.toMatchObject({
      status: "unknown",
      updatedAt: "2026-06-25T00:03:00.000Z",
      completedAt: null,
    });
    await expect(repo.getHistory(failed.id)).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("删除完成、失败和状态未知历史，并保留图片结果且解除关联", async () => {
    const repo = repository();
    const completed = await repo.createRunningHistory({
      id: "history-completed",
      snapshot,
    });
    const failed = await repo.createRunningHistory({
      id: "history-failed",
      snapshot,
    });
    const unknown = await repo.createRunningHistory({
      id: "history-unknown",
      snapshot,
    });
    await repo.markCompleted(completed.id);
    await repo.markFailed(failed.id, {
      reason: "network_error",
      message: "网络错误",
      occurredAt: "2026-06-25T00:02:00.000Z",
    });
    await repo.markRunningHistoriesUnknown("2026-06-25T00:03:00.000Z");

    await repo.insertImageResult({
      id: "image-completed-1",
      taskHistoryId: completed.id,
      filePath: "image-results/image-completed-1.png",
      format: "png",
      createdAt: "2026-06-25T00:04:00.000Z",
    });
    await repo.insertImageResult({
      id: "image-completed-2",
      taskHistoryId: completed.id,
      filePath: "image-results/image-completed-2.png",
      format: "png",
      createdAt: "2026-06-25T00:05:00.000Z",
    });
    await repo.insertImageResult({
      id: "image-unrelated",
      taskHistoryId: failed.id,
      filePath: "image-results/image-unrelated.png",
      format: "png",
      createdAt: "2026-06-25T00:06:00.000Z",
    });

    await expect(repo.deleteHistory(completed.id)).resolves.toEqual({
      history: expect.objectContaining({
        id: completed.id,
        status: "completed",
      }),
      detachedImageResultIds: ["image-completed-1", "image-completed-2"],
    });
    await expect(repo.deleteHistory(failed.id)).resolves.toMatchObject({
      history: { id: failed.id, status: "failed" },
      detachedImageResultIds: ["image-unrelated"],
    });
    await expect(repo.deleteHistory(unknown.id)).resolves.toMatchObject({
      history: { id: unknown.id, status: "unknown" },
      detachedImageResultIds: [],
    });

    await expect(repo.listHistories()).resolves.toEqual([]);
    await expect(repo.listImageResults()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "image-completed-1",
          taskHistoryId: null,
        }),
        expect.objectContaining({
          id: "image-completed-2",
          taskHistoryId: null,
        }),
        expect.objectContaining({
          id: "image-unrelated",
          taskHistoryId: null,
        }),
      ]),
    );
  });

  it("仓储层拒绝删除进行中的历史且不解除图片关联", async () => {
    const repo = repository();
    const running = await repo.createRunningHistory({
      id: "history-running",
      snapshot,
    });
    const image = await repo.insertImageResult({
      id: "image-running",
      taskHistoryId: running.id,
      filePath: "image-results/image-running.png",
      format: "png",
    });

    await expect(repo.deleteHistory(running.id)).rejects.toEqual(
      expect.objectContaining({
        code: "invalid_state",
      }),
    );
    await expect(repo.getHistory(running.id)).resolves.toEqual(running);
    await expect(repo.getImageResult(image.id)).resolves.toEqual(image);
  });

  it("删除不存在的历史或图片结果时返回 not_found", async () => {
    const repo = repository();

    await expect(repo.deleteHistory("missing-history")).rejects.toEqual(
      expect.objectContaining({
        code: "not_found",
      }),
    );
    await expect(repo.deleteImageResult("missing-image")).rejects.toEqual(
      expect.objectContaining({
        code: "not_found",
      }),
    );
  });

  it("删除单张图片结果时保留任务历史和同任务的其他结果", async () => {
    const repo = repository();
    const history = await repo.createRunningHistory({
      id: "history-images",
      snapshot,
    });
    const first = await repo.insertImageResult({
      id: "image-first",
      taskHistoryId: history.id,
      filePath: "image-results/image-first.png",
      format: "png",
    });
    const second = await repo.insertImageResult({
      id: "image-second",
      taskHistoryId: history.id,
      filePath: "image-results/image-second.png",
      format: "png",
    });

    await expect(repo.deleteImageResult(first.id)).resolves.toEqual(first);
    await expect(repo.getImageResult(first.id)).resolves.toBeNull();
    await expect(repo.getImageResult(second.id)).resolves.toEqual(second);
    await expect(repo.getHistory(history.id)).resolves.toEqual(history);
  });
});
