import { describe, expect, it, vi } from "vitest";

import {
  createMemoryBusinessCallAttentionStore,
  type BusinessCallAttentionStore,
} from "../business-call-attentions/repository";
import {
  createImageTaskRepository,
  createMemoryImageTaskStore,
  type ImageTaskStore,
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

const failure: ImageTaskFailureSummary = {
  reason: "network_error",
  message: "无法连接模型服务，请检查网络或 base URL。",
  occurredAt: "2026-07-13T00:02:00.000Z",
};

describe("ImageTaskRepository 业务调用提示集成", () => {
  it("新任务清理旧提示，并在完成或失败时写入最终提示", async () => {
    const attentionStore = createMemoryBusinessCallAttentionStore();
    await attentionStore.upsertAttention({
      subjectType: "image_task",
      subjectId: "history-completed",
      kind: "failed",
      createdAt: "2026-07-13T00:00:00.000Z",
    });
    const repository = createImageTaskRepository({
      store: createMemoryImageTaskStore(),
      attentionStore,
    });

    const completed = await repository.createRunningHistory({
      id: "history-completed",
      snapshot,
    });

    await expect(attentionStore.listAttentions()).resolves.toEqual([]);
    await repository.markCompleted(
      completed.id,
      "2026-07-13T00:01:00.000Z",
    );
    await expect(attentionStore.listAttentions()).resolves.toEqual([
      {
        subjectType: "image_task",
        subjectId: completed.id,
        kind: "succeeded",
        createdAt: "2026-07-13T00:01:00.000Z",
      },
    ]);

    const failed = await repository.createRunningHistory({
      id: "history-failed",
      snapshot,
    });
    await repository.markFailed(failed.id, failure, failure.occurredAt);
    const attentions = await attentionStore.listAttentions();
    expect(attentions).toHaveLength(2);
    expect(attentions).toEqual(
      expect.arrayContaining([
        {
          subjectType: "image_task",
          subjectId: failed.id,
          kind: "failed",
          createdAt: failure.occurredAt,
        },
        {
          subjectType: "image_task",
          subjectId: completed.id,
          kind: "succeeded",
          createdAt: "2026-07-13T00:01:00.000Z",
        },
      ]),
    );
  });

  it("启动恢复为每条遗留 running 历史写入结果不确定提示", async () => {
    const attentionStore = createMemoryBusinessCallAttentionStore();
    const repository = createImageTaskRepository({
      store: createMemoryImageTaskStore(),
      attentionStore,
    });
    await repository.createRunningHistory({ id: "running-1", snapshot });
    await repository.createRunningHistory({ id: "running-2", snapshot });
    const alreadyFailed = await repository.createRunningHistory({
      id: "failed-before-restart",
      snapshot,
    });
    await repository.markFailed(
      alreadyFailed.id,
      failure,
      failure.occurredAt,
    );

    await expect(
      repository.markRunningHistoriesUnknown("2026-07-13T00:03:00.000Z"),
    ).resolves.toBe(2);

    await expect(repository.getHistory("running-1")).resolves.toMatchObject({
      status: "unknown",
    });
    await expect(repository.getHistory("running-2")).resolves.toMatchObject({
      status: "unknown",
    });
    const attentions = await attentionStore.listAttentions();
    expect(attentions).toHaveLength(3);
    expect(attentions).toEqual(
      expect.arrayContaining([
        {
          subjectType: "image_task",
          subjectId: "running-1",
          kind: "uncertain",
          createdAt: "2026-07-13T00:03:00.000Z",
        },
        {
          subjectType: "image_task",
          subjectId: "running-2",
          kind: "uncertain",
          createdAt: "2026-07-13T00:03:00.000Z",
        },
        {
          subjectType: "image_task",
          subjectId: alreadyFailed.id,
          kind: "failed",
          createdAt: failure.occurredAt,
        },
      ]),
    );
  });

  it("业务状态写入失败时不会留下孤立提示", async () => {
    const attentionStore = createMemoryBusinessCallAttentionStore();
    const memoryStore = createMemoryImageTaskStore();
    const store: ImageTaskStore = {
      ...memoryStore,
      async updateHistory() {
        throw new Error("history update failed");
      },
    };
    const repository = createImageTaskRepository({ store, attentionStore });
    const history = await repository.createRunningHistory({
      id: "history-write-failed",
      snapshot,
    });

    await expect(repository.markCompleted(history.id)).rejects.toThrow(
      "history update failed",
    );

    await expect(repository.getHistory(history.id)).resolves.toMatchObject({
      status: "running",
    });
    await expect(attentionStore.listAttentions()).resolves.toEqual([]);
  });

  it("只在图片任务事务提交后发布提示变更", async () => {
    const memoryStore = createMemoryImageTaskStore();
    let transactionOpen = false;
    const store: ImageTaskStore = {
      ...memoryStore,
      async withTransaction<T>(task: () => Promise<T>) {
        return memoryStore.withTransaction(async () => {
          transactionOpen = true;
          try {
            return await task();
          } finally {
            transactionOpen = false;
          }
        });
      },
    };
    const baseAttentionStore = createMemoryBusinessCallAttentionStore();
    const publish = vi.fn(() => {
      expect(transactionOpen).toBe(false);
      baseAttentionStore.publish();
    });
    const attentionStore: BusinessCallAttentionStore = {
      ...baseAttentionStore,
      publish,
    };
    const repository = createImageTaskRepository({ store, attentionStore });

    const history = await repository.createRunningHistory({
      id: "history-publish-order",
      snapshot,
    });
    publish.mockClear();
    await repository.markCompleted(history.id);

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("删除历史时清除任意结果提示，图片结果保留且解除关联", async () => {
    const attentionStore = createMemoryBusinessCallAttentionStore();
    const repository = createImageTaskRepository({
      store: createMemoryImageTaskStore(),
      attentionStore,
    });
    const history = await repository.createRunningHistory({
      id: "history-to-delete",
      snapshot,
    });
    await repository.insertImageResult({
      id: "image-to-detach",
      taskHistoryId: history.id,
      filePath: "image-results/image-to-detach.png",
      format: "png",
    });
    await repository.markFailed(history.id, failure, failure.occurredAt);

    await expect(repository.deleteHistory(history.id)).resolves.toMatchObject({
      history: { id: history.id, status: "failed" },
      detachedImageResultIds: ["image-to-detach"],
    });

    await expect(attentionStore.listAttentions()).resolves.toEqual([]);
    await expect(
      repository.getImageResult("image-to-detach"),
    ).resolves.toMatchObject({ taskHistoryId: null });
  });

  it("删除图片结果只清除成功提示，失败和不确定提示保持不变", async () => {
    const attentionStore = createMemoryBusinessCallAttentionStore();
    const repository = createImageTaskRepository({
      store: createMemoryImageTaskStore(),
      attentionStore,
    });
    const succeeded = await repository.createRunningHistory({
      id: "history-succeeded-image",
      snapshot,
    });
    const failed = await repository.createRunningHistory({
      id: "history-failed-image",
      snapshot,
    });
    const uncertain = await repository.createRunningHistory({
      id: "history-uncertain-image",
      snapshot,
    });
    const succeededImage = await repository.insertImageResult({
      id: "image-succeeded",
      taskHistoryId: succeeded.id,
      filePath: "image-results/image-succeeded.png",
      format: "png",
    });
    const failedImage = await repository.insertImageResult({
      id: "image-failed",
      taskHistoryId: failed.id,
      filePath: "image-results/image-failed.png",
      format: "png",
    });
    const uncertainImage = await repository.insertImageResult({
      id: "image-uncertain",
      taskHistoryId: uncertain.id,
      filePath: "image-results/image-uncertain.png",
      format: "png",
    });
    await repository.markCompleted(succeeded.id, "2026-07-13T00:01:00.000Z");
    await repository.markFailed(failed.id, failure, failure.occurredAt);
    await repository.markRunningHistoriesUnknown("2026-07-13T00:03:00.000Z");

    await repository.deleteImageResult(succeededImage.id);
    await repository.deleteImageResult(failedImage.id);
    await repository.deleteImageResult(uncertainImage.id);

    await expect(attentionStore.listAttentions()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectId: failed.id,
          kind: "failed",
        }),
        expect.objectContaining({
          subjectId: uncertain.id,
          kind: "uncertain",
        }),
      ]),
    );
    await expect(attentionStore.listAttentions()).resolves.toHaveLength(2);
  });

  it("条件提示未命中时删除图片结果不发布刷新", async () => {
    const baseAttentionStore = createMemoryBusinessCallAttentionStore();
    const publish = vi.fn();
    const attentionStore: BusinessCallAttentionStore = {
      ...baseAttentionStore,
      publish,
    };
    const repository = createImageTaskRepository({
      store: createMemoryImageTaskStore(),
      attentionStore,
    });
    const history = await repository.createRunningHistory({
      id: "history-failed-no-publish",
      snapshot,
    });
    const image = await repository.insertImageResult({
      id: "image-failed-no-publish",
      taskHistoryId: history.id,
      filePath: "image-results/image-failed-no-publish.png",
      format: "png",
    });
    await repository.markFailed(history.id, failure, failure.occurredAt);
    publish.mockClear();

    await repository.deleteImageResult(image.id);

    expect(publish).not.toHaveBeenCalled();
    await expect(baseAttentionStore.listAttentions()).resolves.toEqual([
      expect.objectContaining({
        subjectId: history.id,
        kind: "failed",
      }),
    ]);
  });
});
