import {
  type ApplicationDatabase,
  createUtcTimestamp,
} from "../storage";

export const TEMPLATE_REFINEMENT_ATTENTION_SUBJECT_ID =
  "template_refinement";

export type BusinessCallAttentionSubjectType =
  | "image_task"
  | "template_refinement";

export type BusinessCallAttentionKind =
  | "succeeded"
  | "failed"
  | "uncertain";

export interface BusinessCallAttention {
  readonly subjectType: BusinessCallAttentionSubjectType;
  readonly subjectId: string;
  readonly kind: BusinessCallAttentionKind;
  readonly createdAt: string;
}

/**
 * 提示底层存储。业务仓储可在自己的事务内直接写入，并在事务提交后调用
 * publish，使业务对象与提示在 SQLite 中保持同一事务，同时避免发布未提交状态。
 */
export interface BusinessCallAttentionStore {
  listAttentions(): Promise<BusinessCallAttention[]>;
  upsertAttention(attention: BusinessCallAttention): Promise<void>;
  clearAttention(
    subjectType: BusinessCallAttentionSubjectType,
    subjectId: string,
  ): Promise<void>;
  subscribe(listener: () => void): () => void;
  publish(): void;
}

export interface BusinessCallAttentionRepository {
  list(): Promise<BusinessCallAttention[]>;
  markImageTask(
    historyId: string,
    kind: BusinessCallAttentionKind,
  ): Promise<void>;
  markTemplateRefinement(kind: BusinessCallAttentionKind): Promise<void>;
  clearImageTask(historyId: string): Promise<void>;
  clearTemplateRefinement(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

interface CreateBusinessCallAttentionRepositoryOptions {
  store: BusinessCallAttentionStore;
  now?: () => string;
}

interface BusinessCallAttentionRow {
  subject_type: BusinessCallAttentionSubjectType;
  subject_id: string;
  kind: BusinessCallAttentionKind;
  created_at: string;
}

export function createBusinessCallAttentionRepository({
  store,
  now = createUtcTimestamp,
}: CreateBusinessCallAttentionRepositoryOptions): BusinessCallAttentionRepository {
  async function mark(
    subjectType: BusinessCallAttentionSubjectType,
    subjectId: string,
    kind: BusinessCallAttentionKind,
  ): Promise<void> {
    await store.upsertAttention({
      subjectType,
      subjectId,
      kind,
      createdAt: now(),
    });
    store.publish();
  }

  async function clear(
    subjectType: BusinessCallAttentionSubjectType,
    subjectId: string,
  ): Promise<void> {
    await store.clearAttention(subjectType, subjectId);
    store.publish();
  }

  return {
    async list() {
      return (await store.listAttentions()).map(cloneAttention);
    },

    async markImageTask(historyId, kind) {
      await mark("image_task", historyId, kind);
    },

    async markTemplateRefinement(kind) {
      await mark(
        "template_refinement",
        TEMPLATE_REFINEMENT_ATTENTION_SUBJECT_ID,
        kind,
      );
    },

    async clearImageTask(historyId) {
      await clear("image_task", historyId);
    },

    async clearTemplateRefinement() {
      await clear(
        "template_refinement",
        TEMPLATE_REFINEMENT_ATTENTION_SUBJECT_ID,
      );
    },

    subscribe(listener) {
      return store.subscribe(listener);
    },
  };
}

export function createMemoryBusinessCallAttentionStore(): BusinessCallAttentionStore {
  let attentions = new Map<string, BusinessCallAttention>();
  const listeners = new Set<() => void>();

  return {
    async listAttentions() {
      return [...attentions.values()]
        .map(cloneAttention)
        .sort(compareAttentionDescending);
    },

    async upsertAttention(attention) {
      attentions.set(getAttentionKey(attention), cloneAttention(attention));
    },

    async clearAttention(subjectType, subjectId) {
      attentions.delete(getAttentionKey({ subjectType, subjectId }));
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    publish() {
      publishListeners(listeners);
    },
  };
}

export function createSqliteBusinessCallAttentionStore(
  db: ApplicationDatabase,
): BusinessCallAttentionStore {
  const listeners = new Set<() => void>();

  return {
    async listAttentions() {
      const rows = await db.getAllAsync<BusinessCallAttentionRow>(`
        SELECT subject_type, subject_id, kind, created_at
        FROM business_call_attentions
        ORDER BY created_at DESC, subject_type ASC, subject_id ASC
      `);
      return rows.map(mapRowToAttention);
    },

    async upsertAttention(attention) {
      await db.runAsync(
        `
          INSERT INTO business_call_attentions (
            subject_type,
            subject_id,
            kind,
            created_at
          )
          VALUES (?, ?, ?, ?)
          ON CONFLICT(subject_type, subject_id) DO UPDATE SET
            kind = excluded.kind,
            created_at = excluded.created_at
        `,
        attention.subjectType,
        attention.subjectId,
        attention.kind,
        attention.createdAt,
      );
    },

    async clearAttention(subjectType, subjectId) {
      await db.runAsync(
        `
          DELETE FROM business_call_attentions
          WHERE subject_type = ? AND subject_id = ?
        `,
        subjectType,
        subjectId,
      );
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    publish() {
      publishListeners(listeners);
    },
  };
}

function getAttentionKey(
  attention: Pick<BusinessCallAttention, "subjectType" | "subjectId">,
): string {
  return `${attention.subjectType}\u0000${attention.subjectId}`;
}

function mapRowToAttention(
  row: BusinessCallAttentionRow,
): BusinessCallAttention {
  return {
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

function cloneAttention(
  attention: BusinessCallAttention,
): BusinessCallAttention {
  return { ...attention };
}

function compareAttentionDescending(
  left: BusinessCallAttention,
  right: BusinessCallAttention,
): number {
  const createdAtComparison = right.createdAt.localeCompare(left.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }
  return getAttentionKey(left).localeCompare(getAttentionKey(right));
}

function publishListeners(listeners: ReadonlySet<() => void>): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 通知属于提交后的派生刷新，订阅者异常不能反向改变已完成的业务写入。
      console.warn("业务调用提示订阅者执行失败，已忽略本次刷新异常。");
    }
  }
}
