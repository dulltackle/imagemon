import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePromptdexTemplate } from "@imagemon/core";

import {
  createMemoryModelConfigurationCredentialAdapter,
  type ModelConfigurationCredentialAdapter,
} from "../storage";
import {
  createMemoryModelConfigurationStore,
  createModelConfigurationRepository,
  type ModelConfigurationRepository,
} from "../model-configurations";
import {
  ImageTaskExecutionError,
  createImageGenerationTaskService,
  createImageTaskRepository,
  createMemoryImageResultFileStorage,
  createMemoryImageTaskStore,
  createPromptdexImageGenerationTaskService,
  type ImageModelClient,
  type ImageTaskHistoryCreatedCallback,
  type ImageTaskRepository,
} from "./index";

describe("ImageGenerationTaskService", () => {
  let modelRepository: ModelConfigurationRepository;
  let credentials: ModelConfigurationCredentialAdapter;
  let imageTaskRepository: ImageTaskRepository;
  let fileStorage: ReturnType<typeof createMemoryImageResultFileStorage>;
  let timeCounter: number;
  let imageResultIdQueue: string[];

  beforeEach(() => {
    timeCounter = 0;
    imageResultIdQueue = [
      "image-result-1",
      "image-result-2",
      "image-result-3",
    ];
    credentials = createMemoryModelConfigurationCredentialAdapter();
    modelRepository = createModelConfigurationRepository({
      store: createMemoryModelConfigurationStore({ now }),
      credentials,
      generateId: () => "config-1",
      now,
    });
    imageTaskRepository = createImageTaskRepository({
      store: createMemoryImageTaskStore(),
      generateId: () => `history-${++timeCounter}`,
      now,
    });
    fileStorage = createMemoryImageResultFileStorage();
  });

  function now() {
    return `2026-06-25T00:00:${String(++timeCounter).padStart(2, "0")}.000Z`;
  }

  function service(
    imageModelClient: ImageModelClient,
    onHistoryCreated?: ImageTaskHistoryCreatedCallback,
    repository: ImageTaskRepository = imageTaskRepository,
  ) {
    return createImageGenerationTaskService({
      imageTaskRepository: repository,
      modelConfigurationRepository: modelRepository,
      fileStorage,
      imageModelClient,
      onHistoryCreated,
      generateId: nextImageResultId,
      now,
    });
  }

  function promptdexService(
    imageModelClient: ImageModelClient,
    onHistoryCreated?: ImageTaskHistoryCreatedCallback,
  ) {
    return createPromptdexImageGenerationTaskService({
      imageTaskRepository,
      modelConfigurationRepository: modelRepository,
      fileStorage,
      imageModelClient,
      onHistoryCreated,
      generateId: nextImageResultId,
      now,
    });
  }

  function nextImageResultId() {
    const id = imageResultIdQueue.shift();
    if (!id) {
      throw new Error("图片结果 ID 测试夹具已耗尽");
    }
    return id;
  }

  async function createReadyDefaultImageConfiguration() {
    const configuration = await modelRepository.save({
      type: "image",
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-image-2",
      apiKey: "sk-test",
    });
    await modelRepository.markReady(configuration.id, "2026-06-25T01:00:00.000Z");
    await modelRepository.setDefault("image", configuration.id);
    return configuration;
  }

  it("缺少默认就绪图片模型配置时不创建任务历史", async () => {
    const generate = vi.fn<ImageModelClient["generate"]>();

    const result = await service({ generate }).run({
      prompt: "一张方图",
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "failed",
      history: null,
      failure: {
        reason: "missing_default_model_configuration",
      },
    });
    expect(generate).not.toHaveBeenCalled();
    await expect(imageTaskRepository.listHistories()).resolves.toEqual([]);
  });

  it("凭据缺失时创建失败历史并清除就绪状态和默认引用", async () => {
    const configuration = await createReadyDefaultImageConfiguration();
    await credentials.delete(configuration.id);
    const generate = vi.fn<ImageModelClient["generate"]>();

    const result = await service({ generate }).run({
      prompt: "一张方图",
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "failed",
      failure: {
        reason: "missing_credential",
      },
      history: {
        status: "failed",
        errorSummary: {
          reason: "missing_credential",
        },
      },
    });
    expect(generate).not.toHaveBeenCalled();
    await expect(modelRepository.get(configuration.id)).resolves.toMatchObject({
      hasCredential: false,
      isReady: false,
      lastTestSucceededAt: null,
    });
    await expect(modelRepository.getSettings()).resolves.toMatchObject({
      defaultImageModelConfigurationId: null,
    });
  });

  it("成功调用后写入任务历史、快照、图片结果和图片文件", async () => {
    await createReadyDefaultImageConfiguration();
    const generate = vi.fn<ImageModelClient["generate"]>(async () => ({
      base64: "aW1hZ2U=",
      width: 1536,
      height: 1024,
    }));

    const result = await service({ generate }).run({
      prompt: "  一张横图  ",
      size: "1536x1024",
    });

    expect(result).toMatchObject({
      status: "succeeded",
      history: {
        status: "completed",
        snapshot: {
          source: "manual",
          prompt: "一张横图",
          imageSpec: {
            size: "1536x1024",
            quality: "auto",
            format: "png",
            n: 1,
          },
          modelConfiguration: {
            type: "image",
            baseUrl: "https://api.openai.com/v1",
            modelName: "gpt-image-2",
          },
        },
      },
      imageResult: {
        id: "image-result-1",
        filePath: "image-results/image-result-1.png",
        format: "png",
        width: 1536,
        height: 1024,
      },
    });
    expect(fileStorage.files.get("image-results/image-result-1.png")).toBe(
      "aW1hZ2U=",
    );
    await expect(imageTaskRepository.listImageResults()).resolves.toHaveLength(1);
  });

  it.each([
    {
      relation: "M<N",
      requestedCount: 3 as const,
      quality: "auto" as const,
      format: "png" as const,
      generated: [
        { base64: "Zmlyc3Q=", width: 1536, height: 1024 },
        { base64: "c2Vjb25k", width: 1024, height: 1536 },
      ],
    },
    {
      relation: "M=N",
      requestedCount: 2 as const,
      quality: "high" as const,
      format: "webp" as const,
      generated: [
        { base64: "Zmlyc3Qtd2VicA==", width: 1536, height: 1024 },
        { bytes: new Uint8Array([2, 4, 6]), width: 1024, height: 1536 },
      ],
    },
    {
      relation: "M>N",
      requestedCount: 2 as const,
      quality: "auto" as const,
      format: "png" as const,
      generated: [
        { base64: "Zmlyc3Q=", width: 1536, height: 1024 },
        { base64: "c2Vjb25k", width: 1024, height: 1536 },
        { base64: "dGhpcmQ=", width: 1024, height: 1024 },
      ],
    },
  ])(
    "请求 $requestedCount 张且 provider 返回 $generated.length 张（$relation）时保存全部实际结果",
    async ({ requestedCount, quality, format, generated }) => {
      await createReadyDefaultImageConfiguration();
      const generate = vi.fn<ImageModelClient["generate"]>(async () => [
        ...generated,
      ]);

      const result = await service({ generate }).run({
        prompt: "  多图生成  ",
        size: "1536x1024",
        quality,
        format,
        n: requestedCount,
      });

      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledWith({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        modelName: "gpt-image-2",
        prompt: "多图生成",
        size: "1536x1024",
        quality,
        format,
        n: requestedCount,
      });
      expect(result.status).toBe("succeeded");
      if (result.status !== "succeeded") {
        throw new Error("预期多图生成成功");
      }

      expect(result.history).toMatchObject({
        status: "completed",
        snapshot: {
          imageSpec: {
            size: "1536x1024",
            quality,
            format,
            n: requestedCount,
          },
        },
      });
      expect(result.imageResults).toEqual(
        generated.map((image, index) => ({
          id: `image-result-${index + 1}`,
          taskHistoryId: result.history.id,
          filePath: `image-results/image-result-${index + 1}.${format}`,
          format,
          width: image.width,
          height: image.height,
          createdAt: expect.any(String),
        })),
      );
      expect(result.imageResult).toBe(result.imageResults[0]);
      expect(new Set(result.imageResults.map(({ filePath }) => filePath)).size).toBe(
        generated.length,
      );
      generated.forEach((image, index) => {
        const expectedContents =
          "base64" in image ? image.base64 : image.bytes;
        expect(fileStorage.files.get(result.imageResults[index].filePath)).toEqual(
          expectedContents,
        );
      });
      await expect(
        imageTaskRepository.listImageResultsForTaskHistory(result.history.id),
      ).resolves.toEqual(result.imageResults);
      await expect(imageTaskRepository.listImageResults()).resolves.toHaveLength(
        generated.length,
      );
      await expect(imageTaskRepository.listHistories()).resolves.toEqual([
        result.history,
      ]);
    },
  );

  it("模型返回空数组时不保存文件或结果并将历史收口为失败", async () => {
    await createReadyDefaultImageConfiguration();
    const generate = vi.fn<ImageModelClient["generate"]>(async () => []);

    const result = await service({ generate }).run({
      prompt: "两张方图",
      size: "1024x1024",
      n: 2,
    });

    expect(result).toMatchObject({
      status: "failed",
      failure: { reason: "invalid_response" },
      history: {
        status: "failed",
        errorSummary: { reason: "invalid_response" },
      },
    });
    expect(fileStorage.files.size).toBe(0);
    await expect(imageTaskRepository.listImageResults()).resolves.toEqual([]);
    await expect(imageTaskRepository.listHistories()).resolves.toEqual([
      expect.objectContaining({ status: "failed" }),
    ]);
  });

  it("第二张文件保存失败时停止后续保存并补偿删除已保存文件", async () => {
    await createReadyDefaultImageConfiguration();
    const generate = vi.fn<ImageModelClient["generate"]>(async () => [
      { base64: "Zmlyc3Q=", width: 1024, height: 1024 },
      { base64: "c2Vjb25k", width: 1024, height: 1024 },
      { base64: "dGhpcmQ=", width: 1024, height: 1024 },
    ]);
    const storageFailure = new Error("second file failed");
    const originalSaveImageResultFile = fileStorage.saveImageResultFile;
    const originalDeleteFile = fileStorage.deleteFile;
    let saveAttempts = 0;
    const saveImageResultFile = vi
      .spyOn(fileStorage, "saveImageResultFile")
      .mockImplementation(async (input) => {
        saveAttempts += 1;
        if (saveAttempts === 2) {
          throw storageFailure;
        }
        return originalSaveImageResultFile(input);
      });
    const deleteFile = vi
      .spyOn(fileStorage, "deleteFile")
      .mockImplementation(originalDeleteFile);

    const result = await service({ generate }).run({
      prompt: "三张方图",
      size: "1024x1024",
      n: 3,
    });

    expect(result).toMatchObject({
      status: "failed",
      failure: { reason: "unknown_error" },
      history: {
        status: "failed",
        errorSummary: { reason: "unknown_error" },
      },
    });
    expect(saveImageResultFile).toHaveBeenCalledTimes(2);
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(
      "image-results/image-result-1.png",
    );
    expect(fileStorage.files.size).toBe(0);
    await expect(imageTaskRepository.listImageResults()).resolves.toEqual([]);
  });

  it("全部文件保存后仓储完成失败时补偿删除所有文件并保留失败历史", async () => {
    await createReadyDefaultImageConfiguration();
    const generate = vi.fn<ImageModelClient["generate"]>(async () => [
      { base64: "Zmlyc3Q=", width: 1024, height: 1024 },
      { bytes: new Uint8Array([1, 2, 3]), width: 1024, height: 1024 },
    ]);
    const repositoryFailure = new Error("complete failed");
    const completeWithImageResults = vi.fn<
      ImageTaskRepository["completeWithImageResults"]
    >(async () => {
      throw repositoryFailure;
    });
    const failingRepository: ImageTaskRepository = {
      ...imageTaskRepository,
      completeWithImageResults,
    };
    const originalDeleteFile = fileStorage.deleteFile;
    const deleteFile = vi
      .spyOn(fileStorage, "deleteFile")
      .mockImplementation(originalDeleteFile);

    const result = await service(
      { generate },
      undefined,
      failingRepository,
    ).run({
      prompt: "两张方图",
      size: "1024x1024",
      n: 2,
    });

    expect(result).toMatchObject({
      status: "failed",
      failure: { reason: "unknown_error" },
      history: {
        status: "failed",
        errorSummary: { reason: "unknown_error" },
      },
    });
    expect(result.history).not.toBeNull();
    expect(completeWithImageResults).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(deleteFile.mock.calls.map(([filePath]) => filePath)).toEqual(
      expect.arrayContaining([
        "image-results/image-result-1.png",
        "image-results/image-result-2.png",
      ]),
    );
    expect(fileStorage.files.size).toBe(0);
    await expect(imageTaskRepository.listImageResults()).resolves.toEqual([]);
    await expect(imageTaskRepository.listHistories()).resolves.toEqual([
      expect.objectContaining({ status: "failed" }),
    ]);
  });

  it("running history 落库后、模型调用前恰好通知一次，且成功结果沿用同一 id", async () => {
    await createReadyDefaultImageConfiguration();
    const events: string[] = [];
    const onHistoryCreated = vi.fn<ImageTaskHistoryCreatedCallback>(
      async (history) => {
        events.push(`history:${history.id}`);
        expect(history.status).toBe("running");
        await expect(imageTaskRepository.getHistory(history.id)).resolves.toEqual(
          history,
        );
      },
    );
    const generate = vi.fn<ImageModelClient["generate"]>(async () => {
      events.push("model");
      return {
        base64: "aW1hZ2U=",
        width: 1024,
        height: 1024,
      };
    });

    const result = await promptdexService(
      { generate },
      onHistoryCreated,
    ).run({
      template: promptdexTemplate,
      taskInputs: { content: "核心内容" },
      size: "1024x1024",
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") {
      throw new Error("预期图片生成成功");
    }
    expect(onHistoryCreated).toHaveBeenCalledTimes(1);
    expect(onHistoryCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.history.id,
        status: "running",
      }),
    );
    expect(events).toEqual([`history:${result.history.id}`, "model"]);
  });

  it("生命周期回调异常只记录 warning，失败历史仍沿用回调收到的 id 并完成收口", async () => {
    await createReadyDefaultImageConfiguration();
    const callbackError = new Error("callback failed");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onHistoryCreated = vi.fn<ImageTaskHistoryCreatedCallback>(() => {
      throw callbackError;
    });
    const generate = vi.fn<ImageModelClient["generate"]>(async () => {
      throw new ImageTaskExecutionError(
        "server_error",
        "secret provider message",
        500,
        "internal",
      );
    });

    const result = await service({ generate }, onHistoryCreated).run({
      prompt: "一张方图",
      size: "1024x1024",
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed" || result.history === null) {
      throw new Error("预期图片生成失败且历史已完成收口");
    }
    expect(onHistoryCreated).toHaveBeenCalledTimes(1);
    expect(onHistoryCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.history.id,
        status: "running",
      }),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      "[image-tasks] running history 生命周期回调失败",
      callbackError,
    );
    await expect(imageTaskRepository.getHistory(result.history.id)).resolves
      .toMatchObject({
        id: result.history.id,
        status: "failed",
      });
    warning.mockRestore();
  });

  it("成功调用返回二进制图片时写入图片文件", async () => {
    await createReadyDefaultImageConfiguration();
    const bytes = new Uint8Array([1, 2, 3]);
    const generate = vi.fn<ImageModelClient["generate"]>(async () => ({
      bytes,
      width: 1024,
      height: 1024,
    }));

    const result = await service({ generate }).run({
      prompt: "一张方图",
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "succeeded",
      imageResult: {
        filePath: "image-results/image-result-1.png",
        format: "png",
      },
    });
    expect(fileStorage.files.get("image-results/image-result-1.png")).toEqual(
      bytes,
    );
  });

  it("模型调用失败时写入安全错误摘要", async () => {
    await createReadyDefaultImageConfiguration();
    const generate = vi.fn<ImageModelClient["generate"]>(async () => {
      throw new ImageTaskExecutionError(
        "rate_limited",
        "secret provider message",
        429,
        "rate_limit_exceeded",
      );
    });

    const result = await service({ generate }).run({
      prompt: "一张方图",
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "failed",
      failure: {
        reason: "rate_limited",
        message: "模型服务请求受到限流，请稍后重试。",
        statusCode: 429,
        providerCode: "rate_limit_exceeded",
      },
      history: {
        status: "failed",
        errorSummary: {
          reason: "rate_limited",
          message: "模型服务请求受到限流，请稍后重试。",
        },
      },
    });
    expect(fileStorage.files.size).toBe(0);
    await expect(imageTaskRepository.listImageResults()).resolves.toEqual([]);
  });

  it("Promptdex 生成任务缺少默认就绪图片模型配置时不创建任务历史", async () => {
    const generate = vi.fn<ImageModelClient["generate"]>();

    const result = await promptdexService({ generate }).run({
      template: promptdexTemplate,
      taskInputs: { content: "核心内容" },
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "failed",
      history: null,
      failure: {
        reason: "missing_default_model_configuration",
      },
    });
    expect(generate).not.toHaveBeenCalled();
    await expect(imageTaskRepository.listHistories()).resolves.toEqual([]);
  });

  it("Promptdex 生成任务缺少必需输入时不创建任务历史", async () => {
    await createReadyDefaultImageConfiguration();
    const generate = vi.fn<ImageModelClient["generate"]>();

    const result = await promptdexService({ generate }).run({
      template: promptdexTemplate,
      taskInputs: { title: "辅助标题" },
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "failed",
      history: null,
      failure: {
        reason: "invalid_input",
      },
    });
    expect(generate).not.toHaveBeenCalled();
    await expect(imageTaskRepository.listHistories()).resolves.toEqual([]);
  });

  it("Promptdex 生成任务成功时写入完整提示词、快照和图片结果", async () => {
    await createReadyDefaultImageConfiguration();
    const generate = vi.fn<ImageModelClient["generate"]>(async () => ({
      base64: "aW1hZ2U=",
      width: 1024,
      height: 1024,
    }));

    const result = await promptdexService({ generate }).run({
      template: promptdexTemplate,
      taskInputs: {
        content: "  核心内容  ",
        title: "   ",
      },
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "succeeded",
      history: {
        status: "completed",
        snapshot: {
          source: "promptdex",
          promptdexEntry: {
            name: "light-card",
            sourceType: "built-in",
            taskType: "generate",
          },
          taskInputs: {
            content: "核心内容",
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
        },
      },
      imageResult: {
        filePath: "image-results/image-result-1.png",
      },
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("### content\n核心内容"),
      }),
    );
    expect(generate.mock.calls[0]?.[0].prompt).not.toContain("### title");
    if (result.status === "succeeded") {
      expect(result.history.snapshot.source).toBe("promptdex");
      if (result.history.snapshot.source === "promptdex") {
        expect(result.history.snapshot.fullPrompt).toBe(
          generate.mock.calls[0]?.[0].prompt,
        );
      }
    }
  });

  it("Promptdex 模型调用失败时保留可解释的任务快照", async () => {
    await createReadyDefaultImageConfiguration();
    const generate = vi.fn<ImageModelClient["generate"]>(async () => {
      throw new ImageTaskExecutionError(
        "server_error",
        "secret provider message",
        500,
        "internal",
      );
    });

    const result = await promptdexService({ generate }).run({
      template: promptdexTemplate,
      taskInputs: { content: "核心内容" },
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "failed",
      failure: {
        reason: "server_error",
      },
      history: {
        status: "failed",
        snapshot: {
          source: "promptdex",
          promptdexEntry: {
            name: "light-card",
            description: "浅色卡片",
          },
          taskInputs: {
            content: "核心内容",
          },
        },
      },
    });
    await expect(imageTaskRepository.listImageResults()).resolves.toEqual([]);
  });

  it("Promptdex 凭据缺失时创建失败历史并清除就绪状态和默认引用", async () => {
    const configuration = await createReadyDefaultImageConfiguration();
    await credentials.delete(configuration.id);
    const generate = vi.fn<ImageModelClient["generate"]>();

    const result = await promptdexService({ generate }).run({
      template: promptdexTemplate,
      taskInputs: { content: "核心内容" },
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "failed",
      failure: {
        reason: "missing_credential",
      },
      history: {
        status: "failed",
        snapshot: {
          source: "promptdex",
          promptdexEntry: {
            name: "light-card",
          },
        },
      },
    });
    expect(generate).not.toHaveBeenCalled();
    await expect(modelRepository.get(configuration.id)).resolves.toMatchObject({
      hasCredential: false,
      isReady: false,
      lastTestSucceededAt: null,
    });
    await expect(modelRepository.getSettings()).resolves.toMatchObject({
      defaultImageModelConfigurationId: null,
    });
  });

  it("Promptdex 编辑任务不可执行且不创建任务历史", async () => {
    await createReadyDefaultImageConfiguration();
    const generate = vi.fn<ImageModelClient["generate"]>();

    const result = await promptdexService({ generate }).run({
      template: editPromptdexTemplate,
      taskInputs: {
        image: "file:///input.png",
        instruction: "改成蓝色",
      },
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "failed",
      history: null,
      failure: {
        reason: "invalid_input",
      },
    });
    expect(generate).not.toHaveBeenCalled();
    await expect(imageTaskRepository.listHistories()).resolves.toEqual([]);
  });
});

const promptdexTemplate = parsePromptdexTemplate(
  `---
name: light-card
description: 浅色卡片
inputs:
  content:
    required: true
    description: 主要内容
  title:
    required: false
    description: 标题
---

# 浅色卡片

保持简洁。`,
  "light-card.md",
);

const editPromptdexTemplate = parsePromptdexTemplate(
  `---
name: edit-card
description: 编辑卡片
inputs:
  image:
    required: true
    description: 原图
  instruction:
    required: true
    description: 编辑要求
---

# 编辑卡片

保持主体。`,
  "edit-card.md",
);
