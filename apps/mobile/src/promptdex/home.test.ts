import { beforeEach, describe, expect, it } from "vitest";
import { parsePromptdexTemplate } from "@imagemon/core";

import {
  createImageTaskRepository,
  createMemoryImageTaskStore,
  type ImageResult,
  type ImageTaskFailureSummary,
  type ImageTaskHistory,
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
import {
  classifyPromptdexEntryImages,
  createPromptdexHomeService,
  type PromptdexHomeEntryIdentity,
} from "./home";

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
    expect(home.generatedEntries[0].taskHistoryIds).toEqual([
      "history-new",
      "history-old",
    ]);
    expect(home.otherImages).toEqual([]);
  });

  it("按条目身份列出完成状态历史图片并按创建时间倒序", async () => {
    const homeService = service(["detail-entry"]);
    await insertPromptdexImage({
      id: "detail-image-old",
      historyId: "detail-history-old",
      entryName: "detail-entry",
      createdAt: "2026-07-02T09:00:00.000Z",
    });
    await insertPromptdexImage({
      id: "detail-image-new",
      historyId: "detail-history-new",
      entryName: "detail-entry",
      createdAt: "2026-07-02T11:00:00.000Z",
    });
    await insertPromptdexImage({
      id: "detail-image-personal",
      historyId: "detail-history-personal",
      entryName: "detail-entry",
      sourceType: "personal",
      createdAt: "2026-07-02T12:00:00.000Z",
    });
    await insertPromptdexImage({
      id: "detail-image-failed",
      historyId: "detail-history-failed",
      entryName: "detail-entry",
      createdAt: "2026-07-02T13:00:00.000Z",
      status: "failed",
    });

    const images = await homeService.listEntryImages({
      sourceType: "built-in",
      name: "detail-entry",
    });

    expect(images.map((item) => item.imageResult.id)).toEqual([
      "detail-image-new",
      "detail-image-old",
    ]);
    expect(images.map((item) => item.taskHistory.id)).toEqual([
      "detail-history-new",
      "detail-history-old",
    ]);
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

  it("个人条目覆盖同名内置条目时历史内置图片不归入当前个人条目", async () => {
    await personalRepository.saveFromTemplate(createTemplate("shared-entry"));
    const homeService = service(["shared-entry"]);
    await insertPromptdexImage({
      id: "image-built-in-history",
      historyId: "history-built-in-history",
      entryName: "shared-entry",
      sourceType: "built-in",
      createdAt: "2026-07-02T10:00:00.000Z",
    });

    const home = await homeService.getHome();

    expect(
      home.ungeneratedEntries.map((entry) => `${entry.sourceType}:${entry.name}`),
    ).toEqual(["personal:shared-entry"]);
    expect(home.generatedEntries).toEqual([]);
    expect(home.otherImages.map((item) => item.imageResult.id)).toEqual([
      "image-built-in-history",
    ]);
  });

  it("Promptdex 图片结果关联任务历史缺失后进入其他图片", async () => {
    const homeService = service(["deleted-history-entry"]);
    await imageTaskRepository.insertImageResult({
      id: "deleted-history-image",
      taskHistoryId: "deleted-promptdex-history",
      filePath: "image-results/deleted-history-image.png",
      format: "png",
      width: 1024,
      height: 1024,
      createdAt: "2026-07-02T10:00:00.000Z",
    });

    const home = await homeService.getHome();

    expect(home.generatedEntries).toEqual([]);
    expect(home.ungeneratedEntries.map((entry) => entry.name)).toEqual([
      "deleted-history-entry",
    ]);
    expect(home.otherImages).toMatchObject([
      {
        imageResult: {
          id: "deleted-history-image",
        },
        taskHistory: null,
      },
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
    expect(home.otherImages).toEqual([]);
  });

  it("条目提示所需的任务历史 id 会跨多图去重", async () => {
    const homeService = service(["multi-image-entry"]);
    await insertPromptdexImage({
      id: "image-primary",
      historyId: "history-multi",
      entryName: "multi-image-entry",
      createdAt: "2026-07-02T11:00:00.000Z",
    });
    await imageTaskRepository.insertImageResult({
      id: "image-secondary",
      taskHistoryId: "history-multi",
      filePath: "image-results/image-secondary.png",
      format: "png",
      width: 1024,
      height: 1024,
      createdAt: "2026-07-02T10:59:00.000Z",
    });

    const home = await homeService.getHome();

    expect(home.generatedEntries[0].taskHistoryIds).toEqual([
      "history-multi",
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

describe("classifyPromptdexEntryImages", () => {
  it("对完整合并条目复用权威匹配并保留代表图所需字段", () => {
    interface BackupEntry extends PromptdexHomeEntryIdentity {
      body: string;
    }

    const generatedEntry: BackupEntry = {
      sourceType: "built-in",
      name: "shared-entry",
      body: "内置模板正文",
    };
    const ungeneratedEntry: BackupEntry = {
      sourceType: "personal",
      name: "waiting-entry",
      body: "个人模板正文",
    };
    const entries = Object.freeze([generatedEntry, ungeneratedEntry]);
    const taskHistories = Object.freeze([
      createTestPromptdexHistory("history-old", "shared-entry"),
      createTestPromptdexHistory("history-a", "shared-entry"),
      createTestPromptdexHistory("history-z", "shared-entry"),
      createTestPromptdexHistory(
        "history-wrong-source",
        "shared-entry",
        "personal",
      ),
      createTestPromptdexHistory(
        "history-failed",
        "shared-entry",
        "built-in",
        "failed",
      ),
    ]);
    const imageResults = Object.freeze([
      createTestImageResult(
        "image-old",
        "history-old",
        "2026-07-02T09:00:00.000Z",
      ),
      createTestImageResult(
        "image-a",
        "history-a",
        "2026-07-02T11:00:00.000Z",
      ),
      createTestImageResult(
        "image-z",
        "history-z",
        "2026-07-02T11:00:00.000Z",
      ),
      createTestImageResult(
        "image-wrong-source",
        "history-wrong-source",
        "2026-07-02T12:00:00.000Z",
      ),
      createTestImageResult(
        "image-failed",
        "history-failed",
        "2026-07-02T13:00:00.000Z",
      ),
    ]);

    const classified = classifyPromptdexEntryImages({
      entries,
      imageResults,
      taskHistories,
    });

    expect(classified.generatedEntries).toHaveLength(1);
    expect(classified.generatedEntries[0].entry).toBe(generatedEntry);
    expect(classified.generatedEntries[0].entry.body).toBe("内置模板正文");
    expect(
      classified.generatedEntries[0].representativeImage.imageResult.id,
    ).toBe("image-z");
    expect(classified.generatedEntries[0].taskHistoryIds).toEqual([
      "history-z",
      "history-a",
      "history-old",
    ]);
    expect(classified.ungeneratedEntries).toEqual([ungeneratedEntry]);
    expect(
      classified.otherImages.map(({ imageResult }) => imageResult.id),
    ).toEqual(["image-wrong-source"]);
    expect(imageResults.map(({ id }) => id)).toEqual([
      "image-old",
      "image-a",
      "image-z",
      "image-wrong-source",
      "image-failed",
    ]);
  });
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

function createTestPromptdexHistory(
  id: string,
  entryName: string,
  sourceType: PromptdexEntrySourceType = "built-in",
  status: "completed" | "failed" = "completed",
): ImageTaskHistory {
  const timestamp = "2026-07-02T08:00:00.000Z";
  return {
    id,
    taskType: "generate",
    status,
    snapshot: createPromptdexSnapshot(entryName, sourceType),
    errorSummary: status === "failed" ? createFailureSummary(timestamp) : null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
  };
}

function createTestImageResult(
  id: string,
  taskHistoryId: string,
  createdAt: string,
): ImageResult {
  return {
    id,
    taskHistoryId,
    filePath: `image-results/${id}.png`,
    format: "png",
    width: 1024,
    height: 1024,
    createdAt,
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
