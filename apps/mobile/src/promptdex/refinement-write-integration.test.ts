import { describe, expect, it, vi } from "vitest";
import { parsePromptdexTemplate } from "@imagemon/core";

import {
  createMemoryImageResultFileStorage,
  createImageTaskRepository,
  createMemoryImageTaskStore,
  createPromptdexImageGenerationTaskService,
  type ImageModelClient,
} from "../image-tasks";
import {
  createMemoryModelConfigurationCredentialAdapter,
} from "../storage";
import {
  createMemoryModelConfigurationStore,
  createModelConfigurationRepository,
} from "../model-configurations";
import {
  createMemoryPersonalPromptdexEntryStore,
  createMergedPromptdexCatalogService,
  createPersonalPromptdexEntryRepository,
} from "./index";

describe("Personal Promptdex refinement write path", () => {
  it("提炼确认后的模板可写入个人图鉴并用于 Promptdex 任务快照", async () => {
    let timeCounter = 0;
    const now = () =>
      `2026-07-02T00:00:${String(++timeCounter).padStart(2, "0")}.000Z`;
    const personalRepository = createPersonalPromptdexEntryRepository({
      store: createMemoryPersonalPromptdexEntryStore(),
      now,
    });
    const catalogService = createMergedPromptdexCatalogService({
      personalRepository,
      builtInSources: [],
    });
    const refinedTemplate = parsePromptdexTemplate(
      `---
name: refined-light-poster
description: 从提炼结果生成浅色海报
inputs:
  content:
    required: true
    description: 海报正文
---

# 浅色海报

根据输入内容生成清爽的单张海报。`,
      "refined-light-poster.md",
    );

    await personalRepository.saveFromTemplate(refinedTemplate);
    const entry = await catalogService.get("refined-light-poster");

    expect(entry).toMatchObject({
      sourceType: "personal",
      template: {
        name: "refined-light-poster",
      },
    });
    expect(entry).not.toBeNull();
    if (!entry) {
      return;
    }

    const modelRepository = createModelConfigurationRepository({
      store: createMemoryModelConfigurationStore({ now }),
      credentials: createMemoryModelConfigurationCredentialAdapter(),
      generateId: () => "config-1",
      now,
    });
    const configuration = await modelRepository.save({
      type: "image",
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-image-2",
      apiKey: "sk-test",
    });
    await modelRepository.markReady(configuration.id, "2026-07-02T01:00:00.000Z");
    await modelRepository.setDefault("image", configuration.id);

    const imageTaskRepository = createImageTaskRepository({
      store: createMemoryImageTaskStore(),
      generateId: () => "history-1",
      now,
    });
    const fileStorage = createMemoryImageResultFileStorage();
    const generate = vi.fn<ImageModelClient["generate"]>(async () => ({
      base64: "aW1hZ2U=",
      width: 1024,
      height: 1024,
    }));

    const result = await createPromptdexImageGenerationTaskService({
      imageTaskRepository,
      modelConfigurationRepository: modelRepository,
      fileStorage,
      imageModelClient: { generate },
      generateId: () => "image-result-1",
      now,
    }).run({
      template: entry.template,
      sourceType: entry.sourceType,
      taskInputs: {
        content: "给团队发布会使用的轻量说明",
      },
      size: "1024x1024",
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") {
      return;
    }
    expect(result.history.snapshot).toMatchObject({
      source: "promptdex",
      promptdexEntry: {
        name: "refined-light-poster",
        sourceType: "personal",
        body: "# 浅色海报\n\n根据输入内容生成清爽的单张海报。",
      },
      taskInputs: {
        content: "给团队发布会使用的轻量说明",
      },
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("给团队发布会使用的轻量说明"),
      }),
    );
  });
});
