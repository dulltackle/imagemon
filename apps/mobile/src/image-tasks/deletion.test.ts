import { describe, expect, it, vi } from "vitest";

import {
  createImageTaskDeletionService,
  type DeleteImageTaskHistoryResult,
  type ImageTaskDeletionRepository,
} from "./deletion";
import type {
  ImageResult,
  ImageTaskHistory,
  ImageTaskStatus,
  PromptdexImageTaskSnapshot,
} from "./types";

describe("ImageTaskDeletionService", () => {
  it.each<ImageTaskStatus>(["completed", "failed", "unknown"])(
    "允许删除 %s 任务历史，并返回仓储删除结果",
    async (status) => {
      const history = createHistory({ status });
      const repository = createRepository({ history });
      const { service, deleteAttachment, deleteFile } = createService(repository);

      await expect(service.deleteHistory(history.id)).resolves.toEqual({
        history,
        detachedImageResultIds: ["image-result-1"],
      });

      expect(repository.getHistory).toHaveBeenCalledWith(history.id);
      expect(repository.deleteHistory).toHaveBeenCalledWith(history.id);
      expect(deleteAttachment).not.toHaveBeenCalled();
      expect(deleteFile).not.toHaveBeenCalled();
    },
  );

  it("任务历史不存在时在文件操作前返回 not_found", async () => {
    const repository = createRepository({ history: null });
    const { service, deleteAttachment, deleteFile } = createService(repository);

    const deletion = service.deleteHistory("missing-history");

    await expect(deletion).rejects.toMatchObject({
      code: "not_found",
    });
    expect(repository.deleteHistory).not.toHaveBeenCalled();
    expect(deleteAttachment).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("running 任务历史在附件操作前返回 invalid_state", async () => {
    const history = createHistory({
      status: "running",
      snapshot: createEditSnapshot(),
    });
    const repository = createRepository({ history });
    const { service, deleteAttachment, deleteFile } = createService(repository);

    const deletion = service.deleteHistory(history.id);

    await expect(deletion).rejects.toMatchObject({
      code: "invalid_state",
    });
    expect(repository.deleteHistory).not.toHaveBeenCalled();
    expect(deleteAttachment).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("删除编辑历史前去重清理内部输入附件，不触碰图片结果文件", async () => {
    const snapshot = createEditSnapshot();
    snapshot.inputAttachments = {
      image: createAttachment("image", "task-history-attachments/history-1/input.png"),
      mask: createAttachment("mask", "task-history-attachments/history-1/input.png"),
    };
    const history = createHistory({ snapshot });
    const events: string[] = [];
    const repository = createRepository({
      history,
      onDeleteHistory: async () => {
        events.push("database");
        return {
          history,
          detachedImageResultIds: ["image-result-1"],
        };
      },
    });
    const { service, deleteAttachment, deleteFile } = createService(repository, {
      deleteAttachment: async (filePath) => {
        events.push(`attachment:${filePath}`);
      },
    });

    await service.deleteHistory(history.id);

    expect(deleteAttachment).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      "attachment:task-history-attachments/history-1/input.png",
      "database",
    ]);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("附件已缺失时依赖幂等存储继续删除历史", async () => {
    const history = createHistory({ snapshot: createEditSnapshot() });
    const repository = createRepository({ history });
    const { service, deleteAttachment } = createService(repository, {
      deleteAttachment: async () => undefined,
    });

    await expect(service.deleteHistory(history.id)).resolves.toMatchObject({
      history,
    });
    expect(deleteAttachment).toHaveBeenCalledTimes(2);
    expect(repository.deleteHistory).toHaveBeenCalledTimes(1);
  });

  it("历史仓储删除失败后可重试，附件清理保持幂等顺序", async () => {
    const history = createHistory({ snapshot: createEditSnapshot() });
    let deletionAttempts = 0;
    const repository = createRepository({
      history,
      onDeleteHistory: async () => {
        deletionAttempts += 1;
        if (deletionAttempts === 1) {
          throw new Error("database unavailable");
        }
        return { history, detachedImageResultIds: [] };
      },
    });
    const { service, deleteAttachment } = createService(repository, {
      deleteAttachment: async () => undefined,
    });

    await expect(service.deleteHistory(history.id)).rejects.toThrow(
      "database unavailable",
    );
    await expect(service.deleteHistory(history.id)).resolves.toEqual({
      history,
      detachedImageResultIds: [],
    });

    expect(repository.getHistory).toHaveBeenCalledTimes(2);
    expect(repository.deleteHistory).toHaveBeenCalledTimes(2);
    expect(deleteAttachment).toHaveBeenCalledTimes(4);
  });

  it("附件删除失败时保留数据库记录并向调用方透传错误", async () => {
    const history = createHistory({ snapshot: createEditSnapshot() });
    const repository = createRepository({ history });
    const { service } = createService(repository, {
      deleteAttachment: async () => {
        throw new Error("attachment locked");
      },
    });

    await expect(service.deleteHistory(history.id)).rejects.toThrow(
      "attachment locked",
    );
    expect(repository.deleteHistory).not.toHaveBeenCalled();
  });

  it("图片结果不存在时在文件操作前返回 not_found", async () => {
    const repository = createRepository({ imageResult: null });
    const { service, deleteFile } = createService(repository);

    const deletion = service.deleteImageResult("missing-result");

    await expect(deletion).rejects.toMatchObject({
      code: "not_found",
    });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(repository.deleteImageResult).not.toHaveBeenCalled();
  });

  it("先删除私有原图文件，再删除图片结果记录", async () => {
    const imageResult = createImageResult();
    const events: string[] = [];
    const repository = createRepository({
      imageResult,
      onDeleteImageResult: async () => {
        events.push("database");
        return imageResult;
      },
    });
    const { service } = createService(repository, {
      deleteFile: async (filePath) => {
        events.push(`file:${filePath}`);
      },
    });

    await expect(service.deleteImageResult(imageResult.id)).resolves.toEqual(
      imageResult,
    );
    expect(events).toEqual([
      `file:${imageResult.filePath}`,
      "database",
    ]);
  });

  it("图片记录删除失败后保留可重试语义，幂等文件删除可再次执行", async () => {
    const imageResult = createImageResult();
    let deletionAttempts = 0;
    const repository = createRepository({
      imageResult,
      onDeleteImageResult: async () => {
        deletionAttempts += 1;
        if (deletionAttempts === 1) {
          throw new Error("database unavailable");
        }
        return imageResult;
      },
    });
    const { service, deleteFile } = createService(repository, {
      deleteFile: async () => undefined,
    });

    await expect(service.deleteImageResult(imageResult.id)).rejects.toThrow(
      "database unavailable",
    );
    await expect(service.deleteImageResult(imageResult.id)).resolves.toEqual(
      imageResult,
    );

    expect(repository.getImageResult).toHaveBeenCalledTimes(2);
    expect(repository.deleteImageResult).toHaveBeenCalledTimes(2);
    expect(deleteFile).toHaveBeenCalledTimes(2);
  });
});

function createService(
  repository: ImageTaskDeletionRepository,
  overrides: {
    deleteFile?: (filePath: string) => Promise<void>;
    deleteAttachment?: (filePath: string) => Promise<void>;
  } = {},
) {
  const deleteFile = vi.fn(overrides.deleteFile ?? (async () => undefined));
  const deleteAttachment = vi.fn(
    overrides.deleteAttachment ?? (async () => undefined),
  );
  return {
    service: createImageTaskDeletionService({
      imageTaskRepository: repository,
      imageFileStorage: { deleteFile },
      imageTaskAttachmentStorage: { deleteAttachment },
    }),
    deleteFile,
    deleteAttachment,
  };
}

function createRepository({
  history = createHistory(),
  imageResult = createImageResult(),
  onDeleteHistory,
  onDeleteImageResult,
}: {
  history?: ImageTaskHistory | null;
  imageResult?: ImageResult | null;
  onDeleteHistory?: (id: string) => Promise<DeleteImageTaskHistoryResult>;
  onDeleteImageResult?: (id: string) => Promise<ImageResult>;
} = {}): ImageTaskDeletionRepository & {
  getHistory: ReturnType<typeof vi.fn>;
  deleteHistory: ReturnType<typeof vi.fn>;
  getImageResult: ReturnType<typeof vi.fn>;
  deleteImageResult: ReturnType<typeof vi.fn>;
} {
  return {
    getHistory: vi.fn(async () => history),
    deleteHistory: vi.fn(
      onDeleteHistory ??
        (async () => ({
          history: history ?? createHistory(),
          detachedImageResultIds: ["image-result-1"],
        })),
    ),
    getImageResult: vi.fn(async () => imageResult),
    deleteImageResult: vi.fn(
      onDeleteImageResult ?? (async () => imageResult ?? createImageResult()),
    ),
  };
}

function createHistory({
  status = "completed",
  snapshot = createManualSnapshot(),
}: {
  status?: ImageTaskStatus;
  snapshot?: ImageTaskHistory["snapshot"];
} = {}): ImageTaskHistory {
  return {
    id: "history-1",
    taskType: snapshot.source === "promptdex" ? "edit" : "generate",
    status,
    snapshot,
    errorSummary: null,
    createdAt: "2026-07-13T01:00:00.000Z",
    updatedAt: "2026-07-13T01:01:00.000Z",
    completedAt: status === "running" ? null : "2026-07-13T01:01:00.000Z",
  };
}

function createManualSnapshot(): ImageTaskHistory["snapshot"] {
  return {
    source: "manual",
    prompt: "一只猫",
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
}

function createEditSnapshot(): PromptdexImageTaskSnapshot {
  return {
    source: "promptdex",
    promptdexEntry: {
      name: "局部编辑",
      description: "编辑图片",
      sourceType: "built-in",
      taskType: "edit",
      inputs: {},
      body: "提示词",
    },
    taskInputs: {},
    inputAttachments: {
      image: createAttachment(
        "image",
        "task-history-attachments/history-1/image.png",
      ),
      mask: createAttachment(
        "mask",
        "task-history-attachments/history-1/mask.png",
      ),
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
    fullPrompt: "编辑这张图片",
  };
}

function createAttachment(
  role: "image" | "mask",
  filePath: string,
) {
  return {
    role,
    filePath,
    mimeType: "image/png",
    originalFileName: `${role}.png`,
    width: 1024,
    height: 1024,
    byteSize: 128,
  };
}

function createImageResult(): ImageResult {
  return {
    id: "image-result-1",
    taskHistoryId: "history-1",
    filePath: "image-results/image-result-1.png",
    format: "png",
    width: 1024,
    height: 1024,
    createdAt: "2026-07-13T01:01:00.000Z",
  };
}
