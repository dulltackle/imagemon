import { parsePromptdexTemplate } from "@imagemon/core";
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
  createImageTaskRepository,
  createMemoryImageResultFileStorage,
  createMemoryImageTaskInternalAttachmentStorage,
  createMemoryImageTaskStore,
  createPromptdexImageEditTaskService,
  type ImageModelClient,
  type ImageTaskRepository,
} from "./index";
import type { PickedEditInputImage } from "./picked-image";

describe("PromptdexImageEditTaskService", () => {
  let modelRepository: ModelConfigurationRepository;
  let credentials: ModelConfigurationCredentialAdapter;
  let imageTaskRepository: ImageTaskRepository;
  let fileStorage: ReturnType<typeof createMemoryImageResultFileStorage>;
  let attachmentStorage: ReturnType<
    typeof createMemoryImageTaskInternalAttachmentStorage
  >;
  let timeCounter: number;
  let idQueue: string[];

  beforeEach(() => {
    timeCounter = 0;
    idQueue = ["history-edit-1", "image-result-1"];
    credentials = createMemoryModelConfigurationCredentialAdapter();
    modelRepository = createModelConfigurationRepository({
      store: createMemoryModelConfigurationStore({ now }),
      credentials,
      generateId: () => "config-1",
      now,
    });
    imageTaskRepository = createImageTaskRepository({
      store: createMemoryImageTaskStore(),
      generateId: () => `repo-history-${timeCounter}`,
      now,
    });
    fileStorage = createMemoryImageResultFileStorage();
    attachmentStorage = createMemoryImageTaskInternalAttachmentStorage();
  });

  function now() {
    return `2026-06-25T00:00:${String(++timeCounter).padStart(2, "0")}.000Z`;
  }

  function nextId() {
    return idQueue.shift() ?? `generated-${idQueue.length}`;
  }

  function service(
    edit: NonNullable<ImageModelClient["edit"]>,
    repository = imageTaskRepository,
  ) {
    return createPromptdexImageEditTaskService({
      imageTaskRepository: repository,
      modelConfigurationRepository: modelRepository,
      fileStorage,
      attachmentStorage,
      imageModelClient: { edit },
      generateId: nextId,
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
    const edit = vi.fn<NonNullable<ImageModelClient["edit"]>>();

    const result = await service(edit).run({
      template: editPromptdexTemplate,
      taskInputs: { instruction: "改成蓝色" },
      image: pickedImage,
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "failed",
      history: null,
      failure: {
        reason: "missing_default_model_configuration",
      },
    });
    expect(edit).not.toHaveBeenCalled();
    expect(attachmentStorage.files.size).toBe(0);
    await expect(imageTaskRepository.listHistories()).resolves.toEqual([]);
  });

  it("声明 mask 的编辑模板不创建任务历史", async () => {
    await createReadyDefaultImageConfiguration();
    const edit = vi.fn<NonNullable<ImageModelClient["edit"]>>();

    const result = await service(edit).run({
      template: maskPromptdexTemplate,
      taskInputs: { instruction: "保留主体" },
      image: pickedImage,
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "failed",
      history: null,
      failure: {
        reason: "invalid_input",
      },
    });
    expect(edit).not.toHaveBeenCalled();
    expect(attachmentStorage.files.size).toBe(0);
  });

  it("成功编辑时创建 edit 历史、保存附件快照和图片结果", async () => {
    await createReadyDefaultImageConfiguration();
    const edit = vi.fn<NonNullable<ImageModelClient["edit"]>>(async () => ({
      base64: "ZWRpdGVk",
      width: 1024,
      height: 1024,
    }));

    const result = await service(edit).run({
      template: editPromptdexTemplate,
      taskInputs: { instruction: "  改成蓝色  " },
      image: pickedImage,
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "succeeded",
      history: {
        id: "history-edit-1",
        taskType: "edit",
        status: "completed",
        snapshot: {
          source: "promptdex",
          promptdexEntry: {
            name: "edit-card",
            taskType: "edit",
          },
          taskInputs: {
            instruction: "改成蓝色",
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
        },
      },
      imageResult: {
        id: "image-result-1",
        taskHistoryId: "history-edit-1",
        filePath: "image-results/image-result-1.png",
      },
    });
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("### instruction\n改成蓝色"),
        image: {
          uri: "memory:///task-history-attachments/history-edit-1/image.png",
          name: "image.png",
          type: "image/png",
        },
      }),
    );
    expect(edit.mock.calls[0]?.[0].prompt).not.toContain("file:///picked/input.png");
    expect(fileStorage.files.get("image-results/image-result-1.png")).toBe(
      "ZWRpdGVk",
    );
  });

  it("缺少凭据时创建失败历史并清除就绪状态和默认引用", async () => {
    const configuration = await createReadyDefaultImageConfiguration();
    await credentials.delete(configuration.id);
    const edit = vi.fn<NonNullable<ImageModelClient["edit"]>>();

    const result = await service(edit).run({
      template: editPromptdexTemplate,
      taskInputs: { instruction: "改成蓝色" },
      image: pickedImage,
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "failed",
      failure: {
        reason: "missing_credential",
      },
      history: {
        id: "history-edit-1",
        taskType: "edit",
        status: "failed",
        snapshot: {
          source: "promptdex",
          inputAttachments: {
            image: {
              filePath: "task-history-attachments/history-edit-1/image.png",
            },
          },
        },
      },
    });
    expect(edit).not.toHaveBeenCalled();
    await expect(modelRepository.get(configuration.id)).resolves.toMatchObject({
      hasCredential: false,
      isReady: false,
      lastTestSucceededAt: null,
    });
    await expect(modelRepository.getSettings()).resolves.toMatchObject({
      defaultImageModelConfigurationId: null,
    });
  });

  it("模型调用失败时保留附件快照并保存错误摘要", async () => {
    await createReadyDefaultImageConfiguration();
    const edit = vi.fn<NonNullable<ImageModelClient["edit"]>>(async () => {
      throw new ImageTaskExecutionError(
        "server_error",
        "secret provider message",
        500,
        "internal",
      );
    });

    const result = await service(edit).run({
      template: editPromptdexTemplate,
      taskInputs: { instruction: "改成蓝色" },
      image: pickedImage,
      size: "1024x1024",
    });

    expect(result).toMatchObject({
      status: "failed",
      failure: {
        reason: "server_error",
      },
      history: {
        taskType: "edit",
        status: "failed",
        errorSummary: {
          reason: "server_error",
          message: "模型服务暂时不可用，请稍后重试。",
        },
        snapshot: {
          source: "promptdex",
          inputAttachments: {
            image: {
              filePath: "task-history-attachments/history-edit-1/image.png",
            },
          },
        },
      },
    });
    expect(attachmentStorage.files.has(
      "task-history-attachments/history-edit-1/image.png",
    )).toBe(true);
    await expect(imageTaskRepository.listImageResults()).resolves.toEqual([]);
  });

  it("附件复制成功但历史创建失败时清理附件", async () => {
    await createReadyDefaultImageConfiguration();
    const edit = vi.fn<NonNullable<ImageModelClient["edit"]>>();
    const failingRepository: ImageTaskRepository = {
      ...imageTaskRepository,
      async createRunningHistory() {
        throw new Error("insert failed");
      },
    };

    await expect(
      service(edit, failingRepository).run({
        template: editPromptdexTemplate,
        taskInputs: { instruction: "改成蓝色" },
        image: pickedImage,
        size: "1024x1024",
      }),
    ).rejects.toThrow("insert failed");

    expect(attachmentStorage.files.size).toBe(0);
    expect(edit).not.toHaveBeenCalled();
  });
});

const pickedImage: PickedEditInputImage = {
  uri: "file:///picked/input.png",
  mimeType: "image/png",
  fileName: "input.png",
  width: 1200,
  height: 800,
  byteSize: 123456,
};

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

const maskPromptdexTemplate = parsePromptdexTemplate(
  `---
name: mask-card
description: 蒙版编辑卡片
inputs:
  image:
    required: true
    description: 原图
  mask:
    required: true
    description: 蒙版
  instruction:
    required: true
    description: 编辑要求
---

# 蒙版编辑卡片

保持主体。`,
  "mask-card.md",
);
