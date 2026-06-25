import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  createSecureStoreModelConfigurationCredentialAdapter,
  initializeApplicationStorage,
} from "../storage";
import {
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
      settings: AppSettings;
      refreshSettings(): Promise<AppSettings>;
      replaceSettings(settings: AppSettings): void;
    };

interface AppRuntimeProviderProps {
  children: ReactNode;
}

const AppRuntimeContext = createContext<AppRuntimeState | null>(null);

export function AppRuntimeProvider({ children }: AppRuntimeProviderProps) {
  const [state, setState] = useState<AppRuntimeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const storage = await initializeApplicationStorage();
      if (cancelled) {
        return;
      }
      if (storage.status === "failed") {
        setState({
          status: "failed",
          error: storage.error,
        });
        return;
      }

      try {
        const credentials = await createSecureStoreModelConfigurationCredentialAdapter();
        const repository = createSqliteModelConfigurationRepository({
          db: storage.db,
          credentials,
        });
        const settings = await repository.getSettings();
        if (!cancelled) {
          setState({
            status: "ready",
            repository,
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
