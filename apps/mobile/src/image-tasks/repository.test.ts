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
});
