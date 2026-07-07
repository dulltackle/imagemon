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
  createMemoryPersonalPromptdexEntryStore,
  createMemoryTemplateRefinementDraftStore,
  createMergedPromptdexCatalogService,
  createPersonalPromptdexEntryRepository,
  createTemplateRefinementDraftRepository,
  createTemplateRefinementService,
  TemplateRefinementTextModelClientError,
  type PersonalPromptdexEntryRepository,
  type TemplateRefinementDraftRepository,
  type TemplateRefinementTextModelClient,
} from "./index";

describe("TemplateRefinementService", () => {
  let timeCounter: number;
  let credentials: ModelConfigurationCredentialAdapter;
  let modelRepository: ModelConfigurationRepository;
  let draftRepository: TemplateRefinementDraftRepository;
  let personalRepository: PersonalPromptdexEntryRepository;
  let generateProposalJson: ReturnType<typeof vi.fn<TemplateRefinementTextModelClient["generateProposalJson"]>>;

  beforeEach(() => {
    timeCounter = 0;
    credentials = createMemoryModelConfigurationCredentialAdapter();
    modelRepository = createModelConfigurationRepository({
      store: createMemoryModelConfigurationStore({ now }),
      credentials,
      generateId: () => "text-config-1",
      now,
    });
    draftRepository = createTemplateRefinementDraftRepository({
      store: createMemoryTemplateRefinementDraftStore(),
      now,
    });
    personalRepository = createPersonalPromptdexEntryRepository({
      store: createMemoryPersonalPromptdexEntryStore(),
      now,
    });
    generateProposalJson = vi.fn(async () => JSON.stringify(validProposal()));
  });

  function now() {
    return `2026-07-03T00:00:${String(++timeCounter).padStart(2, "0")}.000Z`;
  }

  function service(options: { isOnline?: () => boolean; builtInSources?: Parameters<typeof createMergedPromptdexCatalogService>[0]["builtInSources"] } = {}) {
    return createTemplateRefinementService({
      draftRepository,
      modelConfigurationRepository: modelRepository,
      personalPromptdexEntryRepository: personalRepository,
      promptdexCatalogService: createMergedPromptdexCatalogService({
        personalRepository,
        builtInSources: options.builtInSources ?? [],
      }),
      textModelClient: {
        generateProposalJson,
      },
      isOnline: options.isOnline,
      now,
    });
  }

  async function createReadyDefaultTextConfiguration() {
    const configuration = await modelRepository.save({
      type: "text",
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5-mini",
      apiKey: "sk-test",
    });
    await modelRepository.markReady(configuration.id, "2026-07-03T01:00:00.000Z");
    await modelRepository.setDefault("text", configuration.id);
    return configuration;
  }

  it("本地输入校验失败时不创建草稿", async () => {
    const result = await service().generate({
      externalPrompt: "   ",
      plannedUse: "用途".repeat(501),
    });

    expect(result).toMatchObject({
      status: "invalid_input",
      issues: [
        {
          field: "externalPrompt",
          code: "required",
        },
        {
          field: "plannedUse",
          code: "too_long",
        },
      ],
    });
    await expect(draftRepository.get()).resolves.toBeNull();
    expect(generateProposalJson).not.toHaveBeenCalled();
  });

  it("缺少就绪默认文本模型配置时保存失败草稿且不调用模型", async () => {
    const result = await service().generate(input());

    expect(result).toMatchObject({
      status: "failed",
      errorSummary: {
        reason: "missing_text_model_configuration",
      },
      draft: {
        status: "failed",
        externalPrompt: "外部完整提示词",
        plannedUse: "计划用途",
      },
    });
    expect(generateProposalJson).not.toHaveBeenCalled();
    await expect(personalRepository.list()).resolves.toEqual([]);
  });

  it("缺少安全存储凭据时保存失败草稿且不写入个人图鉴", async () => {
    const configuration = await createReadyDefaultTextConfiguration();
    await credentials.delete(configuration.id);

    const result = await service().generate(input());

    expect(result).toMatchObject({
      status: "failed",
      errorSummary: {
        reason: "missing_credential",
      },
    });
    expect(generateProposalJson).not.toHaveBeenCalled();
    await expect(personalRepository.list()).resolves.toEqual([]);
  });

  it("离线时阻止模型调用并保存失败草稿", async () => {
    await createReadyDefaultTextConfiguration();

    const result = await service({ isOnline: () => false }).generate(input());

    expect(result).toMatchObject({
      status: "failed",
      errorSummary: {
        reason: "offline",
      },
    });
    expect(generateProposalJson).not.toHaveBeenCalled();
  });

  it("模型调用失败时保存非敏感失败摘要且不写入个人图鉴", async () => {
    await createReadyDefaultTextConfiguration();
    generateProposalJson.mockRejectedValueOnce(
      new TemplateRefinementTextModelClientError(
        "rate_limited",
        "secret provider message",
        429,
        "rate_limit_exceeded",
      ),
    );

    const result = await service().generate(input());

    expect(result).toMatchObject({
      status: "failed",
      errorSummary: {
        reason: "rate_limited",
        statusCode: 429,
        providerCode: "rate_limit_exceeded",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret provider message");
    await expect(personalRepository.list()).resolves.toEqual([]);
  });

  it("成功生成结构化方案后进入 ready_for_review 且暂不写入个人图鉴", async () => {
    await createReadyDefaultTextConfiguration();

    const result = await service().generate({
      externalPrompt: "  外部完整提示词  ",
      plannedUse: "  计划用途  ",
    });

    expect(result).toMatchObject({
      status: "ready_for_review",
      draft: {
        status: "ready_for_review",
        externalPrompt: "外部完整提示词",
        plannedUse: "计划用途",
        proposal: {
          template: {
            name: "refined-template",
          },
        },
      },
    });
    expect(generateProposalJson).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://api.openai.com/v1",
        modelName: "gpt-5-mini",
        externalPrompt: "外部完整提示词",
        plannedUse: "计划用途",
      }),
    );
    await expect(personalRepository.list()).resolves.toEqual([]);
  });

  it("修改输入会使既有方案失效并回到 editing_input", async () => {
    await createReadyDefaultTextConfiguration();
    await service().generate(input());

    const draft = await service().updateInput({
      externalPrompt: "新的完整提示词",
      plannedUse: "新的计划用途",
    });

    expect(draft).toMatchObject({
      status: "editing_input",
      externalPrompt: "新的完整提示词",
      plannedUse: "新的计划用途",
      proposal: null,
      errorSummary: null,
    });
  });

  it("审阅状态只允许本地修改名称和描述", async () => {
    await createReadyDefaultTextConfiguration();
    await service().generate(input());

    const result = await service().updateReviewTemplateMetadata({
      name: "renamed-template",
      description: "修改后的描述",
    });

    expect(result).toMatchObject({
      status: "updated",
      draft: {
        status: "ready_for_review",
        proposal: {
          template: {
            name: "renamed-template",
            description: "修改后的描述",
            body: "# 模板正文\n\n生成一张清晰图片。",
          },
        },
      },
    });
  });

  it("确认写入成功后清除草稿并新增个人图鉴条目", async () => {
    await createReadyDefaultTextConfiguration();
    await service().generate(input());

    const result = await service().confirmWrite();

    expect(result).toMatchObject({
      status: "succeeded",
      entry: {
        sourceType: "personal",
        name: "refined-template",
      },
    });
    await expect(draftRepository.get()).resolves.toBeNull();
    await expect(personalRepository.get("refined-template")).resolves.toMatchObject({
      sourceType: "personal",
      body: "# 模板正文\n\n生成一张清晰图片。",
    });
  });

  it("写入前名称冲突时保留方案并要求本地改名", async () => {
    await createReadyDefaultTextConfiguration();
    await service({
      builtInSources: [
        {
          fileName: "refined-template.md",
          source: `---
name: refined-template
description: 内置同名模板
inputs:
  subject:
    required: true
    description: 主体
---

# 内置正文`,
        },
      ],
    }).generate(input());

    const result = await service({
      builtInSources: [
        {
          fileName: "refined-template.md",
          source: `---
name: refined-template
description: 内置同名模板
inputs:
  subject:
    required: true
    description: 主体
---

# 内置正文`,
        },
      ],
    }).confirmWrite();

    expect(result).toMatchObject({
      status: "duplicate_name",
      draft: {
        status: "ready_for_review",
        proposal: {
          template: {
            name: "refined-template",
          },
        },
      },
    });
    await expect(draftRepository.get()).resolves.toMatchObject({
      status: "ready_for_review",
    });
    await expect(personalRepository.list()).resolves.toEqual([]);
  });

  it("本地改成无效名称时阻止写入但保留方案", async () => {
    await createReadyDefaultTextConfiguration();
    await service().generate(input());
    await service().updateReviewTemplateMetadata({
      name: "Invalid Name",
      description: "修改后的描述",
    });

    const result = await service().confirmWrite();

    expect(result).toMatchObject({
      status: "promptdex_contract_invalid",
      draft: {
        status: "ready_for_review",
      },
    });
    await expect(draftRepository.get()).resolves.toMatchObject({
      status: "ready_for_review",
      proposal: {
        template: {
          name: "Invalid Name",
        },
      },
    });
    await expect(personalRepository.list()).resolves.toEqual([]);
  });

  it("主动丢弃会清除提炼草稿", async () => {
    await createReadyDefaultTextConfiguration();
    await service().generate(input());

    await service().discardDraft();

    await expect(draftRepository.get()).resolves.toBeNull();
  });
});

function input() {
  return {
    externalPrompt: "外部完整提示词",
    plannedUse: "计划用途",
  };
}

function validProposal() {
  return {
    template: {
      name: "refined-template",
      description: "提炼后的模板",
      inputs: {
        subject: {
          required: true,
          description: "画面主体",
        },
      },
      body: "# 模板正文\n\n生成一张清晰图片。",
    },
    taskTypeRationale: "未声明 image 输入，因此是生成任务。",
    retainedRules: ["保留构图规则"],
    removedRules: [
      {
        summary: "移除一次性主体",
        reason: "主体由输入提供。",
      },
    ],
    additions: [],
  };
}
