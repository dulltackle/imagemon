import {
  createContext,
  use,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  MigrationLockContext,
  useMigrationLockContextValue,
} from "../table-backup/migration-lock-context";
import {
  createMigrationLockStore,
  type MigrationLockStore,
} from "../table-backup/migration-lock";
import {
  createModelCallLockStore,
  type ActiveModelCall,
  type BeginModelCallInput,
  type BeginModelCallResult,
  type ModelCallLockStore,
  type UpdateModelCallPatch,
} from "./model-call-lock";

export interface ModelCallLockContextValue {
  readonly activeCall: ActiveModelCall | null;
  readonly beginModelCall: (
    input: BeginModelCallInput,
  ) => BeginModelCallResult;
  readonly updateModelCall: (
    id: string,
    patch: UpdateModelCallPatch,
  ) => void;
  readonly endModelCall: (id: string) => void;
}

interface ModelCallLockProviderProps {
  readonly children: ReactNode;
}

const ModelCallLockContext = createContext<ModelCallLockContextValue | null>(
  null,
);

export function ModelCallLockProvider({ children }: ModelCallLockProviderProps) {
  // 模型调用锁与迁移操作锁在此一并创建并双向交叉引用：各自 begin 前查对方占用态。
  const storesRef = useRef<{
    modelCall: ModelCallLockStore;
    migration: MigrationLockStore;
  } | null>(null);
  if (!storesRef.current) {
    const stores = {} as {
      modelCall: ModelCallLockStore;
      migration: MigrationLockStore;
    };
    stores.modelCall = createModelCallLockStore({
      migrationLock: {
        isMigrationActive: () => stores.migration.getSnapshot() !== null,
      },
    });
    stores.migration = createMigrationLockStore({
      modelCallLock: {
        isModelCallActive: () => stores.modelCall.getSnapshot() !== null,
      },
    });
    storesRef.current = stores;
  }
  const store = storesRef.current.modelCall;
  const activeCall = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  const value = useMemo<ModelCallLockContextValue>(
    () => ({
      activeCall,
      beginModelCall: store.beginModelCall,
      updateModelCall: store.updateModelCall,
      endModelCall: store.endModelCall,
    }),
    [activeCall, store],
  );

  const migrationValue = useMigrationLockContextValue(
    storesRef.current.migration,
  );

  return (
    <ModelCallLockContext.Provider value={value}>
      <MigrationLockContext.Provider value={migrationValue}>
        {children}
      </MigrationLockContext.Provider>
    </ModelCallLockContext.Provider>
  );
}

export function useModelCallLock(): ModelCallLockContextValue {
  const value = use(ModelCallLockContext);
  if (!value) {
    throw new Error("useModelCallLock must be used within ModelCallLockProvider.");
  }
  return value;
}
