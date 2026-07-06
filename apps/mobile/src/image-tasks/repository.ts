import {
  type ApplicationDatabase,
  type IdGenerator,
  createRandomId,
  createUtcTimestamp,
} from "../storage";
import type {
  ImageResult,
  ImageTaskFailureSummary,
  ImageTaskHistory,
  ImageTaskSnapshot,
  ImageTaskStatus,
  ImageTaskType,
} from "./types";
import {
  cloneImageTaskSnapshot,
  parseImageTaskSnapshotJson,
  serializeImageTaskSnapshot,
} from "./snapshot";

export type ImageTaskRepositoryErrorCode = "not_found" | "invalid_state";

export class ImageTaskRepositoryError extends Error {
  constructor(
    readonly code: ImageTaskRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageTaskRepositoryError";
  }
}

export interface ImageTaskRepository {
  createRunningHistory(snapshot: ImageTaskSnapshot): Promise<ImageTaskHistory>;
  markCompleted(id: string, completedAt?: string): Promise<ImageTaskHistory>;
  markFailed(
    id: string,
    errorSummary: ImageTaskFailureSummary,
    completedAt?: string,
  ): Promise<ImageTaskHistory>;
  markRunningHistoriesUnknown(updatedAt?: string): Promise<number>;
  getHistory(id: string): Promise<ImageTaskHistory | null>;
  listHistories(): Promise<ImageTaskHistory[]>;
  insertImageResult(input: InsertImageResultInput): Promise<ImageResult>;
  getImageResult(id: string): Promise<ImageResult | null>;
  listImageResults(): Promise<ImageResult[]>;
  listImageResultsForTaskHistory(taskHistoryId: string): Promise<ImageResult[]>;
}

export interface InsertImageResultInput {
  id?: string;
  taskHistoryId: string | null;
  filePath: string;
  format: ImageResult["format"];
  width?: number | null;
  height?: number | null;
  createdAt?: string;
}

export interface ImageTaskStore {
  withTransaction<T>(task: () => Promise<T>): Promise<T>;
  insertHistory(history: ImageTaskHistory): Promise<void>;
  updateHistory(history: ImageTaskHistory): Promise<void>;
  getHistory(id: string): Promise<ImageTaskHistory | null>;
  listHistories(): Promise<ImageTaskHistory[]>;
  insertImageResult(result: ImageResult): Promise<void>;
  getImageResult(id: string): Promise<ImageResult | null>;
  listImageResults(): Promise<ImageResult[]>;
  listImageResultsForTaskHistory(taskHistoryId: string): Promise<ImageResult[]>;
  markRunningHistoriesUnknown(updatedAt: string): Promise<number>;
}

interface CreateImageTaskRepositoryOptions {
  store: ImageTaskStore;
  now?: () => string;
  generateId?: IdGenerator;
}

interface CreateSqliteImageTaskRepositoryOptions {
  db: ApplicationDatabase;
  now?: () => string;
  generateId?: IdGenerator;
}

export function createImageTaskRepository({
  store,
  now = createUtcTimestamp,
  generateId = createRandomId,
}: CreateImageTaskRepositoryOptions): ImageTaskRepository {
  return {
    async createRunningHistory(snapshot) {
      const timestamp = now();
      const history: ImageTaskHistory = {
        id: generateId(),
        taskType: "generate",
        status: "running",
        snapshot,
        errorSummary: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      };
      await store.insertHistory(history);
      return history;
    },

    async markCompleted(id, completedAt = now()) {
      return store.withTransaction(async () => {
        const existing = await requireRunningHistory(store, id);
        const next: ImageTaskHistory = {
          ...existing,
          status: "completed",
          errorSummary: null,
          updatedAt: completedAt,
          completedAt,
        };
        await store.updateHistory(next);
        return next;
      });
    },

    async markFailed(id, errorSummary, completedAt = now()) {
      return store.withTransaction(async () => {
        const existing = await requireRunningHistory(store, id);
        const next: ImageTaskHistory = {
          ...existing,
          status: "failed",
          errorSummary,
          updatedAt: completedAt,
          completedAt,
        };
        await store.updateHistory(next);
        return next;
      });
    },

    async markRunningHistoriesUnknown(updatedAt = now()) {
      return store.markRunningHistoriesUnknown(updatedAt);
    },

    async getHistory(id) {
      return store.getHistory(id);
    },

    async listHistories() {
      return store.listHistories();
    },

    async insertImageResult(input) {
      const result: ImageResult = {
        id: input.id ?? generateId(),
        taskHistoryId: input.taskHistoryId,
        filePath: input.filePath,
        format: input.format,
        width: input.width ?? null,
        height: input.height ?? null,
        createdAt: input.createdAt ?? now(),
      };
      await store.insertImageResult(result);
      return result;
    },

    async getImageResult(id) {
      return store.getImageResult(id);
    },

    async listImageResults() {
      return store.listImageResults();
    },

    async listImageResultsForTaskHistory(taskHistoryId) {
      return store.listImageResultsForTaskHistory(taskHistoryId);
    },
  };
}

export function createSqliteImageTaskRepository({
  db,
  now,
  generateId,
}: CreateSqliteImageTaskRepositoryOptions): ImageTaskRepository {
  return createImageTaskRepository({
    store: createSqliteImageTaskStore(db),
    now,
    generateId,
  });
}

export function createMemoryImageTaskStore(): ImageTaskStore {
  let histories = new Map<string, ImageTaskHistory>();
  let imageResults = new Map<string, ImageResult>();

  return {
    async withTransaction(task) {
      const historySnapshot = cloneMap(histories, cloneHistory);
      const imageResultSnapshot = cloneMap(imageResults, cloneImageResult);
      try {
        return await task();
      } catch (error) {
        histories = historySnapshot;
        imageResults = imageResultSnapshot;
        throw error;
      }
    },

    async insertHistory(history) {
      histories.set(history.id, cloneHistory(history));
    },

    async updateHistory(history) {
      histories.set(history.id, cloneHistory(history));
    },

    async getHistory(id) {
      const history = histories.get(id);
      return history ? cloneHistory(history) : null;
    },

    async listHistories() {
      return [...histories.values()]
        .map(cloneHistory)
        .sort(compareCreatedAtDescending);
    },

    async insertImageResult(result) {
      imageResults.set(result.id, cloneImageResult(result));
    },

    async getImageResult(id) {
      const result = imageResults.get(id);
      return result ? cloneImageResult(result) : null;
    },

    async listImageResults() {
      return [...imageResults.values()]
        .map(cloneImageResult)
        .sort(compareCreatedAtDescending);
    },

    async listImageResultsForTaskHistory(taskHistoryId) {
      return [...imageResults.values()]
        .filter((result) => result.taskHistoryId === taskHistoryId)
        .map(cloneImageResult)
        .sort(compareCreatedAtAscending);
    },

    async markRunningHistoriesUnknown(updatedAt) {
      let count = 0;
      for (const history of histories.values()) {
        if (history.status === "running") {
          histories.set(history.id, {
            ...history,
            status: "unknown",
            updatedAt,
          });
          count += 1;
        }
      }
      return count;
    },
  };
}

export function createSqliteImageTaskStore(
  db: ApplicationDatabase,
): ImageTaskStore {
  return {
    async withTransaction(task) {
      let result: Awaited<ReturnType<typeof task>> | undefined;
      await db.withTransactionAsync(async () => {
        result = await task();
      });
      return result as Awaited<ReturnType<typeof task>>;
    },

    async insertHistory(history) {
      await db.runAsync(
        `
          INSERT INTO image_task_histories (
            id,
            task_type,
            status,
            snapshot_json,
            error_summary_json,
            created_at,
            updated_at,
            completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        history.id,
        history.taskType,
        history.status,
        serializeImageTaskSnapshot(history.snapshot),
        history.errorSummary ? JSON.stringify(history.errorSummary) : null,
        history.createdAt,
        history.updatedAt,
        history.completedAt,
      );
    },

    async updateHistory(history) {
      await db.runAsync(
        `
          UPDATE image_task_histories
          SET
            task_type = ?,
            status = ?,
            snapshot_json = ?,
            error_summary_json = ?,
            updated_at = ?,
            completed_at = ?
          WHERE id = ?
        `,
        history.taskType,
        history.status,
        serializeImageTaskSnapshot(history.snapshot),
        history.errorSummary ? JSON.stringify(history.errorSummary) : null,
        history.updatedAt,
        history.completedAt,
        history.id,
      );
    },

    async getHistory(id) {
      const row = await db.getFirstAsync<ImageTaskHistoryRow>(
        `
          SELECT *
          FROM image_task_histories
          WHERE id = ?
        `,
        id,
      );
      return row ? mapHistoryRow(row) : null;
    },

    async listHistories() {
      const rows = await db.getAllAsync<ImageTaskHistoryRow>(`
        SELECT *
        FROM image_task_histories
        ORDER BY created_at DESC
      `);
      return rows.map(mapHistoryRow);
    },

    async insertImageResult(result) {
      await db.runAsync(
        `
          INSERT INTO image_results (
            id,
            task_history_id,
            file_path,
            format,
            width,
            height,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        result.id,
        result.taskHistoryId,
        result.filePath,
        result.format,
        result.width,
        result.height,
        result.createdAt,
      );
    },

    async getImageResult(id) {
      const row = await db.getFirstAsync<ImageResultRow>(
        `
          SELECT *
          FROM image_results
          WHERE id = ?
        `,
        id,
      );
      return row ? mapImageResultRow(row) : null;
    },

    async listImageResults() {
      const rows = await db.getAllAsync<ImageResultRow>(`
        SELECT *
        FROM image_results
        ORDER BY created_at DESC
      `);
      return rows.map(mapImageResultRow);
    },

    async listImageResultsForTaskHistory(taskHistoryId) {
      const rows = await db.getAllAsync<ImageResultRow>(
        `
          SELECT *
          FROM image_results
          WHERE task_history_id = ?
          ORDER BY created_at ASC
        `,
        taskHistoryId,
      );
      return rows.map(mapImageResultRow);
    },

    async markRunningHistoriesUnknown(updatedAt) {
      let count = 0;
      await db.withTransactionAsync(async () => {
        const runningRows = await db.getAllAsync<{ id: string }>(`
          SELECT id
          FROM image_task_histories
          WHERE status = 'running'
        `);
        await db.runAsync(
          `
            UPDATE image_task_histories
            SET status = 'unknown',
                updated_at = ?
            WHERE status = 'running'
          `,
          updatedAt,
        );
        count = runningRows.length;
      });
      return count;
    },
  };
}

async function requireHistory(
  store: ImageTaskStore,
  id: string,
): Promise<ImageTaskHistory> {
  const history = await store.getHistory(id);
  if (!history) {
    throw new ImageTaskRepositoryError("not_found", "图片任务历史不存在。");
  }
  return history;
}

async function requireRunningHistory(
  store: ImageTaskStore,
  id: string,
): Promise<ImageTaskHistory> {
  const history = await requireHistory(store, id);
  if (history.status !== "running") {
    throw new ImageTaskRepositoryError(
      "invalid_state",
      `无法将状态为 ${history.status} 的任务历史转换为完成或失败。`,
    );
  }
  return history;
}

function mapHistoryRow(row: ImageTaskHistoryRow): ImageTaskHistory {
  return {
    id: row.id,
    taskType: row.task_type,
    status: row.status,
    snapshot: parseImageTaskSnapshotJson(row.snapshot_json),
    errorSummary: row.error_summary_json
      ? parseJsonField<ImageTaskFailureSummary>(
          row.error_summary_json,
          "error_summary_json",
        )
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapImageResultRow(row: ImageResultRow): ImageResult {
  return {
    id: row.id,
    taskHistoryId: row.task_history_id,
    filePath: row.file_path,
    format: row.format,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  };
}

function parseJsonField<T>(value: string, fieldName: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`${fieldName} 不是有效 JSON。`, { cause: error });
  }
}

function cloneMap<T>(
  values: Map<string, T>,
  clone: (value: T) => T,
): Map<string, T> {
  return new Map([...values.entries()].map(([key, value]) => [key, clone(value)]));
}

function cloneHistory(history: ImageTaskHistory): ImageTaskHistory {
  return {
    ...history,
    snapshot: cloneImageTaskSnapshot(history.snapshot),
    errorSummary: history.errorSummary ? { ...history.errorSummary } : null,
  };
}

function cloneImageResult(result: ImageResult): ImageResult {
  return { ...result };
}

function compareCreatedAtDescending(
  left: { createdAt: string },
  right: { createdAt: string },
): number {
  return right.createdAt.localeCompare(left.createdAt);
}

function compareCreatedAtAscending(
  left: { createdAt: string },
  right: { createdAt: string },
): number {
  return left.createdAt.localeCompare(right.createdAt);
}

interface ImageTaskHistoryRow {
  id: string;
  task_type: ImageTaskType;
  status: ImageTaskStatus;
  snapshot_json: string;
  error_summary_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ImageResultRow {
  id: string;
  task_history_id: string | null;
  file_path: string;
  format: ImageResult["format"];
  width: number | null;
  height: number | null;
  created_at: string;
}
