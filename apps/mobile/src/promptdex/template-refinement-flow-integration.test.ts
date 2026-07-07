import { describe, expect, it, vi } from "vitest";

import {
  createMemoryModelConfigurationCredentialAdapter,
} from "../storage";
import {
  createMemoryModelConfigurationStore,
  createModelConfigurationRepository,
} from "../model-configurations";
import {
  createMemoryPersonalPromptdexEntryStore,
  createMemoryTemplateRefinementDraftStore,
  createMergedPromptdexCatalogService,
  createPersonalPromptdexEntryRepository,
  createTemplateRefinementDraftRepository,
  createTemplateRefinementService,
  type TemplateRefinementTextModelClient,
} from "./index";

describe("Template refinement flow", () => {
  it("从模型 JSON 提炼方案确认写入个人图鉴并清除草稿", async () => {
    let timeCounter = 0;
    const now = () =>
      `2026-07-04T00:00:${String(++timeCounter).padStart(2, "0")}.000Z`;
    const modelRepository = createModelConfigurationRepository({
      store: createMemoryModelConfigurationStore({ now }),
      credentials: createMemoryModelConfigurationCredentialAdapter(),
      generateId: () => "text-config-1",
      now,
    });
    const configuration = await modelRepository.save({
      type: "text",
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5-mini",
      apiKey: "sk-test",
    });
    await modelRepository.markReady(configuration.id, "2026-07-04T01:00:00.000Z");
    await modelRepository.setDefault("text", configuration.id);

    const draftRepository = createTemplateRefinementDraftRepository({
      store: createMemoryTemplateRefinementDraftStore(),
      now,
    });
    const personalRepository = createPersonalPromptdexEntryRepository({
      store: createMemoryPersonalPromptdexEntryStore(),
      now,
    });
    const catalogService = createMergedPromptdexCatalogService({
      personalRepository,
      builtInSources: [],
    });
    const generateProposalJson = vi.fn<
      TemplateRefinementTextModelClient["generateProposalJson"]
    >(async () => validProposal());

    const service = createTemplateRefinementService({
      draftRepository,
      modelConfigurationRepository: modelRepository,
      personalPromptdexEntryRepository: personalRepository,
      promptdexCatalogService: catalogService,
      textModelClient: {
        generateProposalJson,
      },
      now,
    });

    const generation = await service.generate({
      externalPrompt: "外部完整提示词：包含一次性项目名称与来源 URL。",
      plannedUse: "为团队周报生成可复用浅色摘要图模板。",
    });

    expect(generation).toMatchObject({
      status: "ready_for_review",
      draft: {
        status: "ready_for_review",
        proposal: {
          template: {
            name: "weekly-summary-card",
          },
        },
      },
    });
    expect(generateProposalJson).toHaveBeenCalledOnce();

    const write = await service.confirmWrite();

    expect(write).toMatchObject({
      status: "succeeded",
      entry: {
        sourceType: "personal",
        name: "weekly-summary-card",
      },
    });
    await expect(draftRepository.get()).resolves.toBeNull();

    const entries = await catalogService.list();
    expect(entries).toMatchObject([
      {
        sourceType: "personal",
        name: "weekly-summary-card",
      },
    ]);
    const entry = await catalogService.get("weekly-summary-card");
    expect(entry).toMatchObject({
      sourceType: "personal",
      template: {
        body: "# 周报摘要卡片\n\n生成浅色、清晰、适合团队周报的摘要图。",
      },
    });
    expect(JSON.stringify(entry)).not.toContain("外部完整提示词");
    expect(JSON.stringify(entry)).not.toContain("来源 URL");
  });
});

function validProposal() {
  return {
    template: {
      name: "weekly-summary-card",
      description: "团队周报摘要图",
      inputs: {
        content: {
          required: true,
          description: "周报正文",
        },
      },
      body: "# 周报摘要卡片\n\n生成浅色、清晰、适合团队周报的摘要图。",
    },
    taskTypeRationale: "未声明 image 输入，因此是生成任务。",
    retainedRules: ["保留浅色背景和分层摘要"],
    removedRules: [
      {
        summary: "移除一次性项目名称",
        reason: "项目名称应由每次任务输入提供。",
      },
    ],
    additions: [],
  };
}
