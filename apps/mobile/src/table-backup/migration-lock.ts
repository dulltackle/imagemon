// 通用迁移操作锁（方案 2.4）。刻意不叫 table-backup 专名：将来 ZIP 导出/恢复复用。
//
// 与模型调用锁双向互斥：迁移锁 begin 前查模型调用占用态，模型调用锁 begin 前查
// 迁移占用态（见 model-call-lock.ts）。飞书 API 调用不是模型调用，不占模型调用锁。
import { createRandomId, createUtcTimestamp } from "../storage";

export type MigrationOperationKind =
  | "table_backup"
  | "table_restore"
  // 预留：ZIP 备份另行立项，锁通道直接复用。
  | "zip_export"
  | "zip_import";

export interface ActiveMigrationOperation {
  readonly id: string;
  readonly kind: MigrationOperationKind;
  readonly startedAt: string;
}

/** 模型调用锁占用态的只读查询，用于迁移锁 begin 前的互斥判断。 */
export interface ModelCallOccupancyQuery {
  readonly isModelCallActive: () => boolean;
}

export type BeginMigrationOperationResult =
  | {
      readonly status: "acquired";
      readonly operation: ActiveMigrationOperation;
    }
  | {
      readonly status: "blocked";
      readonly reason: "migration";
      readonly activeOperation: ActiveMigrationOperation;
    }
  | {
      readonly status: "blocked";
      readonly reason: "model_call";
    };

export interface MigrationLockStore {
  readonly getSnapshot: () => ActiveMigrationOperation | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly beginMigrationOperation: (
    kind: MigrationOperationKind,
  ) => BeginMigrationOperationResult;
  readonly endMigrationOperation: (id: string) => void;
}

export interface CreateMigrationLockStoreOptions {
  generateId?: () => string;
  now?: () => string;
  modelCallLock?: ModelCallOccupancyQuery;
}

const MIGRATION_OPERATION_STATUS_LABELS = {
  table_backup: "表格备份进行中",
  table_restore: "表格恢复进行中",
  zip_export: "导出进行中",
  zip_import: "恢复进行中",
} as const satisfies Record<MigrationOperationKind, string>;

export function getMigrationOperationStatusLabel(
  kind: MigrationOperationKind,
): string {
  return MIGRATION_OPERATION_STATUS_LABELS[kind];
}

/**
 * 创建进程内的单迁移操作锁。活跃操作保存在闭包中并在 begin 返回前同步写入，
 * 因此同一事件中的第二次 begin 只能得到 blocked。
 */
export function createMigrationLockStore(
  options: CreateMigrationLockStoreOptions = {},
): MigrationLockStore {
  const generateId = options.generateId ?? createRandomId;
  const now = options.now ?? createUtcTimestamp;
  const modelCallLock = options.modelCallLock;
  const listeners = new Set<() => void>();
  let activeOperation: ActiveMigrationOperation | null = null;

  const getSnapshot = () => activeOperation;

  const notify = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const beginMigrationOperation = (
    kind: MigrationOperationKind,
  ): BeginMigrationOperationResult => {
    if (activeOperation) {
      return {
        status: "blocked",
        reason: "migration",
        activeOperation,
      };
    }

    if (modelCallLock?.isModelCallActive()) {
      return {
        status: "blocked",
        reason: "model_call",
      };
    }

    const operation: ActiveMigrationOperation = {
      id: generateId(),
      kind,
      startedAt: now(),
    };
    activeOperation = operation;
    notify();

    return {
      status: "acquired",
      operation,
    };
  };

  const endMigrationOperation = (id: string) => {
    if (!activeOperation || activeOperation.id !== id) {
      return;
    }
    activeOperation = null;
    notify();
  };

  return {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    beginMigrationOperation,
    endMigrationOperation,
  };
}
