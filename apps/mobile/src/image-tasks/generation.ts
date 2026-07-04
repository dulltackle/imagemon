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
} from "./types";
import type { ImageTaskRepository } from "./repository";

const DEFAULT_IMAGE_SPEC = { quality: "auto", format: "png", n: 1 } as const;

export interface ImageGenerationTaskService {
  run(input: RunImageGenerationTaskInput): Promise<RunImageGenerationTaskResult>;
}

export interface RunImageGenerationTaskInput {
  prompt: string;
  size: ImageTaskSize;
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
  imageModelClient?: ImageModelClient;
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
        return {
          status: "failed",
          history: null,
          failure: createImageTaskFailureSummary("invalid_input", now()),
        };
      }

      const configuration = await getReadyDefaultImageConfiguration(
        modelConfigurationRepository,
      );
      if (!configuration) {
        return {
          status: "failed",
          history: null,
          failure: createImageTaskFailureSummary(
            "missing_default_model_configuration",
            now(),
          ),
        };
      }

      const snapshot = createSnapshot(configuration, prompt, input.size);
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
          size: input.size,
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
    },
  };
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

function createSnapshot(
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
