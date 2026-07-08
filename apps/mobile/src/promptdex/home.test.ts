import { beforeEach, describe, expect, it } from "vitest";
import { parsePromptdexTemplate } from "@imagemon/core";

import {
  createImageTaskRepository,
  createMemoryImageTaskStore,
  type ImageTaskFailureSummary,
  type ImageTaskRepository,
  type ImageTaskSnapshot,
  type PromptdexEntrySourceType,
} from "../image-tasks";
import {
  createMemoryPersonalPromptdexEntryStore,
  createMergedPromptdexCatalogService,
  createPersonalPromptdexEntryRepository,
  type MergedPromptdexCatalogService,
} from "./index";
import { createPromptdexHomeService } from "./home";

describe("PromptdexHomeService", () => {
  let imageTaskRepository: ImageTaskRepository;
  let personalRepository: ReturnType<typeof createPersonalPromptdexEntryRepository>;
  let idCounter: number;

  beforeEach(() => {
    idCounter = 0;
    imageTaskRepository = createImageTaskRepository({
      store: createMemoryImageTaskStore(),
      generateId: () => `id-${++idCounter}`,
      now: () => `2026-07-02T00:00:${String(++idCounter).padStart(2, "0")}.000Z`,
    });
    personalRepository = createPersonalPromptdexEntryRepository({
      store: createMemoryPersonalPromptdexEntryStore(),
      now: () => "2026-07-02T00:00:00.000Z",
    });
  });

  it("完成状态 promptdex 图片把条目归入已生成", async () => {
    const homeService = service(["portrait-entry"]);
    await insertPromptdexImage({
      id: "image-portrait",
      historyId: "history-portrait",
      entryName: "portrait-entry",
      createdAt: "2026-07-02T10:00:00.000Z",
    });

    const home = await homeService.getHome();

    expect(home.generatedEntries).toHaveLength(1);
    expect(home.generatedEntries[0]).toMatchObject({
      entry: {
        sourceType: "built-in",
        name: "portrait-entry",
      },
      representativeImage: {
        imageResult: {
          id: "image-portrait",
          filePath: "image-results/image-portrait.png",
        },
        taskHistory: {
          id: "history-portrait",
          status: "completed",
        },
      },
    });
    expect(home.ungeneratedEntries).toEqual([]);
    expect(home.otherImages).toEqual([]);
  });

  it("同一条目的最新图片成为代表图且旧图片不进入其他图片", async () => {
    const homeService = service(["landscape-entry"]);
    await insertPromptdexImage({
      id: "image-old",
      historyId: "history-old",
      entryName: "landscape-entry",
      createdAt: "2026-07-02T09:00:00.000Z",
    });
    await insertPromptdexImage({
      id: "image-new",
      historyId: "history-new",
      entryName: "landscape-entry",
      createdAt: "2026-07-02T11:00:00.000Z",
    });

    const home = await homeService.getHome();

    expect(home.generatedEntries.map((entry) => entry.entry.name)).toEqual([
      "landscape-entry",
    ]);
    expect(
      home.generatedEntries[0].representativeImage.imageResult.id,
    ).toBe("image-new");
    expect(home.otherImages).toEqual([]);
  });

  it("缺失图片结果时条目回到未生成", async () => {
    const homeService = service(["missing-result-entry"]);
    const history = await imageTaskRepository.createRunningHistory({
      id: "history-without-image",
      snapshot: createPromptdexSnapshot("missing-result-entry"),
    });
    await imageTaskRepository.markCompleted(
      history.id,
      "2026-07-02T12:00:00.000Z",
    );

    const home = await homeService.getHome();

    expect(home.generatedEntries).toEqual([]);
    expect(home.ungeneratedEntries.map((entry) => entry.name)).toEqual([
      "missing-result-entry",
    ]);
    expect(home.otherImages).toEqual([]);
  });

  it("同名但来源类型不同不匹配", async () => {
    const homeService = service(["shared-entry"]);
    await insertPromptdexImage({
      id: "image-personal",
      historyId: "history-personal",
      entryName: "shared-entry",
      sourceType: "personal",
      createdAt: "2026-07-02T10:00:00.000Z",
    });

    const home = await homeService.getHome();

    expect(home.generatedEntries).toEqual([]);
    expect(home.ungeneratedEntries.map((entry) => entry.name)).toEqual([
      "shared-entry",
    ]);
    expect(home.otherImages.map((item) => item.imageResult.id)).toEqual([
      "image-personal",
    ]);
  });

  it("失败、进行中和状态未知任务不让条目进入已生成", async () => {
    const homeService = service([
      "failed-entry",
      "running-entry",
      "unknown-entry",
    ]);
    await insertPromptdexImage({
      id: "image-failed",
      historyId: "history-failed",
      entryName: "failed-entry",
      createdAt: "2026-07-02T10:00:00.000Z",
      status: "failed",
    });
    await insertPromptdexImage({
      id: "image-unknown",
      historyId: "history-unknown",
      entryName: "unknown-entry",
      createdAt: "2026-07-02T11:00:00.000Z",
      status: "unknown",
    });
    await insertPromptdexImage({
      id: "image-running",
      historyId: "history-running",
      entryName: "running-entry",
      createdAt: "2026-07-02T12:00:00.000Z",
      status: "running",
    });

    const home = await homeService.getHome();

    expect(home.generatedEntries).toEqual([]);
    expect(home.ungeneratedEntries.map((entry) => entry.name)).toEqual([
      "failed-entry",
      "running-entry",
      "unknown-entry",
    ]);
  });

  it("manual 和缺失历史的图片进入其他图片", async () => {
    const homeService = service(["catalog-entry"]);
    await insertManualImage({
      id: "manual-image",
      historyId: "manual-history",
      createdAt: "2026-07-02T10:00:00.000Z",
    });
    await imageTaskRepository.insertImageResult({
      id: "missing-history-image",
      taskHistoryId: "deleted-history",
      filePath: "image-results/missing-history-image.png",
      format: "png",
      width: 1024,
      height: 1024,
      createdAt: "2026-07-02T11:00:00.000Z",
    });
    await imageTaskRepository.insertImageResult({
      id: "unlinked-image",
      taskHistoryId: null,
      filePath: "image-results/unlinked-image.png",
      format: "png",
      width: 1024,
      height: 1024,
      createdAt: "2026-07-02T12:00:00.000Z",
    });

    const home = await homeService.getHome();

    expect(home.generatedEntries).toEqual([]);
    expect(home.otherImages.map((item) => item.imageResult.id)).toEqual([
      "unlinked-image",
      "missing-history-image",
      "manual-image",
    ]);
    expect(home.otherImages.map((item) => item.taskHistory?.id ?? null)).toEqual([
      null,
      null,
      "manual-history",
    ]);
  });

  it("未生成条目保留当前合并图鉴顺序", async () => {
    await personalRepository.saveFromTemplate(createTemplate("z-personal"));
    await personalRepository.saveFromTemplate(createTemplate("alpha-personal"));
    const homeService = service(["z-built-in", "alpha-built-in"]);

    const home = await homeService.getHome();

    expect(
      home.ungeneratedEntries.map((entry) => `${entry.sourceType}:${entry.name}`),
    ).toEqual([
      "personal:alpha-personal",
      "personal:z-personal",
      "built-in:alpha-built-in",
      "built-in:z-built-in",
    ]);
  });

  function service(entryNames: string[]) {
    return createPromptdexHomeService({
      promptdexCatalogService: catalogService(entryNames),
      imageTaskRepository,
    });
  }

  function catalogService(entryNames: string[]): MergedPromptdexCatalogService {
    return createMergedPromptdexCatalogService({
      personalRepository,
      builtInSources: entryNames.map(createTemplateSource),
    });
  }

  async function insertPromptdexImage({
    id,
    historyId,
    entryName,
    createdAt,
    sourceType = "built-in",
    status = "completed",
  }: {
    id: string;
    historyId: string;
    entryName: string;
    createdAt: string;
    sourceType?: PromptdexEntrySourceType;
    status?: "completed" | "failed" | "running" | "unknown";
  }) {
    const history = await imageTaskRepository.createRunningHistory({
      id: historyId,
      snapshot: createPromptdexSnapshot(entryName, sourceType),
    });
    await imageTaskRepository.insertImageResult({
      id,
      taskHistoryId: history.id,
      filePath: `image-results/${id}.png`,
      format: "png",
      width: 1024,
      height: 1024,
      createdAt,
    });

    if (status === "completed") {
      await imageTaskRepository.markCompleted(history.id, createdAt);
    }
    if (status === "failed") {
      await imageTaskRepository.markFailed(
        history.id,
        createFailureSummary(createdAt),
        createdAt,
      );
    }
    if (status === "unknown") {
      await imageTaskRepository.markRunningHistoriesUnknown(createdAt);
    }
  }

  async function insertManualImage({
    id,
    historyId,
    createdAt,
  }: {
    id: string;
    historyId: string;
    createdAt: string;
  }) {
    const history = await imageTaskRepository.createRunningHistory({
      id: historyId,
      snapshot: manualSnapshot,
    });
    await imageTaskRepository.insertImageResult({
      id,
      taskHistoryId: history.id,
      filePath: `image-results/${id}.png`,
      format: "png",
      width: 1024,
      height: 1024,
      createdAt,
    });
    await imageTaskRepository.markCompleted(history.id, createdAt);
  }
});

function createPromptdexSnapshot(
  name: string,
  sourceType: PromptdexEntrySourceType = "built-in",
): ImageTaskSnapshot {
  return {
    source: "promptdex",
    promptdexEntry: {
      name,
      description: `${name} 描述`,
      sourceType,
      taskType: "generate",
      inputs: {
        subject: {
          required: true,
          description: "画面主体",
        },
      },
      body: "模板正文",
    },
    taskInputs: {
      subject: "玻璃花瓶",
    },
    imageSpec: imageSpec,
    modelConfiguration: modelConfiguration,
    fullPrompt: "完整提示词",
  };
}

const imageSpec = {
  size: "1024x1024" as const,
  quality: "auto" as const,
  format: "png" as const,
  n: 1 as const,
};

const modelConfiguration = {
  type: "image" as const,
  baseUrl: "https://api.openai.com/v1",
  modelName: "gpt-image-2",
};

const manualSnapshot: ImageTaskSnapshot = {
  source: "manual",
  prompt: "一只蓝色玻璃花瓶",
  imageSpec: imageSpec,
  modelConfiguration: modelConfiguration,
};

function createFailureSummary(occurredAt: string): ImageTaskFailureSummary {
  return {
    reason: "network_error",
    message: "无法连接模型服务。",
    occurredAt,
  };
}

function createTemplate(name: string) {
  return parsePromptdexTemplate(createTemplateSource(name).source, `${name}.md`);
}

function createTemplateSource(name: string) {
  return {
    fileName: `${name}.md`,
    source: `---
name: ${name}
description: ${name} 描述
inputs:
  subject:
    required: true
    description: 画面主体
---

模板正文`,
  };
}
