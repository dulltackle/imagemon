import { createContext, use, useMemo, useSyncExternalStore } from "react";

import type {
  ActiveMigrationOperation,
  BeginMigrationOperationResult,
  MigrationLockStore,
  MigrationOperationKind,
} from "./migration-lock";

export interface MigrationLockContextValue {
  readonly activeOperation: ActiveMigrationOperation | null;
  readonly beginMigrationOperation: (
    kind: MigrationOperationKind,
  ) => BeginMigrationOperationResult;
  readonly endMigrationOperation: (id: string) => void;
}

// 迁移锁上下文的值由 ModelCallLockProvider 一并提供：两把锁在同一处创建并交叉互斥。
export const MigrationLockContext = createContext<MigrationLockContextValue | null>(
  null,
);

export function useMigrationLock(): MigrationLockContextValue {
  const value = use(MigrationLockContext);
  if (!value) {
    throw new Error("useMigrationLock must be used within ModelCallLockProvider.");
  }
  return value;
}

/** 把迁移锁 store 绑成 React 上下文值（订阅活跃操作快照）。 */
export function useMigrationLockContextValue(
  store: MigrationLockStore,
): MigrationLockContextValue {
  const activeOperation = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return useMemo<MigrationLockContextValue>(
    () => ({
      activeOperation,
      beginMigrationOperation: store.beginMigrationOperation,
      endMigrationOperation: store.endMigrationOperation,
    }),
    [activeOperation, store],
  );
}
