import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";

import {
  createBusinessCallAttentionRepository,
  createMemoryBusinessCallAttentionStore,
  createSqliteBusinessCallAttentionStore,
  type BusinessCallAttentionRepository,
} from "../business-call-attentions";
import {
  createMemoryFeishuPersonalBaseTokenCredentialAdapter,
  createMemoryModelConfigurationCredentialAdapter,
  createSecureStoreFeishuPersonalBaseTokenCredentialAdapter,
  createSecureStoreModelConfigurationCredentialAdapter,
  initializeApplicationStorage,
} from "../storage";
import {
  createMemoryTableBackupStateStore,
  createSqliteTableBackupStateStore,
  createTableBackupConnectionRepository,
  type TableBackupConnectionRepository,
} from "../table-backup";
import {
  createExpoImageResultAlbumSaver,
  createExpoImageResultFileStorage,
  createExpoImageTaskInternalAttachmentStorage,
  createImageTaskDeletionService,
  createMemoryImageResultAlbumSaver,
  createImageTaskRepository,
  createMemoryImageTaskInternalAttachmentStorage,
  createMemoryImageResultFileStorage,
  createMemoryImageTaskStore,
  createSqliteImageTaskRepository,
  type ImageResultAlbumSaver,
  type ImageResultFileStorage,
  type ImageTaskInternalAttachmentStorage,
  type ImageTaskDeletionService,
  type ImageTaskRepository,
} from "../image-tasks";
import {
  createMemoryModelConfigurationStore,
  createModelConfigurationRepository,
  createSqliteModelConfigurationRepository,
  type AppSettings,
  type ModelConfigurationRepository,
} from "../model-configurations";
import {
  createFetchTemplateRefinementTextModelClient,
  createMemoryPersonalPromptdexEntryStore,
  createMemoryTemplateRefinementDraftStore,
  createMergedPromptdexCatalogService,
  createPersonalPromptdexEntryRepository,
  createSqliteTemplateRefinementDraftRepository,
  createSqlitePersonalPromptdexEntryRepository,
  createTemplateRefinementDraftRepository,
  createTemplateRefinementService,
  type MergedPromptdexCatalogService,
  type PersonalPromptdexEntryRepository,
  type TemplateRefinementDraftRepository,
  type TemplateRefinementService,
  type TemplateRefinementTextModelClient,
} from "../promptdex";

type AppRuntimeState =
  | {
      status: "loading";
    }
  | {
      status: "failed";
      error: Error;
    }
  | {
      status: "ready";
      businessCallAttentionRepository: BusinessCallAttentionRepository;
      repository: ModelConfigurationRepository;
      imageTaskDeletionService: ImageTaskDeletionService;
      imageTaskRepository: ImageTaskRepository;
      personalPromptdexEntryRepository: PersonalPromptdexEntryRepository;
      promptdexCatalogService: MergedPromptdexCatalogService;
      tableBackupConnectionRepository: TableBackupConnectionRepository;
      templateRefinementDraftRepository: TemplateRefinementDraftRepository;
      templateRefinementTextModelClient: TemplateRefinementTextModelClient;
      templateRefinementService: TemplateRefinementService;
      imageFileStorage: ImageResultFileStorage;
      imageResultAlbumSaver: ImageResultAlbumSaver;
      imageTaskAttachmentStorage: ImageTaskInternalAttachmentStorage;
      settings: AppSettings;
      refreshSettings(): Promise<AppSettings>;
      replaceSettings(settings: AppSettings): void;
    };

interface AppRuntimeProviderProps {
  children: ReactNode;
}

interface RuntimeResources {
  businessCallAttentionRepository: BusinessCallAttentionRepository;
  repository: ModelConfigurationRepository;
  imageTaskDeletionService: ImageTaskDeletionService;
  imageTaskRepository: ImageTaskRepository;
  personalPromptdexEntryRepository: PersonalPromptdexEntryRepository;
  promptdexCatalogService: MergedPromptdexCatalogService;
  tableBackupConnectionRepository: TableBackupConnectionRepository;
  templateRefinementDraftRepository: TemplateRefinementDraftRepository;
  templateRefinementTextModelClient: TemplateRefinementTextModelClient;
  templateRefinementService: TemplateRefinementService;
  imageFileStorage: ImageResultFileStorage;
  imageResultAlbumSaver: ImageResultAlbumSaver;
  imageTaskAttachmentStorage: ImageTaskInternalAttachmentStorage;
  settings: AppSettings;
}

const AppRuntimeContext = createContext<AppRuntimeState | null>(null);
const SCREENSHOT_RUNTIME_ENABLED =
  process.env.EXPO_PUBLIC_IMAGEMON_SCREENSHOT_MODE === "1";
const SCREENSHOT_TIMESTAMP = "2026-01-02T03:04:05.000Z";

export function AppRuntimeProvider({ children }: AppRuntimeProviderProps) {
  const [state, setState] = useState<AppRuntimeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const {
          businessCallAttentionRepository,
          imageFileStorage,
          imageTaskAttachmentStorage,
          imageTaskDeletionService,
          imageTaskRepository,
          personalPromptdexEntryRepository,
          promptdexCatalogService,
          tableBackupConnectionRepository,
          templateRefinementDraftRepository,
          templateRefinementTextModelClient,
          templateRefinementService,
          repository,
          settings,
          imageResultAlbumSaver,
        } = await initializeRuntimeResources();
        if (!cancelled) {
          setState({
            status: "ready",
            businessCallAttentionRepository,
            repository,
            imageTaskDeletionService,
            imageTaskRepository,
            personalPromptdexEntryRepository,
            promptdexCatalogService,
            tableBackupConnectionRepository,
            templateRefinementDraftRepository,
            templateRefinementTextModelClient,
            templateRefinementService,
            imageFileStorage,
            imageResultAlbumSaver,
            imageTaskAttachmentStorage,
            settings,
            async refreshSettings() {
              const nextSettings = await repository.getSettings();
              setState((current) =>
                current.status === "ready"
                  ? {
                      ...current,
                      settings: nextSettings,
                    }
                  : current,
              );
              return nextSettings;
            },
            replaceSettings(nextSettings) {
              setState((current) =>
                current.status === "ready"
                  ? {
                      ...current,
                      settings: nextSettings,
                    }
                  : current,
              );
            },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "failed",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  return <AppRuntimeContext.Provider value={state}>{children}</AppRuntimeContext.Provider>;
}

export function useAppRuntime(): AppRuntimeState {
  const value = useContext(AppRuntimeContext);
  if (!value) {
    throw new Error("useAppRuntime must be used within AppRuntimeProvider.");
  }
  return value;
}

export function useReadyAppRuntime(): Extract<AppRuntimeState, { status: "ready" }> {
  const runtime = useAppRuntime();
  if (runtime.status !== "ready") {
    throw new Error("App runtime is not ready.");
  }
  return runtime;
}

export function useModelConfigurationRepository(): ModelConfigurationRepository {
  return useReadyAppRuntime().repository;
}

export function usePersonalPromptdexEntryRepository(): PersonalPromptdexEntryRepository {
  return useReadyAppRuntime().personalPromptdexEntryRepository;
}

export function usePromptdexCatalogService(): MergedPromptdexCatalogService {
  return useReadyAppRuntime().promptdexCatalogService;
}

export function useTableBackupConnectionRepository(): TableBackupConnectionRepository {
  return useReadyAppRuntime().tableBackupConnectionRepository;
}

export function useTemplateRefinementDraftRepository(): TemplateRefinementDraftRepository {
  return useReadyAppRuntime().templateRefinementDraftRepository;
}

export function useTemplateRefinementService(): TemplateRefinementService {
  return useReadyAppRuntime().templateRefinementService;
}

export function useAppSettings(): AppSettings {
  return useReadyAppRuntime().settings;
}

export function useReplaceAppSettings(): (settings: AppSettings) => void {
  return useReadyAppRuntime().replaceSettings;
}

export function useRefreshAppSettings(): () => Promise<AppSettings> {
  const runtime = useReadyAppRuntime();
  return useCallback(() => runtime.refreshSettings(), [runtime]);
}

export function useIsFirstRunSetupCompleted(): boolean {
  const settings = useAppSettings();
  return settings.firstRunSetupCompletedAt !== null;
}

export function useDefaultModelConfigurationIds() {
  const settings = useAppSettings();
  return useMemo(
    () => ({
      image: settings.defaultImageModelConfigurationId,
      text: settings.defaultTextModelConfigurationId,
    }),
    [settings.defaultImageModelConfigurationId, settings.defaultTextModelConfigurationId],
  );
}

function buildTemplateRefinementResources(deps: {
  draftRepository: TemplateRefinementDraftRepository;
  modelConfigurationRepository: ModelConfigurationRepository;
  personalPromptdexEntryRepository: PersonalPromptdexEntryRepository;
  promptdexCatalogService: MergedPromptdexCatalogService;
}): {
  templateRefinementTextModelClient: TemplateRefinementTextModelClient;
  templateRefinementService: TemplateRefinementService;
} {
  const templateRefinementTextModelClient =
    createFetchTemplateRefinementTextModelClient();
  const templateRefinementService = createTemplateRefinementService({
    draftRepository: deps.draftRepository,
    modelConfigurationRepository: deps.modelConfigurationRepository,
    personalPromptdexEntryRepository: deps.personalPromptdexEntryRepository,
    promptdexCatalogService: deps.promptdexCatalogService,
    textModelClient: templateRefinementTextModelClient,
  });
  return { templateRefinementTextModelClient, templateRefinementService };
}

async function initializeRuntimeResources(): Promise<RuntimeResources> {
  if (SCREENSHOT_RUNTIME_ENABLED) {
    return createScreenshotRuntimeResources();
  }

  if (shouldUseVolatileWebStorage()) {
    console.warn("当前 Web 访问不是安全上下文，已使用仅当前页面会话有效的内存存储。");
    const attentionStore = createMemoryBusinessCallAttentionStore();
    const businessCallAttentionRepository =
      createBusinessCallAttentionRepository({ store: attentionStore });
    const repository = createModelConfigurationRepository({
      store: createMemoryModelConfigurationStore(),
      credentials: createMemoryModelConfigurationCredentialAdapter(),
    });
    const imageTaskRepository = createImageTaskRepository({
      store: createMemoryImageTaskStore(),
      attentionStore,
    });
    const personalPromptdexEntryRepository = createPersonalPromptdexEntryRepository({
      store: createMemoryPersonalPromptdexEntryStore(),
    });
    const promptdexCatalogService = createMergedPromptdexCatalogService({
      personalRepository: personalPromptdexEntryRepository,
    });
    const tableBackupConnectionRepository = createTableBackupConnectionRepository({
      store: createMemoryTableBackupStateStore(),
      credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
    });
    const templateRefinementDraftRepository = createTemplateRefinementDraftRepository({
      store: createMemoryTemplateRefinementDraftStore(),
      attentionStore,
    });
    const { templateRefinementTextModelClient, templateRefinementService } =
      buildTemplateRefinementResources({
        draftRepository: templateRefinementDraftRepository,
        modelConfigurationRepository: repository,
        personalPromptdexEntryRepository,
        promptdexCatalogService,
      });
    const imageFileStorage = createMemoryImageResultFileStorage();
    const imageTaskAttachmentStorage =
      createMemoryImageTaskInternalAttachmentStorage();
    const imageTaskDeletionService = createImageTaskDeletionService({
      imageTaskRepository,
      imageFileStorage,
      imageTaskAttachmentStorage,
    });
    return {
      businessCallAttentionRepository,
      repository,
      imageTaskDeletionService,
      imageTaskRepository,
      personalPromptdexEntryRepository,
      promptdexCatalogService,
      tableBackupConnectionRepository,
      templateRefinementDraftRepository,
      templateRefinementTextModelClient,
      templateRefinementService,
      imageFileStorage,
      imageResultAlbumSaver: createMemoryImageResultAlbumSaver(),
      imageTaskAttachmentStorage,
      settings: await repository.getSettings(),
    };
  }

  const storage = await initializeApplicationStorage();
  if (storage.status === "failed") {
    throw storage.error;
  }

  const credentials = await createSecureStoreModelConfigurationCredentialAdapter();
  const attentionStore = createSqliteBusinessCallAttentionStore(storage.db);
  const businessCallAttentionRepository =
    createBusinessCallAttentionRepository({ store: attentionStore });
  const repository = createSqliteModelConfigurationRepository({
    db: storage.db,
    credentials,
  });
  const imageTaskRepository = createSqliteImageTaskRepository({
    db: storage.db,
    attentionStore,
  });
  const personalPromptdexEntryRepository = createSqlitePersonalPromptdexEntryRepository({
    db: storage.db,
  });
  const promptdexCatalogService = createMergedPromptdexCatalogService({
    personalRepository: personalPromptdexEntryRepository,
  });
  const tableBackupConnectionRepository = createTableBackupConnectionRepository({
    store: createSqliteTableBackupStateStore(storage.db),
    credentials: await createSecureStoreFeishuPersonalBaseTokenCredentialAdapter(),
  });
  const templateRefinementDraftRepository = createSqliteTemplateRefinementDraftRepository({
    db: storage.db,
    attentionStore,
  });
  const { templateRefinementTextModelClient, templateRefinementService } =
    buildTemplateRefinementResources({
      draftRepository: templateRefinementDraftRepository,
      modelConfigurationRepository: repository,
      personalPromptdexEntryRepository,
      promptdexCatalogService,
    });
  const imageFileStorage = createExpoImageResultFileStorage();
  const imageTaskAttachmentStorage =
    createExpoImageTaskInternalAttachmentStorage();
  const imageTaskDeletionService = createImageTaskDeletionService({
    imageTaskRepository,
    imageFileStorage,
    imageTaskAttachmentStorage,
  });
  await imageTaskRepository.markRunningHistoriesUnknown();
  await templateRefinementDraftRepository.markInterruptedGenerationUncertain();
  return {
    businessCallAttentionRepository,
    repository,
    imageTaskDeletionService,
    imageTaskRepository,
    personalPromptdexEntryRepository,
    promptdexCatalogService,
    tableBackupConnectionRepository,
    templateRefinementDraftRepository,
    templateRefinementTextModelClient,
    templateRefinementService,
    imageFileStorage,
    imageResultAlbumSaver: createExpoImageResultAlbumSaver({
      platformOS: Platform.OS,
    }),
    imageTaskAttachmentStorage,
    settings: await repository.getSettings(),
  };
}

function shouldUseVolatileWebStorage(): boolean {
  return Platform.OS === "web" && globalThis.isSecureContext !== true;
}

async function createScreenshotRuntimeResources(): Promise<RuntimeResources> {
  const attentionStore = createMemoryBusinessCallAttentionStore();
  const businessCallAttentionRepository =
    createBusinessCallAttentionRepository({
      store: attentionStore,
      now: () => SCREENSHOT_TIMESTAMP,
    });
  const repository = createModelConfigurationRepository({
    store: createMemoryModelConfigurationStore({ now: () => SCREENSHOT_TIMESTAMP }),
    credentials: createMemoryModelConfigurationCredentialAdapter(),
    now: () => SCREENSHOT_TIMESTAMP,
  });
  const imageTaskRepository = createImageTaskRepository({
    store: createMemoryImageTaskStore(),
    attentionStore,
    now: () => SCREENSHOT_TIMESTAMP,
  });
  const personalPromptdexEntryRepository = createPersonalPromptdexEntryRepository({
    store: createMemoryPersonalPromptdexEntryStore(),
    now: () => SCREENSHOT_TIMESTAMP,
  });
  const promptdexCatalogService = createMergedPromptdexCatalogService({
    personalRepository: personalPromptdexEntryRepository,
  });
  const tableBackupConnectionRepository = createTableBackupConnectionRepository({
    store: createMemoryTableBackupStateStore(),
    credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
    now: () => SCREENSHOT_TIMESTAMP,
  });
  const templateRefinementDraftRepository = createTemplateRefinementDraftRepository({
    store: createMemoryTemplateRefinementDraftStore(),
    attentionStore,
    now: () => SCREENSHOT_TIMESTAMP,
  });
  const { templateRefinementTextModelClient, templateRefinementService } =
    buildTemplateRefinementResources({
      draftRepository: templateRefinementDraftRepository,
      modelConfigurationRepository: repository,
      personalPromptdexEntryRepository,
      promptdexCatalogService,
    });
  const imageFileStorage = createMemoryImageResultFileStorage();
  const imageTaskAttachmentStorage = createMemoryImageTaskInternalAttachmentStorage();
  const imageTaskDeletionService = createImageTaskDeletionService({
    imageTaskRepository,
    imageFileStorage,
    imageTaskAttachmentStorage,
  });

  await seedScreenshotRuntime({
    imageTaskRepository,
    personalPromptdexEntryRepository,
    promptdexCatalogService,
    repository,
  });

  return {
    businessCallAttentionRepository,
    repository,
    imageTaskDeletionService,
    imageTaskRepository,
    personalPromptdexEntryRepository,
    promptdexCatalogService,
    tableBackupConnectionRepository,
    templateRefinementDraftRepository,
    templateRefinementTextModelClient,
    templateRefinementService,
    imageFileStorage,
    imageResultAlbumSaver: createMemoryImageResultAlbumSaver(),
    imageTaskAttachmentStorage,
    settings: await repository.getSettings(),
  };
}

async function seedScreenshotRuntime({
  imageTaskRepository,
  personalPromptdexEntryRepository,
  promptdexCatalogService,
  repository,
}: Pick<
  RuntimeResources,
  | "imageTaskRepository"
  | "personalPromptdexEntryRepository"
  | "promptdexCatalogService"
  | "repository"
>): Promise<void> {
  const imageModel = await repository.save({
    id: "screenshot-image-model",
    type: "image",
    baseUrl: "https://api.openai.com/v1",
    modelName: "gpt-image-2",
    apiKey: "screenshot-key",
  });
  await repository.markReady(imageModel.id, SCREENSHOT_TIMESTAMP);
  await repository.setDefault("image", imageModel.id);

  const textModel = await repository.save({
    id: "screenshot-text-model",
    type: "text",
    baseUrl: "https://api.openai.com/v1",
    modelName: "gpt-5.1",
    apiKey: "screenshot-key",
  });
  await repository.markReady(textModel.id, SCREENSHOT_TIMESTAMP);
  await repository.setDefault("text", textModel.id);

  await personalPromptdexEntryRepository.saveFromTemplate({
    name: "screenshot-personal-poster",
    description: "将产品说明转换为留白充足的个人海报模板",
    version: "screenshot",
    inputs: {
      product:
        {
          required: true,
          description: "需要展示的产品或功能名称",
        },
      audience: {
        required: false,
        description: "面向的目标用户",
      },
    },
    body:
      "生成一张干净、留白充足、层级清晰的中文产品说明海报。保留产品名称，使用克制配色与清晰排版。",
    fileName: "screenshot-personal-poster.md",
    taskType: "generate",
  });

  const builtInEntry = await promptdexCatalogService.get("light-infographic");
  if (!builtInEntry) {
    throw new Error("截图 fixture 缺少 light-infographic 图鉴条目。");
  }
  const personalEntry = await promptdexCatalogService.get(
    "screenshot-personal-poster",
  );
  if (!personalEntry) {
    throw new Error("截图 fixture 缺少个人图鉴条目。");
  }

  const completedHistory = await imageTaskRepository.createRunningHistory({
    id: "screenshot-history-completed",
    taskType: "generate",
    snapshot: {
      source: "promptdex",
      promptdexEntry: {
        name: builtInEntry.template.name,
        description: builtInEntry.template.description,
        version: builtInEntry.template.version,
        sourceType: builtInEntry.sourceType,
        taskType: builtInEntry.template.taskType,
        inputs: builtInEntry.template.inputs,
        body: builtInEntry.template.body,
      },
      taskInputs: {
        content:
          "移动端图鉴页和模板提炼页需要稳定检查中文粗体标签、标题与胶囊状态，不允许出现裁切或遮挡。",
        title: "移动端视觉回归",
      },
      imageSpec: {
        size: "1024x1024",
        quality: "auto",
        format: "png",
        n: 1,
      },
      modelConfiguration: {
        type: "image",
        baseUrl: imageModel.baseUrl,
        modelName: imageModel.modelName,
      },
      fullPrompt:
        "生成一张浅色、清爽、结构清晰的信息图，用于说明移动端视觉回归检查流程。",
    },
  });
  await imageTaskRepository.markCompleted(
    completedHistory.id,
    SCREENSHOT_TIMESTAMP,
  );
  await imageTaskRepository.insertImageResult({
    id: "screenshot-result-light",
    taskHistoryId: completedHistory.id,
    filePath: "missing/screenshot-result-light.png",
    format: "png",
    width: 1024,
    height: 1024,
    createdAt: SCREENSHOT_TIMESTAMP,
  });

  const failedHistory = await imageTaskRepository.createRunningHistory({
    id: "screenshot-history-failed",
    taskType: "generate",
    snapshot: {
      source: "promptdex",
      promptdexEntry: {
        name: personalEntry.template.name,
        description: personalEntry.template.description,
        version: personalEntry.template.version,
        sourceType: personalEntry.sourceType,
        taskType: personalEntry.template.taskType,
        inputs: personalEntry.template.inputs,
        body: personalEntry.template.body,
      },
      taskInputs: {
        product: "Imagemon Promptdex",
        audience: "需要重复检查移动端页面的开发者",
      },
      imageSpec: {
        size: "1024x1536",
        quality: "auto",
        format: "png",
        n: 1,
      },
      modelConfiguration: {
        type: "image",
        baseUrl: imageModel.baseUrl,
        modelName: imageModel.modelName,
      },
      fullPrompt:
        "生成一张干净、留白充足、层级清晰的中文产品说明海报。",
    },
  });
  await imageTaskRepository.markFailed(
    failedHistory.id,
    {
      reason: "network_error",
      message: "截图 fixture：模拟一次失败任务，用于覆盖历史失败状态标签。",
      occurredAt: SCREENSHOT_TIMESTAMP,
    },
    SCREENSHOT_TIMESTAMP,
  );

  await repository.completeFirstRunSetup(SCREENSHOT_TIMESTAMP);
}
