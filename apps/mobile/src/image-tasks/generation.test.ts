import { beforeEach, describe, expect, it, vi } from "vitest";

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
  type ImageModelClient,
  type ImageTaskRepository,
} from "./index";

describe("ImageGenerationTaskService", () => {
  let modelRepository: ModelConfigurationRepository;
  let credentials: ModelConfigurationCredentialAdapter;
  let imageTaskRepository: ImageTaskRepository;
  let fileStorage: ReturnType<typeof createMemoryImageResultFileStorage>;
  let timeCounter: number;

  beforeEach(() => {
    timeCounter = 0;
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

  function service(imageModelClient: ImageModelClient) {
    return createImageGenerationTaskService({
      imageTaskRepository,
      modelConfigurationRepository: modelRepository,
      fileStorage,
      imageModelClient,
      generateId: () => "image-result-1",
      now,
    });
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
});
