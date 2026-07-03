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
  createMemoryModelConfigurationCredentialAdapter,
  createSecureStoreModelConfigurationCredentialAdapter,
  initializeApplicationStorage,
} from "../storage";
import {
  createExpoImageResultFileStorage,
  createImageTaskRepository,
  createMemoryImageResultFileStorage,
  createMemoryImageTaskStore,
  createSqliteImageTaskRepository,
  type ImageResultFileStorage,
  type ImageTaskRepository,
} from "../image-tasks";
import {
  createMemoryModelConfigurationStore,
  createModelConfigurationRepository,
  createSqliteModelConfigurationRepository,
  type AppSettings,
  type ModelConfigurationRepository,
} from "../model-configurations";

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
      repository: ModelConfigurationRepository;
      imageTaskRepository: ImageTaskRepository;
      imageFileStorage: ImageResultFileStorage;
      settings: AppSettings;
      refreshSettings(): Promise<AppSettings>;
      replaceSettings(settings: AppSettings): void;
    };

interface AppRuntimeProviderProps {
  children: ReactNode;
}

interface RuntimeResources {
  repository: ModelConfigurationRepository;
  imageTaskRepository: ImageTaskRepository;
  imageFileStorage: ImageResultFileStorage;
  settings: AppSettings;
}

const AppRuntimeContext = createContext<AppRuntimeState | null>(null);

export function AppRuntimeProvider({ children }: AppRuntimeProviderProps) {
  const [state, setState] = useState<AppRuntimeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const { imageFileStorage, imageTaskRepository, repository, settings } =
          await initializeRuntimeResources();
        if (!cancelled) {
          setState({
            status: "ready",
            repository,
            imageTaskRepository,
            imageFileStorage,
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

async function initializeRuntimeResources(): Promise<RuntimeResources> {
  if (shouldUseVolatileWebStorage()) {
    console.warn("当前 Web 访问不是安全上下文，已使用仅当前页面会话有效的内存存储。");
    const repository = createModelConfigurationRepository({
      store: createMemoryModelConfigurationStore(),
      credentials: createMemoryModelConfigurationCredentialAdapter(),
    });
    const imageTaskRepository = createImageTaskRepository({
      store: createMemoryImageTaskStore(),
    });
    return {
      repository,
      imageTaskRepository,
      imageFileStorage: createMemoryImageResultFileStorage(),
      settings: await repository.getSettings(),
    };
  }

  const storage = await initializeApplicationStorage();
  if (storage.status === "failed") {
    throw storage.error;
  }

  const credentials = await createSecureStoreModelConfigurationCredentialAdapter();
  const repository = createSqliteModelConfigurationRepository({
    db: storage.db,
    credentials,
  });
  const imageTaskRepository = createSqliteImageTaskRepository({
    db: storage.db,
  });
  await imageTaskRepository.markRunningHistoriesUnknown();
  return {
    repository,
    imageTaskRepository,
    imageFileStorage: createExpoImageResultFileStorage(),
    settings: await repository.getSettings(),
  };
}

function shouldUseVolatileWebStorage(): boolean {
  return Platform.OS === "web" && globalThis.isSecureContext !== true;
}
