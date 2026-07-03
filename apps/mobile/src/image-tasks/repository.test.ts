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
