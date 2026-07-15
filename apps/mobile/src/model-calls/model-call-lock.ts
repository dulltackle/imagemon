import type { ModelConfigurationType } from "../model-configurations/types";
import { createRandomId, createUtcTimestamp } from "../storage";

export type ModelCallType =
  | "modelConfigurationTest"
  | "modelListFetch"
  | "imageGeneration"
  | "imageEdit"
  | "templateRefinement";

export interface ModelCallContext {
  readonly historyId?: string;
  readonly promptdexEntryName?: string;
  readonly modelConfigurationId?: string;
}

export interface BeginModelCallInput {
  readonly type: ModelCallType;
  readonly returnHref: string;
  readonly ownerKey: string;
  readonly context?: ModelCallContext;
}

export interface ActiveModelCall extends BeginModelCallInput {
  readonly id: string;
  readonly startedAt: string;
}

export type UpdateModelCallPatch = Partial<
  Pick<BeginModelCallInput, "returnHref" | "ownerKey" | "context">
>;

export type BeginModelCallResult =
  | {
      readonly status: "started";
      readonly call: ActiveModelCall;
    }
  | {
      readonly status: "blocked";
      readonly reason: "model_call";
      readonly activeCall: ActiveModelCall;
    }
  | {
      readonly status: "blocked";
      readonly reason: "migration";
    };

/**
 * 迁移操作锁占用态的只读查询。模型调用锁 begin 前借它做双向互斥，
 * 但飞书迁移调用不是模型调用——不占本锁、不进全局模型调用状态。
 */
export interface MigrationOccupancyQuery {
  readonly isMigrationActive: () => boolean;
}

export interface ModelCallLockStore {
  readonly getSnapshot: () => ActiveModelCall | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly beginModelCall: (input: BeginModelCallInput) => BeginModelCallResult;
  readonly updateModelCall: (
    id: string,
    patch: UpdateModelCallPatch,
  ) => void;
  readonly endModelCall: (id: string) => void;
}

export interface CreateModelCallLockStoreOptions {
  generateId?: () => string;
  now?: () => string;
  migrationLock?: MigrationOccupancyQuery;
}

const MODEL_CALL_STATUS_LABELS = {
  modelConfigurationTest: "测试连接进行中",
  modelListFetch: "拉取模型列表进行中",
  imageGeneration: "图片任务进行中",
  imageEdit: "图片任务进行中",
  templateRefinement: "模板提炼进行中",
} as const satisfies Record<ModelCallType, string>;

export const TEMPLATE_REFINEMENT_MODEL_CALL_OWNER_KEY = "template-refinement";

export function getPromptdexEntryModelCallOwnerKey(name: string): string {
  return `promptdex-entry:${name}`;
}

export function getModelConfigurationModelCallOwnerKey(id: string): string {
  return `model-configuration:${id}`;
}

export function getNewModelConfigurationModelCallOwnerKey(
  type: ModelConfigurationType,
): string {
  return `model-configuration-new:${type}`;
}

export function getFirstRunModelCallOwnerKey(
  type: ModelConfigurationType,
): string {
  return `first-run:${type}`;
}

export function getModelCallStatusLabel(type: ModelCallType): string {
  return MODEL_CALL_STATUS_LABELS[type];
}

/**
 * 创建进程内的单模型调用锁。
 *
 * 活跃调用保存在闭包中，并在 beginModelCall 返回前同步写入，因此即使 React
 * 尚未完成下一次渲染，同一事件中的第二次 beginModelCall 也只能得到 blocked。
 */
export function createModelCallLockStore(
  options: CreateModelCallLockStoreOptions = {},
): ModelCallLockStore {
  const generateId = options.generateId ?? createRandomId;
  const now = options.now ?? createUtcTimestamp;
  const migrationLock = options.migrationLock;
  const listeners = new Set<() => void>();
  let activeCall: ActiveModelCall | null = null;

  const getSnapshot = () => activeCall;

  const notify = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const beginModelCall = (
    input: BeginModelCallInput,
  ): BeginModelCallResult => {
    if (activeCall) {
      return {
        status: "blocked",
        reason: "model_call",
        activeCall,
      };
    }

    if (migrationLock?.isMigrationActive()) {
      return {
        status: "blocked",
        reason: "migration",
      };
    }

    const call: ActiveModelCall = {
      id: generateId(),
      type: input.type,
      returnHref: input.returnHref,
      ownerKey: input.ownerKey,
      context: cloneContext(input.context),
      startedAt: now(),
    };
    activeCall = call;
    notify();

    return {
      status: "started",
      call,
    };
  };

  const updateModelCall = (id: string, patch: UpdateModelCallPatch) => {
    if (!activeCall || activeCall.id !== id) {
      return;
    }

    const hasContextPatch = Object.prototype.hasOwnProperty.call(
      patch,
      "context",
    );
    const nextContext = hasContextPatch
      ? mergeContext(activeCall.context, patch.context)
      : activeCall.context;

    activeCall = {
      ...activeCall,
      returnHref: patch.returnHref ?? activeCall.returnHref,
      ownerKey: patch.ownerKey ?? activeCall.ownerKey,
      context: nextContext,
    };
    notify();
  };

  const endModelCall = (id: string) => {
    if (!activeCall || activeCall.id !== id) {
      return;
    }

    activeCall = null;
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
    beginModelCall,
    updateModelCall,
    endModelCall,
  };
}

function cloneContext(
  context: ModelCallContext | undefined,
): ModelCallContext | undefined {
  return context ? { ...context } : undefined;
}

function mergeContext(
  current: ModelCallContext | undefined,
  patch: ModelCallContext | undefined,
): ModelCallContext | undefined {
  if (!patch) {
    return undefined;
  }
  return { ...current, ...patch };
}
