import type { PromptdexTemplateInput } from "@imagemon/core";

import {
  TEMPLATE_REFINEMENT_ATTENTION_SUBJECT_ID,
  type BusinessCallAttentionStore,
} from "../business-call-attentions/repository";
import {
  type ApplicationDatabase,
  createUtcTimestamp,
} from "../storage";

export const TEMPLATE_REFINEMENT_DRAFT_ID = "template_refinement";

export type TemplateRefinementDraftStatus =
  | "editing_input"
  | "generating"
  | "ready_for_review"
  | "failed";

export type TemplateRefinementFailureReason =
  | "missing_text_model_configuration"
  | "missing_credential"
  | "offline"
  | "unauthorized"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "invalid_response"
  | "promptdex_contract_invalid"
  | "unknown";

export interface TemplateRefinementProposal {
  template: {
    name: string;
    description: string;
    version?: string | boolean;
    inputs: Record<string, PromptdexTemplateInput>;
    body: string;
  };
  taskTypeRationale: string;
  retainedRules: string[];
  removedRules: Array<{
    reason: string;
    summary: string;
  }>;
  additions: Array<{
    summary: string;
    reason: string;
    impactIfRejected: string;
  }>;
}

export interface TemplateRefinementErrorSummary {
  reason: TemplateRefinementFailureReason;
  occurredAt: string;
  statusCode?: number;
  providerCode?: string;
}

export interface TemplateRefinementInputDraft {
  externalPrompt: string;
  plannedUse: string;
}

export interface TemplateRefinementDraft extends TemplateRefinementInputDraft {
  status: TemplateRefinementDraftStatus;
  proposal: TemplateRefinementProposal | null;
  errorSummary: TemplateRefinementErrorSummary | null;
  createdAt: string;
  updatedAt: string;
}

export type TemplateRefinementDraftRepositoryErrorCode = "not_found";

export class TemplateRefinementDraftRepositoryError extends Error {
  constructor(
    readonly code: TemplateRefinementDraftRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TemplateRefinementDraftRepositoryError";
  }
}

export interface TemplateRefinementDraftRepository {
  get(): Promise<TemplateRefinementDraft | null>;
  saveEditingInput(input: TemplateRefinementInputDraft): Promise<TemplateRefinementDraft>;
  startGenerating(input: TemplateRefinementInputDraft): Promise<TemplateRefinementDraft>;
  saveProposal(proposal: TemplateRefinementProposal): Promise<TemplateRefinementDraft>;
  updateReviewProposal(proposal: TemplateRefinementProposal): Promise<TemplateRefinementDraft>;
  saveFailure(errorSummary: TemplateRefinementErrorSummary): Promise<TemplateRefinementDraft>;
  markInterruptedGenerationUncertain(): Promise<boolean>;
  clear(): Promise<void>;
}

export interface TemplateRefinementDraftStore {
  withTransaction<T>(task: () => Promise<T>): Promise<T>;
  getDraft(): Promise<TemplateRefinementDraftRecord | null>;
  upsertDraft(record: TemplateRefinementDraftRecord): Promise<void>;
  clearDraft(): Promise<void>;
}

interface TemplateRefinementDraftRecord {
  status: TemplateRefinementDraftStatus;
  externalPrompt: string;
  plannedUse: string;
  proposal: TemplateRefinementProposal | null;
  errorSummary: TemplateRefinementErrorSummary | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateTemplateRefinementDraftRepositoryOptions {
  store: TemplateRefinementDraftStore;
  attentionStore?: BusinessCallAttentionStore;
  now?: () => string;
}

interface CreateSqliteTemplateRefinementDraftRepositoryOptions {
  db: ApplicationDatabase;
  attentionStore?: BusinessCallAttentionStore;
  now?: () => string;
}

export function createTemplateRefinementDraftRepository({
  store,
  attentionStore,
  now = createUtcTimestamp,
}: CreateTemplateRefinementDraftRepositoryOptions): TemplateRefinementDraftRepository {
  async function upsertInputDraft(
    input: TemplateRefinementInputDraft,
    status: Extract<TemplateRefinementDraftStatus, "editing_input" | "generating">,
  ): Promise<TemplateRefinementDraft> {
    let attentionChanged = false;
    const draft = await store.withTransaction(async () => {
      const existing = await store.getDraft();
      const timestamp = now();
      const record: TemplateRefinementDraftRecord = {
        status,
        externalPrompt: input.externalPrompt,
        plannedUse: input.plannedUse,
        proposal: null,
        errorSummary: null,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      await store.upsertDraft(record);
      if (status === "generating" && attentionStore) {
        await attentionStore.clearAttention(
          "template_refinement",
          TEMPLATE_REFINEMENT_ATTENTION_SUBJECT_ID,
        );
        attentionChanged = true;
      }
      return recordToDraft(record);
    });
    if (attentionChanged) {
      attentionStore?.publish();
    }
    return draft;
  }

  async function saveReviewProposal(
    proposal: TemplateRefinementProposal,
    attentionKind?: "succeeded",
  ): Promise<TemplateRefinementDraft> {
    let attentionChanged = false;
    const draft = await store.withTransaction(async () => {
      const existing = await requireExistingDraft(store);
      const timestamp = now();
      const record: TemplateRefinementDraftRecord = {
        ...existing,
        status: "ready_for_review",
        proposal: cloneProposal(proposal),
        errorSummary: null,
        updatedAt: timestamp,
      };
      await store.upsertDraft(record);
      if (attentionKind && attentionStore) {
        await attentionStore.upsertAttention({
          subjectType: "template_refinement",
          subjectId: TEMPLATE_REFINEMENT_ATTENTION_SUBJECT_ID,
          kind: attentionKind,
          createdAt: timestamp,
        });
        attentionChanged = true;
      }
      return recordToDraft(record);
    });
    if (attentionChanged) {
      attentionStore?.publish();
    }
    return draft;
  }

  return {
    async get() {
      const record = await store.getDraft();
      return record ? recordToDraft(record) : null;
    },

    async saveEditingInput(input) {
      return upsertInputDraft(input, "editing_input");
    },

    async startGenerating(input) {
      return upsertInputDraft(input, "generating");
    },

    async saveProposal(proposal) {
      return saveReviewProposal(proposal, "succeeded");
    },

    async updateReviewProposal(proposal) {
      return saveReviewProposal(proposal);
    },

    async saveFailure(errorSummary) {
      let attentionChanged = false;
      const draft = await store.withTransaction(async () => {
        const existing = await requireExistingDraft(store);
        const timestamp = now();
        const record: TemplateRefinementDraftRecord = {
          ...existing,
          status: "failed",
          proposal: null,
          errorSummary: cloneErrorSummary(errorSummary),
          updatedAt: timestamp,
        };
        await store.upsertDraft(record);
        if (attentionStore) {
          await attentionStore.upsertAttention({
            subjectType: "template_refinement",
            subjectId: TEMPLATE_REFINEMENT_ATTENTION_SUBJECT_ID,
            kind: "failed",
            createdAt: timestamp,
          });
          attentionChanged = true;
        }
        return recordToDraft(record);
      });
      if (attentionChanged) {
        attentionStore?.publish();
      }
      return draft;
    },

    async markInterruptedGenerationUncertain() {
      if (!attentionStore) {
        return false;
      }

      let recovered = false;
      await store.withTransaction(async () => {
        const existing = await store.getDraft();
        if (existing?.status !== "generating") {
          return;
        }
        await attentionStore.upsertAttention({
          subjectType: "template_refinement",
          subjectId: TEMPLATE_REFINEMENT_ATTENTION_SUBJECT_ID,
          kind: "uncertain",
          createdAt: now(),
        });
        recovered = true;
      });
      if (recovered) {
        attentionStore.publish();
      }
      return recovered;
    },

    async clear() {
      let attentionChanged = false;
      await store.withTransaction(async () => {
        await store.clearDraft();
        if (attentionStore) {
          await attentionStore.clearAttention(
            "template_refinement",
            TEMPLATE_REFINEMENT_ATTENTION_SUBJECT_ID,
          );
          attentionChanged = true;
        }
      });
      if (attentionChanged) {
        attentionStore?.publish();
      }
    },
  };
}

export function createSqliteTemplateRefinementDraftRepository({
  db,
  attentionStore,
  now,
}: CreateSqliteTemplateRefinementDraftRepositoryOptions): TemplateRefinementDraftRepository {
  return createTemplateRefinementDraftRepository({
    store: createSqliteTemplateRefinementDraftStore(db),
    attentionStore,
    now,
  });
}

export function createMemoryTemplateRefinementDraftStore(): TemplateRefinementDraftStore {
  let draft: TemplateRefinementDraftRecord | null = null;

  return {
    async withTransaction(task) {
      const snapshot = draft ? cloneRecord(draft) : null;
      try {
        return await task();
      } catch (error) {
        draft = snapshot;
        throw error;
      }
    },

    async getDraft() {
      return draft ? cloneRecord(draft) : null;
    },

    async upsertDraft(record) {
      draft = cloneRecord(record);
    },

    async clearDraft() {
      draft = null;
    },
  };
}

export function createSqliteTemplateRefinementDraftStore(
  db: ApplicationDatabase,
): TemplateRefinementDraftStore {
  return {
    async withTransaction(task) {
      let result: Awaited<ReturnType<typeof task>> | undefined;
      await db.withTransactionAsync(async () => {
        result = await task();
      });
      return result as Awaited<ReturnType<typeof task>>;
    },

    async getDraft() {
      const row = await db.getFirstAsync<TemplateRefinementDraftRow>(
        `
          SELECT *
          FROM template_refinement_drafts
          WHERE id = ?
        `,
        TEMPLATE_REFINEMENT_DRAFT_ID,
      );
      return row ? mapRowToRecord(row) : null;
    },

    async upsertDraft(record) {
      await db.runAsync(
        `
          INSERT INTO template_refinement_drafts (
            id,
            status,
            external_prompt,
            planned_use,
            proposal_json,
            error_summary_json,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            external_prompt = excluded.external_prompt,
            planned_use = excluded.planned_use,
            proposal_json = excluded.proposal_json,
            error_summary_json = excluded.error_summary_json,
            updated_at = excluded.updated_at
        `,
        TEMPLATE_REFINEMENT_DRAFT_ID,
        record.status,
        record.externalPrompt,
        record.plannedUse,
        record.proposal ? JSON.stringify(record.proposal) : null,
        record.errorSummary ? JSON.stringify(record.errorSummary) : null,
        record.createdAt,
        record.updatedAt,
      );
    },

    async clearDraft() {
      await db.runAsync(
        `
          DELETE FROM template_refinement_drafts
          WHERE id = ?
        `,
        TEMPLATE_REFINEMENT_DRAFT_ID,
      );
    },
  };
}

async function requireExistingDraft(
  store: TemplateRefinementDraftStore,
): Promise<TemplateRefinementDraftRecord> {
  const existing = await store.getDraft();
  if (!existing) {
    throw new TemplateRefinementDraftRepositoryError(
      "not_found",
      "提炼草稿不存在。",
    );
  }
  return existing;
}

function recordToDraft(
  record: TemplateRefinementDraftRecord,
): TemplateRefinementDraft {
  return cloneRecord(record);
}

function mapRowToRecord(row: TemplateRefinementDraftRow): TemplateRefinementDraftRecord {
  return {
    status: row.status,
    externalPrompt: row.external_prompt,
    plannedUse: row.planned_use,
    proposal: row.proposal_json
      ? parseJsonField<TemplateRefinementProposal>(row.proposal_json, "proposal_json")
      : null,
    errorSummary: row.error_summary_json
      ? parseJsonField<TemplateRefinementErrorSummary>(
          row.error_summary_json,
          "error_summary_json",
        )
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJsonField<T>(value: string, fieldName: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`${fieldName} 不是有效 JSON。`, { cause: error });
  }
}

function cloneRecord(
  record: TemplateRefinementDraftRecord,
): TemplateRefinementDraftRecord {
  return {
    ...record,
    proposal: record.proposal ? cloneProposal(record.proposal) : null,
    errorSummary: record.errorSummary
      ? cloneErrorSummary(record.errorSummary)
      : null,
  };
}

function cloneProposal(
  proposal: TemplateRefinementProposal,
): TemplateRefinementProposal {
  return {
    template: {
      ...proposal.template,
      inputs: cloneInputs(proposal.template.inputs),
    },
    taskTypeRationale: proposal.taskTypeRationale,
    retainedRules: [...proposal.retainedRules],
    removedRules: proposal.removedRules.map((rule) => ({ ...rule })),
    additions: proposal.additions.map((addition) => ({ ...addition })),
  };
}

function cloneInputs(
  inputs: Record<string, PromptdexTemplateInput>,
): Record<string, PromptdexTemplateInput> {
  return Object.fromEntries(
    Object.entries(inputs).map(([name, input]) => [name, { ...input }]),
  );
}

function cloneErrorSummary(
  errorSummary: TemplateRefinementErrorSummary,
): TemplateRefinementErrorSummary {
  return { ...errorSummary };
}

interface TemplateRefinementDraftRow {
  id: string;
  status: TemplateRefinementDraftStatus;
  external_prompt: string;
  planned_use: string;
  proposal_json: string | null;
  error_summary_json: string | null;
  created_at: string;
  updated_at: string;
}
