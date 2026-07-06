import {
  renderPromptdexTemplate,
  type PromptdexTemplate,
} from "@imagemon/core";

import type {
  ModelConfiguration,
  ModelConfigurationRepository,
} from "../model-configurations";
import {
  type IdGenerator,
  createRandomId,
  createUtcTimestamp,
} from "../storage";
import {
  createImageTaskFailureSummary,
  summarizeImageTaskError,
} from "./errors";
import type { ImageResultFileStorage } from "./file-storage";
import {
  createFetchImageModelClient,
  type ImageModelClient,
} from "./model-client";
import type {
  ImageResult,
  ImageTaskFailureSummary,
  ImageTaskHistory,
  ImageTaskSize,
  ImageTaskSnapshot,
  PromptdexEntrySourceType,
  PromptdexImageTaskSnapshot,
} from "./types";
import type { ImageTaskRepository } from "./repository";

const DEFAULT_IMAGE_SPEC = { quality: "auto", format: "png", n: 1 } as const;

type ImageGenerationModelClient = Pick<ImageModelClient, "generate">;

export interface ImageGenerationTaskService {
  run(input: RunImageGenerationTaskInput): Promise<RunImageGenerationTaskResult>;
}

export interface RunImageGenerationTaskInput {
  prompt: string;
  size: ImageTaskSize;
}

export interface PromptdexImageGenerationTaskService {
  run(
    input: RunPromptdexImageGenerationTaskInput,
  ): Promise<RunImageGenerationTaskResult>;
}

export interface RunPromptdexImageGenerationTaskInput {
  template: PromptdexTemplate;
  taskInputs: Record<string, string>;
  size: ImageTaskSize;
  sourceType?: PromptdexEntrySourceType;
}

export type RunImageGenerationTaskResult =
  | {
      status: "succeeded";
      history: ImageTaskHistory;
      imageResult: ImageResult;
    }
  | {
      status: "failed";
      history: ImageTaskHistory | null;
      failure: ImageTaskFailureSummary;
    };

export interface CreateImageGenerationTaskServiceOptions {
  imageTaskRepository: ImageTaskRepository;
  modelConfigurationRepository: ModelConfigurationRepository;
  fileStorage: ImageResultFileStorage;
  imageModelClient?: ImageGenerationModelClient;
  now?: () => string;
  generateId?: IdGenerator;
}

export function createImageGenerationTaskService({
  imageTaskRepository,
  modelConfigurationRepository,
  fileStorage,
  imageModelClient = createFetchImageModelClient(),
  now = createUtcTimestamp,
  generateId = createRandomId,
}: CreateImageGenerationTaskServiceOptions): ImageGenerationTaskService {
  return {
    async run(input) {
      const prompt = input.prompt.trim();
      if (prompt.length === 0) {
        return createFailedWithoutHistory("invalid_input", now);
      }

      const configuration = await getReadyDefaultImageConfiguration(
        modelConfigurationRepository,
      );
      if (!configuration) {
        return createFailedWithoutHistory(
          "missing_default_model_configuration",
          now,
        );
      }

      return runPreparedImageGenerationTask({
        configuration,
        fileStorage,
        generateId,
        imageModelClient,
        imageTaskRepository,
        modelConfigurationRepository,
        now,
        prompt,
        size: input.size,
        snapshot: createManualSnapshot(configuration, prompt, input.size),
      });
    },
  };
}

export function createPromptdexImageGenerationTaskService({
  imageTaskRepository,
  modelConfigurationRepository,
  fileStorage,
  imageModelClient = createFetchImageModelClient(),
  now = createUtcTimestamp,
  generateId = createRandomId,
}: CreateImageGenerationTaskServiceOptions): PromptdexImageGenerationTaskService {
  return {
    async run(input) {
      if (input.template.taskType !== "generate") {
        return createFailedWithoutHistory("invalid_input", now);
      }

      const taskInputs = normalizePromptdexTaskInputs(
        input.template,
        input.taskInputs,
      );
      if (taskInputs.status === "failed") {
        return createFailedWithoutHistory("invalid_input", now);
      }

      let fullPrompt: string;
      try {
        const rendered = renderPromptdexTemplate(
          input.template,
          taskInputs.inputs,
        );
        if (rendered.taskType !== "generate") {
          return createFailedWithoutHistory("invalid_input", now);
        }
        fullPrompt = rendered.prompt;
      } catch {
        return createFailedWithoutHistory("invalid_input", now);
      }

      const configuration = await getReadyDefaultImageConfiguration(
        modelConfigurationRepository,
      );
      if (!configuration) {
        return createFailedWithoutHistory(
          "missing_default_model_configuration",
          now,
        );
      }

      return runPreparedImageGenerationTask({
        configuration,
        fileStorage,
        generateId,
        imageModelClient,
        imageTaskRepository,
        modelConfigurationRepository,
        now,
        prompt: fullPrompt,
        size: input.size,
        snapshot: createPromptdexSnapshot({
          configuration,
          fullPrompt,
          size: input.size,
          sourceType: input.sourceType ?? "built-in",
          taskInputs: taskInputs.inputs,
          template: input.template,
        }),
      });
    },
  };
}

interface RunPreparedImageGenerationTaskOptions {
  configuration: ModelConfiguration;
  fileStorage: ImageResultFileStorage;
  generateId: IdGenerator;
  imageModelClient: ImageGenerationModelClient;
  imageTaskRepository: ImageTaskRepository;
  modelConfigurationRepository: ModelConfigurationRepository;
  now: () => string;
  prompt: string;
  size: ImageTaskSize;
  snapshot: ImageTaskSnapshot;
}

async function runPreparedImageGenerationTask({
  configuration,
  fileStorage,
  generateId,
  imageModelClient,
  imageTaskRepository,
  modelConfigurationRepository,
  now,
  prompt,
  size,
  snapshot,
}: RunPreparedImageGenerationTaskOptions): Promise<RunImageGenerationTaskResult> {
  const runningHistory =
    await imageTaskRepository.createRunningHistory(snapshot);

  const apiKey = (await modelConfigurationRepository.getCredential(
    configuration.id,
  ))?.trim();
  if (!apiKey) {
    const failure = createImageTaskFailureSummary("missing_credential", now());
    const failedHistory = await imageTaskRepository.markFailed(
      runningHistory.id,
      failure,
      failure.occurredAt,
    );
    await clearMissingCredentialReadiness(
      modelConfigurationRepository,
      configuration,
    );
    return {
      status: "failed",
      history: failedHistory,
      failure,
    };
  }

  try {
    const generated = await imageModelClient.generate({
      baseUrl: configuration.baseUrl,
      apiKey,
      modelName: configuration.modelName,
      prompt,
      size,
      ...DEFAULT_IMAGE_SPEC,
    });
    const imageResultId = generateId();
    const savedFile = await fileStorage.saveImageResultFile({
      imageResultId,
      format: "png",
      ...(generated.base64 !== undefined
        ? { base64: generated.base64 }
        : { bytes: generated.bytes }),
    });
    const imageResult = await imageTaskRepository.insertImageResult({
      id: imageResultId,
      taskHistoryId: runningHistory.id,
      filePath: savedFile.filePath,
      format: "png",
      width: generated.width,
      height: generated.height,
      createdAt: now(),
    });
    const completedHistory = await imageTaskRepository.markCompleted(
      runningHistory.id,
      now(),
    );

    return {
      status: "succeeded",
      history: completedHistory,
      imageResult,
    };
  } catch (error) {
    const failure = summarizeImageTaskError(error, now());
    try {
      const failedHistory = await imageTaskRepository.markFailed(
        runningHistory.id,
        failure,
        failure.occurredAt,
      );
      return {
        status: "failed",
        history: failedHistory,
        failure,
      };
    } catch {
      // 原始生成错误优先：即使写入失败历史本身也出错，也不能让它掩盖 failure。
      return {
        status: "failed",
        history: null,
        failure,
      };
    }
  }
}

async function getReadyDefaultImageConfiguration(
  repository: ModelConfigurationRepository,
): Promise<ModelConfiguration | null> {
  const settings = await repository.getSettings();
  const defaultId = settings.defaultImageModelConfigurationId;
  if (!defaultId) {
    return null;
  }

  const configuration = await repository.get(defaultId);
  if (!configuration || configuration.type !== "image" || !configuration.isReady) {
    return null;
  }
  return configuration;
}

function createManualSnapshot(
  configuration: ModelConfiguration,
  prompt: string,
  size: ImageTaskSize,
): ImageTaskSnapshot {
  return {
    source: "manual",
    prompt,
    imageSpec: {
      size,
      ...DEFAULT_IMAGE_SPEC,
    },
    modelConfiguration: {
      type: "image",
      baseUrl: configuration.baseUrl,
      modelName: configuration.modelName,
    },
  };
}

function createPromptdexSnapshot({
  configuration,
  fullPrompt,
  size,
  sourceType,
  taskInputs,
  template,
}: {
  configuration: ModelConfiguration;
  fullPrompt: string;
  size: ImageTaskSize;
  sourceType: PromptdexEntrySourceType;
  taskInputs: Record<string, string>;
  template: PromptdexTemplate;
}): PromptdexImageTaskSnapshot {
  return {
    source: "promptdex",
    promptdexEntry: {
      name: template.name,
      description: template.description,
      ...(template.version !== undefined ? { version: template.version } : {}),
      sourceType,
      taskType: template.taskType,
      inputs: Object.fromEntries(
        Object.entries(template.inputs).map(([name, input]) => [
          name,
          {
            required: input.required,
            description: input.description,
          },
        ]),
      ),
      body: template.body,
    },
    taskInputs,
    imageSpec: {
      size,
      ...DEFAULT_IMAGE_SPEC,
    },
    modelConfiguration: {
      type: "image",
      baseUrl: configuration.baseUrl,
      modelName: configuration.modelName,
    },
    fullPrompt,
  };
}

function normalizePromptdexTaskInputs(
  template: PromptdexTemplate,
  values: Record<string, string>,
):
  | { status: "ready"; inputs: Record<string, string> }
  | { status: "failed" } {
  const inputs: Record<string, string> = {};
  for (const [name, definition] of Object.entries(template.inputs)) {
    if (name === "image" || name === "mask") {
      continue;
    }

    const value = values[name]?.trim() ?? "";
    if (definition.required && value.length === 0) {
      return { status: "failed" };
    }
    if (value.length > 0) {
      inputs[name] = value;
    }
  }
  return { status: "ready", inputs };
}

function createFailedWithoutHistory(
  reason: ImageTaskFailureSummary["reason"],
  now: () => string,
): Extract<RunImageGenerationTaskResult, { status: "failed" }> {
  return {
    status: "failed",
    history: null,
    failure: createImageTaskFailureSummary(reason, now()),
  };
}

async function clearMissingCredentialReadiness(
  repository: ModelConfigurationRepository,
  configuration: ModelConfiguration,
): Promise<void> {
  await repository.save({
    id: configuration.id,
    type: configuration.type,
    baseUrl: configuration.baseUrl,
    modelName: configuration.modelName,
    clearCredential: true,
  });
}
