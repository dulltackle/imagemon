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
  ImageTaskExecutionError,
  createImageTaskFailureSummary,
  failureMessage,
  summarizeImageTaskError,
} from "./errors";
import type {
  ImageResultFileStorage,
  ImageTaskInternalAttachmentStorage,
} from "./file-storage";
import {
  createFetchImageModelClient,
  type GeneratedImageModelResponse,
  type GeneratedImageModelResult,
  type ImageModelClient,
} from "./model-client";
import type {
  ImageResult,
  ImageResultFormat,
  ImageTaskFailureSummary,
  ImageTaskHistory,
  ImageTaskImageCount,
  ImageTaskImageSpecSnapshot,
  ImageTaskInternalAttachmentSnapshot,
  ImageTaskQuality,
  ImageTaskSize,
  ImageTaskSnapshot,
  PromptdexEntrySourceType,
  PromptdexImageTaskSnapshot,
} from "./types";
import type { PickedEditInputImage } from "./picked-image";
import type {
  CompleteImageResultInput,
  ImageTaskRepository,
} from "./repository";

const DEFAULT_IMAGE_SPEC = { quality: "auto", format: "png", n: 1 } as const;

type ImageGenerationModelClient = Pick<ImageModelClient, "generate">;
type ImageEditModelClient = Required<Pick<ImageModelClient, "edit">>;

export interface ImageGenerationTaskService {
  run(input: RunImageGenerationTaskInput): Promise<RunImageGenerationTaskResult>;
}

export interface RunImageTaskSpecInput {
  size: ImageTaskSize;
  quality?: ImageTaskQuality;
  format?: ImageResultFormat;
  n?: ImageTaskImageCount;
}

export interface RunImageGenerationTaskInput extends RunImageTaskSpecInput {
  prompt: string;
}

export interface PromptdexImageGenerationTaskService {
  run(
    input: RunPromptdexImageGenerationTaskInput,
  ): Promise<RunImageGenerationTaskResult>;
}

export interface PromptdexImageEditTaskService {
  run(input: RunPromptdexImageEditTaskInput): Promise<RunImageGenerationTaskResult>;
}

export interface RunPromptdexImageGenerationTaskInput
  extends RunImageTaskSpecInput {
  template: PromptdexTemplate;
  taskInputs: Record<string, string>;
  sourceType?: PromptdexEntrySourceType;
}

export interface RunPromptdexImageEditTaskInput extends RunImageTaskSpecInput {
  template: PromptdexTemplate;
  taskInputs: Record<string, string>;
  image: PickedEditInputImage;
  sourceType?: PromptdexEntrySourceType;
}

export type RunImageGenerationTaskResult =
  | {
      status: "succeeded";
      history: ImageTaskHistory;
      imageResult: ImageResult;
      imageResults: ImageResult[];
    }
  | {
      status: "failed";
      history: ImageTaskHistory | null;
      failure: ImageTaskFailureSummary;
    };

export type ImageTaskHistoryCreatedCallback = (
  history: ImageTaskHistory,
) => void | Promise<void>;

export interface CreateImageGenerationTaskServiceOptions {
  imageTaskRepository: ImageTaskRepository;
  modelConfigurationRepository: ModelConfigurationRepository;
  fileStorage: ImageResultFileStorage;
  imageModelClient?: ImageGenerationModelClient;
  onHistoryCreated?: ImageTaskHistoryCreatedCallback;
  now?: () => string;
  generateId?: IdGenerator;
}

export interface CreatePromptdexImageEditTaskServiceOptions {
  imageTaskRepository: ImageTaskRepository;
  modelConfigurationRepository: ModelConfigurationRepository;
  fileStorage: ImageResultFileStorage;
  attachmentStorage: ImageTaskInternalAttachmentStorage;
  imageModelClient?: ImageEditModelClient;
  onHistoryCreated?: ImageTaskHistoryCreatedCallback;
  now?: () => string;
  generateId?: IdGenerator;
}

export function createImageGenerationTaskService({
  imageTaskRepository,
  modelConfigurationRepository,
  fileStorage,
  imageModelClient = createFetchImageModelClient(),
  onHistoryCreated,
  now = createUtcTimestamp,
  generateId = createRandomId,
}: CreateImageGenerationTaskServiceOptions): ImageGenerationTaskService {
  return {
    async run(input) {
      const prompt = input.prompt.trim();
      if (prompt.length === 0) {
        return createFailedWithoutHistory("invalid_input", now);
      }
      const imageSpec = resolveImageTaskSpec(input);

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
        onHistoryCreated,
        now,
        prompt,
        imageSpec,
        snapshot: createManualSnapshot(configuration, prompt, imageSpec),
      });
    },
  };
}

export function createPromptdexImageGenerationTaskService({
  imageTaskRepository,
  modelConfigurationRepository,
  fileStorage,
  imageModelClient = createFetchImageModelClient(),
  onHistoryCreated,
  now = createUtcTimestamp,
  generateId = createRandomId,
}: CreateImageGenerationTaskServiceOptions): PromptdexImageGenerationTaskService {
  return {
    async run(input) {
      if (input.template.taskType !== "generate") {
        return createFailedWithoutHistory("invalid_input", now);
      }
      const imageSpec = resolveImageTaskSpec(input);

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
        onHistoryCreated,
        now,
        prompt: fullPrompt,
        imageSpec,
        snapshot: createPromptdexSnapshot({
          configuration,
          fullPrompt,
          imageSpec,
          sourceType: input.sourceType ?? "built-in",
          taskInputs: taskInputs.inputs,
          template: input.template,
        }),
      });
    },
  };
}

export function createPromptdexImageEditTaskService({
  imageTaskRepository,
  modelConfigurationRepository,
  fileStorage,
  attachmentStorage,
  imageModelClient = createFetchImageModelClient(),
  onHistoryCreated,
  now = createUtcTimestamp,
  generateId = createRandomId,
}: CreatePromptdexImageEditTaskServiceOptions): PromptdexImageEditTaskService {
  return {
    async run(input) {
      if (
        input.template.taskType !== "edit" ||
        !Object.hasOwn(input.template.inputs, "image") ||
        Object.hasOwn(input.template.inputs, "mask")
      ) {
        return createFailedWithoutHistory("invalid_input", now);
      }
      const imageSpec = resolveImageTaskSpec(input);

      const taskInputs = normalizePromptdexTaskInputs(
        input.template,
        input.taskInputs,
      );
      if (taskInputs.status === "failed") {
        return createFailedWithoutHistory("invalid_input", now);
      }

      let fullPrompt: string;
      try {
        const rendered = renderPromptdexTemplate(input.template, {
          ...taskInputs.inputs,
          image: input.image.uri,
        });
        if (rendered.taskType !== "edit" || !rendered.image) {
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

      const historyId = generateId();
      let imageAttachment: ImageTaskInternalAttachmentSnapshot;
      try {
        imageAttachment = await attachmentStorage.copyTaskInputAttachment({
          historyId,
          role: "image",
          sourceUri: input.image.uri,
          mimeType: input.image.mimeType,
          originalFileName: input.image.fileName,
          width: input.image.width,
          height: input.image.height,
          byteSize: input.image.byteSize,
        });
      } catch {
        // 复制输入附件失败通常源于存储 I/O（磁盘写满、权限不足、写入异常），
        // 属于基础设施故障而非用户输入问题，因此归类为 unknown_error，避免误导用户。
        return createFailedWithoutHistory("unknown_error", now);
      }

      const snapshot = createPromptdexSnapshot({
        configuration,
        fullPrompt,
        inputAttachments: {
          image: imageAttachment,
        },
        imageSpec,
        sourceType: input.sourceType ?? "built-in",
        taskInputs: taskInputs.inputs,
        template: input.template,
      });

      let runningHistory: ImageTaskHistory;
      try {
        runningHistory = await imageTaskRepository.createRunningHistory({
          id: historyId,
          snapshot,
          taskType: "edit",
        });
      } catch (error) {
        await attachmentStorage.deleteAttachment(imageAttachment.filePath).catch(
          () => undefined,
        );
        throw error;
      }

      await notifyHistoryCreated(runningHistory, onHistoryCreated);

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
        const uploadFile = await attachmentStorage.createUploadFile(
          imageAttachment.filePath,
          imageAttachment,
        );
        const generated = await imageModelClient.edit({
          baseUrl: configuration.baseUrl,
          apiKey,
          modelName: configuration.modelName,
          prompt: fullPrompt,
          image: uploadFile,
          ...imageSpec,
        });
        const completed = await saveGeneratedImageResults({
          fileStorage,
          generateId,
          generated,
          imageSpec,
          imageTaskRepository,
          now,
          runningHistory,
        });

        return {
          status: "succeeded",
          history: completed.history,
          imageResult: completed.imageResults[0]!,
          imageResults: completed.imageResults,
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
          return {
            status: "failed",
            history: null,
            failure,
          };
        }
      }
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
  onHistoryCreated?: ImageTaskHistoryCreatedCallback;
  now: () => string;
  prompt: string;
  imageSpec: ImageTaskImageSpecSnapshot;
  snapshot: ImageTaskSnapshot;
}

async function runPreparedImageGenerationTask({
  configuration,
  fileStorage,
  generateId,
  imageModelClient,
  imageTaskRepository,
  modelConfigurationRepository,
  onHistoryCreated,
  now,
  prompt,
  imageSpec,
  snapshot,
}: RunPreparedImageGenerationTaskOptions): Promise<RunImageGenerationTaskResult> {
  const runningHistory =
    await imageTaskRepository.createRunningHistory(snapshot);

  await notifyHistoryCreated(runningHistory, onHistoryCreated);

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
      ...imageSpec,
    });
    const completed = await saveGeneratedImageResults({
      fileStorage,
      generateId,
      generated,
      imageSpec,
      imageTaskRepository,
      now,
      runningHistory,
    });

    return {
      status: "succeeded",
      history: completed.history,
      imageResult: completed.imageResults[0]!,
      imageResults: completed.imageResults,
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

interface SaveGeneratedImageResultsOptions {
  fileStorage: ImageResultFileStorage;
  generateId: IdGenerator;
  generated: GeneratedImageModelResponse;
  imageSpec: ImageTaskImageSpecSnapshot;
  imageTaskRepository: ImageTaskRepository;
  now: () => string;
  runningHistory: ImageTaskHistory;
}

async function saveGeneratedImageResults({
  fileStorage,
  generateId,
  generated,
  imageSpec,
  imageTaskRepository,
  now,
  runningHistory,
}: SaveGeneratedImageResultsOptions): Promise<{
  history: ImageTaskHistory;
  imageResults: ImageResult[];
}> {
  const generatedImages = normalizeGeneratedImages(generated);
  if (
    generatedImages.length === 0 ||
    generatedImages.length > imageSpec.n
  ) {
    throw new ImageTaskExecutionError(
      "invalid_response",
      failureMessage("invalid_response"),
    );
  }

  const savedFilePaths: string[] = [];
  try {
    const imageResultInputs: CompleteImageResultInput[] = [];
    // 顺序写入以便精确记录已落盘文件，避免并发失败后的清理竞态。
    for (const image of generatedImages) {
      const imageResultId = generateId();
      const savedFile = await fileStorage.saveImageResultFile({
        imageResultId,
        format: imageSpec.format,
        ...(image.base64 !== undefined
          ? { base64: image.base64 }
          : { bytes: image.bytes }),
      });
      savedFilePaths.push(savedFile.filePath);
      imageResultInputs.push({
        id: imageResultId,
        filePath: savedFile.filePath,
        format: imageSpec.format,
        width: image.width,
        height: image.height,
        createdAt: now(),
      });
    }

    return await imageTaskRepository.completeWithImageResults(
      runningHistory.id,
      imageResultInputs,
      now(),
    );
  } catch (error) {
    await Promise.allSettled(
      savedFilePaths.map((filePath) => fileStorage.deleteFile(filePath)),
    );
    throw error;
  }
}

function normalizeGeneratedImages(
  generated: GeneratedImageModelResponse,
): GeneratedImageModelResult[] {
  return Array.isArray(generated) ? generated : [generated];
}

async function notifyHistoryCreated(
  history: ImageTaskHistory,
  onHistoryCreated?: ImageTaskHistoryCreatedCallback,
): Promise<void> {
  if (!onHistoryCreated) {
    return;
  }

  try {
    await onHistoryCreated(history);
  } catch (error) {
    console.warn("[image-tasks] running history 生命周期回调失败", error);
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
  imageSpec: ImageTaskImageSpecSnapshot,
): ImageTaskSnapshot {
  return {
    source: "manual",
    prompt,
    imageSpec: { ...imageSpec },
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
  imageSpec,
  sourceType,
  taskInputs,
  template,
  inputAttachments,
}: {
  configuration: ModelConfiguration;
  fullPrompt: string;
  imageSpec: ImageTaskImageSpecSnapshot;
  sourceType: PromptdexEntrySourceType;
  taskInputs: Record<string, string>;
  template: PromptdexTemplate;
  inputAttachments?: PromptdexImageTaskSnapshot["inputAttachments"];
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
    ...(inputAttachments !== undefined ? { inputAttachments } : {}),
    imageSpec: { ...imageSpec },
    modelConfiguration: {
      type: "image",
      baseUrl: configuration.baseUrl,
      modelName: configuration.modelName,
    },
    fullPrompt,
  };
}

function resolveImageTaskSpec(
  input: RunImageTaskSpecInput,
): ImageTaskImageSpecSnapshot {
  return {
    size: input.size,
    quality: input.quality ?? DEFAULT_IMAGE_SPEC.quality,
    format: input.format ?? DEFAULT_IMAGE_SPEC.format,
    n: input.n ?? DEFAULT_IMAGE_SPEC.n,
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
