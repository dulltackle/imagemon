import type {
  ModelConfiguration,
  ModelConfigurationRepository,
} from "../model-configurations";
import { createUtcTimestamp } from "../storage";
import type {
  MergedPromptdexCatalogService,
} from "./index";
import {
  PersonalPromptdexEntryRepositoryError,
  type PersonalPromptdexEntry,
  type PersonalPromptdexEntryRepository,
} from "./personal-entry-repository";
import type {
  TemplateRefinementDraft,
  TemplateRefinementDraftRepository,
  TemplateRefinementErrorSummary,
  TemplateRefinementFailureReason,
  TemplateRefinementInputDraft,
  TemplateRefinementProposal,
} from "./template-refinement-draft-repository";
import {
  TemplateRefinementProposalParseError,
  buildPromptdexTemplateFromRefinementProposal,
  parseTemplateRefinementProposal,
} from "./template-refinement-parser";
import {
  TemplateRefinementTextModelClientError,
  createFetchTemplateRefinementTextModelClient,
  type TemplateRefinementTextModelClient,
} from "./template-refinement-text-model-client";

export const TEMPLATE_REFINEMENT_EXTERNAL_PROMPT_MAX_LENGTH = 20_000;
export const TEMPLATE_REFINEMENT_PLANNED_USE_MAX_LENGTH = 1_000;

export interface TemplateRefinementService {
  generate(input: TemplateRefinementInputDraft): Promise<GenerateTemplateRefinementResult>;
  updateInput(input: TemplateRefinementInputDraft): Promise<TemplateRefinementDraft>;
  updateReviewTemplateMetadata(
    input: UpdateReviewTemplateMetadataInput,
  ): Promise<UpdateReviewTemplateMetadataResult>;
  confirmWrite(): Promise<ConfirmTemplateRefinementWriteResult>;
  discardDraft(): Promise<void>;
}

export interface UpdateReviewTemplateMetadataInput {
  name: string;
  description: string;
}

export type GenerateTemplateRefinementResult =
  | {
      status: "invalid_input";
      issues: TemplateRefinementInputValidationIssue[];
    }
  | {
      status: "failed";
      draft: TemplateRefinementDraft;
      errorSummary: TemplateRefinementErrorSummary;
    }
  | {
      status: "ready_for_review";
      draft: TemplateRefinementDraft;
      proposal: TemplateRefinementProposal;
    };

export type UpdateReviewTemplateMetadataResult =
  | {
      status: "updated";
      draft: TemplateRefinementDraft;
    }
  | {
      status: "not_ready";
    };

export type ConfirmTemplateRefinementWriteResult =
  | {
      status: "succeeded";
      entry: PersonalPromptdexEntry;
    }
  | {
      status: "not_ready";
    }
  | {
      status: "duplicate_name";
      draft: TemplateRefinementDraft;
    }
  | {
      status: "promptdex_contract_invalid";
      draft: TemplateRefinementDraft;
      message: string;
    };

export interface TemplateRefinementInputValidationIssue {
  field: "externalPrompt" | "plannedUse";
  code: "required" | "too_long";
  message: string;
}

export interface CreateTemplateRefinementServiceOptions {
  draftRepository: TemplateRefinementDraftRepository;
  modelConfigurationRepository: ModelConfigurationRepository;
  personalPromptdexEntryRepository: PersonalPromptdexEntryRepository;
  promptdexCatalogService: MergedPromptdexCatalogService;
  textModelClient?: TemplateRefinementTextModelClient;
  isOnline?: () => boolean | Promise<boolean>;
  now?: () => string;
}

export function createTemplateRefinementService({
  draftRepository,
  modelConfigurationRepository,
  personalPromptdexEntryRepository,
  promptdexCatalogService,
  textModelClient = createFetchTemplateRefinementTextModelClient(),
  isOnline = () => true,
  now = createUtcTimestamp,
}: CreateTemplateRefinementServiceOptions): TemplateRefinementService {
  async function failCurrentDraft(
    reason: TemplateRefinementFailureReason,
    options: {
      statusCode?: number;
      providerCode?: string;
    } = {},
  ): Promise<GenerateTemplateRefinementResult> {
    const errorSummary = createTemplateRefinementErrorSummary(reason, now(), options);
    const draft = await draftRepository.saveFailure(errorSummary);
    return {
      status: "failed",
      draft,
      errorSummary,
    };
  }

  return {
    async generate(input) {
      const validation = validateTemplateRefinementInput(input);
      if (validation.length > 0) {
        return {
          status: "invalid_input",
          issues: validation,
        };
      }

      const normalizedInput = normalizeTemplateRefinementInput(input);
      await draftRepository.startGenerating(normalizedInput);

      if (!(await isOnline())) {
        return failCurrentDraft("offline");
      }

      let configuration: ModelConfiguration | null;
      let apiKey: string | undefined;
      try {
        configuration = await getReadyDefaultTextConfiguration(
          modelConfigurationRepository,
        );
        if (!configuration) {
          return failCurrentDraft("missing_text_model_configuration");
        }

        apiKey = (await modelConfigurationRepository.getCredential(
          configuration.id,
        ))?.trim();
      } catch (error) {
        console.warn(
          "[template-refinement] 读取模型配置或凭据失败",
          error,
        );
        return failCurrentDraft("unknown");
      }
      if (!apiKey) {
        return failCurrentDraft("missing_credential");
      }

      let rawProposal: unknown;
      try {
        rawProposal = await textModelClient.generateProposalJson({
          baseUrl: configuration.baseUrl,
          apiKey,
          modelName: configuration.modelName,
          externalPrompt: normalizedInput.externalPrompt,
          plannedUse: normalizedInput.plannedUse,
        });
      } catch (error) {
        if (error instanceof TemplateRefinementTextModelClientError) {
          return failCurrentDraft(error.reason, {
            statusCode: error.statusCode,
            providerCode: error.providerCode,
          });
        }
        console.warn("[template-refinement] 文本模型调用出现未预期错误", error);
        return failCurrentDraft("unknown");
      }

      let proposal: TemplateRefinementProposal;
      try {
        proposal = parseTemplateRefinementProposal(rawProposal);
      } catch (error) {
        if (error instanceof TemplateRefinementProposalParseError) {
          return failCurrentDraft(error.reason);
        }
        console.warn("[template-refinement] 解析提炼方案出现未预期错误", error);
        return failCurrentDraft("unknown");
      }

      const draft = await draftRepository.saveProposal(proposal);
      return {
        status: "ready_for_review",
        draft,
        proposal,
      };
    },

    async updateInput(input) {
      return draftRepository.saveEditingInput(input);
    },

    async updateReviewTemplateMetadata(input) {
      const draft = await draftRepository.get();
      if (
        !draft ||
        draft.status !== "ready_for_review" ||
        draft.proposal === null
      ) {
        return { status: "not_ready" };
      }

      const name = input.name.trim();
      const description = input.description.trim();
      if (name.length === 0 || description.length === 0) {
        return { status: "not_ready" };
      }

      const nextDraft = await draftRepository.saveProposal({
        ...draft.proposal,
        template: {
          ...draft.proposal.template,
          name,
          description,
        },
      });
      return {
        status: "updated",
        draft: nextDraft,
      };
    },

    async confirmWrite() {
      const draft = await draftRepository.get();
      if (
        !draft ||
        draft.status !== "ready_for_review" ||
        draft.proposal === null
      ) {
        return { status: "not_ready" };
      }

      let template;
      try {
        template = buildPromptdexTemplateFromRefinementProposal(draft.proposal);
      } catch (error) {
        return {
          status: "promptdex_contract_invalid",
          draft,
          message:
            error instanceof Error
              ? error.message
              : "提炼方案不符合 Promptdex 图鉴条目契约。",
        };
      }

      const existing = await promptdexCatalogService.get(template.name);
      if (existing) {
        return {
          status: "duplicate_name",
          draft,
        };
      }

      try {
        const entry = await personalPromptdexEntryRepository.saveFromTemplate(
          template,
        );
        await draftRepository.clear();
        return {
          status: "succeeded",
          entry,
        };
      } catch (error) {
        if (
          error instanceof PersonalPromptdexEntryRepositoryError &&
          error.code === "duplicate_name"
        ) {
          return {
            status: "duplicate_name",
            draft,
          };
        }
        throw error;
      }
    },

    async discardDraft() {
      await draftRepository.clear();
    },
  };
}

export function validateTemplateRefinementInput(
  input: TemplateRefinementInputDraft,
): TemplateRefinementInputValidationIssue[] {
  const issues: TemplateRefinementInputValidationIssue[] = [];
  const externalPrompt = input.externalPrompt.trim();
  const plannedUse = input.plannedUse.trim();

  if (externalPrompt.length === 0) {
    issues.push({
      field: "externalPrompt",
      code: "required",
      message: "外部完整提示词不能为空。",
    });
  } else if (externalPrompt.length > TEMPLATE_REFINEMENT_EXTERNAL_PROMPT_MAX_LENGTH) {
    issues.push({
      field: "externalPrompt",
      code: "too_long",
      message: `外部完整提示词不能超过 ${TEMPLATE_REFINEMENT_EXTERNAL_PROMPT_MAX_LENGTH} 个字符。`,
    });
  }

  if (plannedUse.length === 0) {
    issues.push({
      field: "plannedUse",
      code: "required",
      message: "计划用途不能为空。",
    });
  } else if (plannedUse.length > TEMPLATE_REFINEMENT_PLANNED_USE_MAX_LENGTH) {
    issues.push({
      field: "plannedUse",
      code: "too_long",
      message: `计划用途不能超过 ${TEMPLATE_REFINEMENT_PLANNED_USE_MAX_LENGTH} 个字符。`,
    });
  }

  return issues;
}

export function createTemplateRefinementErrorSummary(
  reason: TemplateRefinementFailureReason,
  occurredAt: string,
  options: {
    statusCode?: number;
    providerCode?: string;
  } = {},
): TemplateRefinementErrorSummary {
  return {
    reason,
    occurredAt,
    ...(isValidStatusCode(options.statusCode)
      ? { statusCode: options.statusCode }
      : {}),
    ...(isValidProviderCode(options.providerCode)
      ? { providerCode: options.providerCode }
      : {}),
  };
}

function normalizeTemplateRefinementInput(
  input: TemplateRefinementInputDraft,
): TemplateRefinementInputDraft {
  return {
    externalPrompt: input.externalPrompt.trim(),
    plannedUse: input.plannedUse.trim(),
  };
}

async function getReadyDefaultTextConfiguration(
  repository: ModelConfigurationRepository,
): Promise<ModelConfiguration | null> {
  const settings = await repository.getSettings();
  const id = settings.defaultTextModelConfigurationId;
  if (!id) {
    return null;
  }
  const configuration = await repository.get(id);
  if (
    !configuration ||
    configuration.type !== "text" ||
    !configuration.isReady ||
    !configuration.hasCredential
  ) {
    return null;
  }
  return configuration;
}

function isValidStatusCode(value: number | undefined): value is number {
  return (
    value !== undefined &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

function isValidProviderCode(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}
