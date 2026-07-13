import {
  APP_SETTINGS_ID,
  type ApplicationDatabase,
  type IdGenerator,
  type ModelConfigurationCredentialAdapter,
  createRandomId,
  createUtcTimestamp,
} from "../storage";
import {
  APPLICATION_DEFAULT_IMAGE_SPEC,
  type ApplicationDefaultImageSpec,
  parseApplicationDefaultImageSpec,
} from "../image-tasks/default-spec";
import type {
  AppSettings,
  ModelConfiguration,
  ModelConfigurationType,
  SaveModelConfigurationInput,
} from "./types";
import {
  ModelConfigurationValidationError,
  assertValidModelConfigurationInput,
  normalizeModelConfigurationInput,
} from "./validation";

export type ModelConfigurationRepositoryErrorCode =
  | "not_found"
  | "not_ready"
  | "type_mismatch"
  | "validation_failed";

export class ModelConfigurationRepositoryError extends Error {
  constructor(
    readonly code: ModelConfigurationRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelConfigurationRepositoryError";
  }
}

export interface ModelConfigurationRepository {
  list(type?: ModelConfigurationType): Promise<ModelConfiguration[]>;
  get(id: string): Promise<ModelConfiguration | null>;
  getCredential(id: string): Promise<string | null>;
  save(input: SaveModelConfigurationInput): Promise<ModelConfiguration>;
  delete(id: string): Promise<void>;
  markReady(id: string, succeededAt?: string): Promise<ModelConfiguration>;
  getSettings(): Promise<AppSettings>;
  setDefault(type: ModelConfigurationType, id: string): Promise<AppSettings>;
  clearDefault(type: ModelConfigurationType): Promise<AppSettings>;
  completeFirstRunSetup(completedAt?: string): Promise<AppSettings>;
  updateDefaultImageSpec(
    spec: ApplicationDefaultImageSpec,
  ): Promise<AppSettings>;
}

export interface ModelConfigurationStore {
  withTransaction<T>(task: () => Promise<T>): Promise<T>;
  listConfigurations(): Promise<ModelConfiguration[]>;
  getConfiguration(id: string): Promise<ModelConfiguration | null>;
  insertConfiguration(configuration: ModelConfiguration): Promise<void>;
  updateConfiguration(configuration: ModelConfiguration): Promise<void>;
  deleteConfiguration(id: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<void>;
}

interface CreateModelConfigurationRepositoryOptions {
  store: ModelConfigurationStore;
  credentials: ModelConfigurationCredentialAdapter;
  now?: () => string;
  generateId?: IdGenerator;
}

interface CreateSqliteModelConfigurationRepositoryOptions {
  db: ApplicationDatabase;
  credentials: ModelConfigurationCredentialAdapter;
  now?: () => string;
  generateId?: IdGenerator;
}

interface CreateMemoryModelConfigurationStoreOptions {
  now?: () => string;
}

export function createModelConfigurationRepository({
  store,
  credentials,
  now = createUtcTimestamp,
  generateId = createRandomId,
}: CreateModelConfigurationRepositoryOptions): ModelConfigurationRepository {
  async function clearDefaultReferencesForConfiguration(
    configuration: ModelConfiguration,
    updatedAt: string,
  ): Promise<void> {
    const settings = await store.getSettings();
    const nextSettings = clearDefaultReference(settings, configuration, updatedAt);
    if (nextSettings !== settings) {
      await store.updateSettings(nextSettings);
    }
  }

  return {
    async list(type) {
      const configurations = await store.listConfigurations();
      return type
        ? configurations.filter((configuration) => configuration.type === type)
        : configurations;
    },

    async get(id) {
      return store.getConfiguration(id);
    },

    async getCredential(id) {
      return credentials.get(id);
    },

    async save(input) {
      try {
        assertValidModelConfigurationInput(input);
      } catch (error) {
        if (error instanceof ModelConfigurationValidationError) {
          throw new ModelConfigurationRepositoryError(
            "validation_failed",
            "模型配置校验失败。",
          );
        }
        throw error;
      }

      const normalized = normalizeModelConfigurationInput(input);
      const id = normalized.id ?? generateId();
      const apiKey = normalized.apiKey?.trim();
      const shouldReplaceCredential = typeof apiKey === "string" && apiKey.length > 0;
      const credentialAction =
        normalized.clearCredential === true
          ? "clear"
          : shouldReplaceCredential
            ? "replace"
            : "retain";

      if (credentialAction === "replace" && shouldReplaceCredential) {
        await credentials.save(id, apiKey);
      } else if (credentialAction === "clear") {
        await credentials.delete(id);
      }

      return store.withTransaction(async () => {
        const existing = await store.getConfiguration(id);

        const timestamp = now();
        const behaviorChanged =
          existing !== null &&
          (existing.type !== normalized.type ||
            existing.baseUrl !== normalized.baseUrl ||
            existing.modelName !== normalized.modelName);
        const credentialChanged = credentialAction !== "retain";
        const clearReadiness = behaviorChanged || credentialChanged;
        const hasCredential =
          credentialAction === "replace"
            ? true
            : credentialAction === "clear"
              ? false
              : existing?.hasCredential ?? false;

        const next: ModelConfiguration = {
          id,
          type: normalized.type,
          baseUrl: normalized.baseUrl,
          modelName: normalized.modelName,
          hasCredential,
          isReady: existing ? (clearReadiness ? false : existing.isReady) : false,
          lastTestSucceededAt: existing
            ? clearReadiness
              ? null
              : existing.lastTestSucceededAt
            : null,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };

        if (existing) {
          await store.updateConfiguration(next);
        } else {
          await store.insertConfiguration(next);
        }

        if (existing && clearReadiness) {
          await clearDefaultReferencesForConfiguration(existing, timestamp);
          if (existing.type !== next.type) {
            await clearDefaultReferencesForConfiguration(next, timestamp);
          }
        }

        return next;
      });
    },

    async delete(id) {
      const existing = await store.getConfiguration(id);
      if (!existing) {
        throw new ModelConfigurationRepositoryError("not_found", "模型配置不存在。");
      }

      await credentials.delete(id);
      await store.withTransaction(async () => {
        const timestamp = now();
        await clearDefaultReferencesForConfiguration(existing, timestamp);
        await store.deleteConfiguration(id);
      });
    },

    async markReady(id, succeededAt = now()) {
      return store.withTransaction(async () => {
        const existing = await store.getConfiguration(id);
        if (!existing) {
          throw new ModelConfigurationRepositoryError("not_found", "模型配置不存在。");
        }
        if (!existing.hasCredential) {
          throw new ModelConfigurationRepositoryError(
            "not_ready",
            "缺少凭据，不能标记为就绪。",
          );
        }

        const next: ModelConfiguration = {
          ...existing,
          isReady: true,
          lastTestSucceededAt: succeededAt,
          updatedAt: succeededAt,
        };
        await store.updateConfiguration(next);
        return next;
      });
    },

    async getSettings() {
      return store.getSettings();
    },

    async setDefault(type, id) {
      return store.withTransaction(async () => {
        const configuration = await store.getConfiguration(id);
        if (!configuration) {
          throw new ModelConfigurationRepositoryError("not_found", "模型配置不存在。");
        }
        if (configuration.type !== type) {
          throw new ModelConfigurationRepositoryError(
            "type_mismatch",
            "默认配置类型不匹配。",
          );
        }
        if (!configuration.isReady) {
          throw new ModelConfigurationRepositoryError(
            "not_ready",
            "只能将就绪配置设为默认。",
          );
        }

        const settings = await store.getSettings();
        const updatedAt = now();
        const nextSettings: AppSettings =
          type === "image"
            ? {
                ...settings,
                defaultImageModelConfigurationId: id,
                updatedAt,
              }
            : {
                ...settings,
                defaultTextModelConfigurationId: id,
                updatedAt,
              };
        await store.updateSettings(nextSettings);
        return nextSettings;
      });
    },

    async clearDefault(type) {
      return store.withTransaction(async () => {
        const settings = await store.getSettings();
        const updatedAt = now();
        const nextSettings: AppSettings =
          type === "image"
            ? {
                ...settings,
                defaultImageModelConfigurationId: null,
                updatedAt,
              }
            : {
                ...settings,
                defaultTextModelConfigurationId: null,
                updatedAt,
              };
        await store.updateSettings(nextSettings);
        return nextSettings;
      });
    },

    async completeFirstRunSetup(completedAt = now()) {
      return store.withTransaction(async () => {
        const settings = await store.getSettings();
        const nextSettings: AppSettings = {
          ...settings,
          firstRunSetupCompletedAt: completedAt,
          updatedAt: completedAt,
        };
        await store.updateSettings(nextSettings);
        return nextSettings;
      });
    },

    async updateDefaultImageSpec(spec) {
      return store.withTransaction(async () => {
        const settings = await store.getSettings();
        const nextSettings: AppSettings = {
          ...settings,
          defaultImageSpec: spec,
          updatedAt: now(),
        };
        await store.updateSettings(nextSettings);
        return nextSettings;
      });
    },
  };
}

export function createSqliteModelConfigurationRepository(
  options: CreateSqliteModelConfigurationRepositoryOptions,
): ModelConfigurationRepository {
  return createModelConfigurationRepository({
    store: createSqliteModelConfigurationStore(options.db),
    credentials: options.credentials,
    now: options.now,
    generateId: options.generateId,
  });
}

export function createMemoryModelConfigurationStore(
  options: CreateMemoryModelConfigurationStoreOptions = {},
): ModelConfigurationStore {
  const now = options.now ?? createUtcTimestamp;
  const initializedAt = now();
  let configurations = new Map<string, ModelConfiguration>();
  let settings: AppSettings = {
    defaultImageModelConfigurationId: null,
    defaultTextModelConfigurationId: null,
    firstRunSetupCompletedAt: null,
    defaultImageSpec: APPLICATION_DEFAULT_IMAGE_SPEC,
    createdAt: initializedAt,
    updatedAt: initializedAt,
  };

  return {
    async withTransaction(task) {
      const configurationSnapshot = new Map(configurations);
      const settingsSnapshot = { ...settings };
      try {
        return await task();
      } catch (error) {
        configurations = configurationSnapshot;
        settings = settingsSnapshot;
        throw error;
      }
    },

    async listConfigurations() {
      return [...configurations.values()].sort((left, right) => {
        const typeOrder = left.type.localeCompare(right.type);
        return typeOrder === 0 ? left.createdAt.localeCompare(right.createdAt) : typeOrder;
      });
    },

    async getConfiguration(id) {
      return configurations.get(id) ?? null;
    },

    async insertConfiguration(configuration) {
      configurations.set(configuration.id, configuration);
    },

    async updateConfiguration(configuration) {
      configurations.set(configuration.id, configuration);
    },

    async deleteConfiguration(id) {
      configurations.delete(id);
    },

    async getSettings() {
      return settings;
    },

    async updateSettings(nextSettings) {
      settings = nextSettings;
    },
  };
}

export function createSqliteModelConfigurationStore(
  db: ApplicationDatabase,
): ModelConfigurationStore {
  return {
    async withTransaction(task) {
      let result: Awaited<ReturnType<typeof task>> | undefined;
      await db.withTransactionAsync(async () => {
        result = await task();
      });
      return result as Awaited<ReturnType<typeof task>>;
    },

    async listConfigurations() {
      const rows = await db.getAllAsync<ModelConfigurationRow>(
        `
          SELECT *
          FROM model_configurations
          ORDER BY type ASC, created_at ASC
        `,
      );
      return rows.map(mapConfigurationRow);
    },

    async getConfiguration(id) {
      const row = await db.getFirstAsync<ModelConfigurationRow>(
        `
          SELECT *
          FROM model_configurations
          WHERE id = ?
        `,
        id,
      );
      return row ? mapConfigurationRow(row) : null;
    },

    async insertConfiguration(configuration) {
      await db.runAsync(
        `
          INSERT INTO model_configurations (
            id,
            type,
            base_url,
            model_name,
            has_credential,
            is_ready,
            last_test_succeeded_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        configuration.id,
        configuration.type,
        configuration.baseUrl,
        configuration.modelName,
        boolToInteger(configuration.hasCredential),
        boolToInteger(configuration.isReady),
        configuration.lastTestSucceededAt,
        configuration.createdAt,
        configuration.updatedAt,
      );
    },

    async updateConfiguration(configuration) {
      await db.runAsync(
        `
          UPDATE model_configurations
          SET
            type = ?,
            base_url = ?,
            model_name = ?,
            has_credential = ?,
            is_ready = ?,
            last_test_succeeded_at = ?,
            updated_at = ?
          WHERE id = ?
        `,
        configuration.type,
        configuration.baseUrl,
        configuration.modelName,
        boolToInteger(configuration.hasCredential),
        boolToInteger(configuration.isReady),
        configuration.lastTestSucceededAt,
        configuration.updatedAt,
        configuration.id,
      );
    },

    async deleteConfiguration(id) {
      await db.runAsync(
        `
          DELETE FROM model_configurations
          WHERE id = ?
        `,
        id,
      );
    },

    async getSettings() {
      const row = await db.getFirstAsync<AppSettingsRow>(
        `
          SELECT *
          FROM app_settings
          WHERE id = ?
        `,
        APP_SETTINGS_ID,
      );
      if (!row) {
        throw new Error("app_settings 未初始化。");
      }
      return mapSettingsRow(row);
    },

    async updateSettings(settings) {
      await db.runAsync(
        `
          UPDATE app_settings
          SET
            default_image_model_configuration_id = ?,
            default_text_model_configuration_id = ?,
            first_run_setup_completed_at = ?,
            default_image_size = ?,
            default_image_quality = ?,
            default_image_format = ?,
            default_image_count = ?,
            updated_at = ?
          WHERE id = ?
        `,
        settings.defaultImageModelConfigurationId,
        settings.defaultTextModelConfigurationId,
        settings.firstRunSetupCompletedAt,
        settings.defaultImageSpec.size,
        settings.defaultImageSpec.quality,
        settings.defaultImageSpec.format,
        settings.defaultImageSpec.count,
        settings.updatedAt,
        APP_SETTINGS_ID,
      );
    },
  };
}

function clearDefaultReference(
  settings: AppSettings,
  configuration: Pick<ModelConfiguration, "id" | "type">,
  updatedAt: string,
): AppSettings {
  if (
    configuration.type === "image" &&
    settings.defaultImageModelConfigurationId === configuration.id
  ) {
    return {
      ...settings,
      defaultImageModelConfigurationId: null,
      updatedAt,
    };
  }
  if (
    configuration.type === "text" &&
    settings.defaultTextModelConfigurationId === configuration.id
  ) {
    return {
      ...settings,
      defaultTextModelConfigurationId: null,
      updatedAt,
    };
  }
  return settings;
}

interface ModelConfigurationRow {
  id: string;
  type: ModelConfigurationType;
  base_url: string;
  model_name: string;
  has_credential: number;
  is_ready: number;
  last_test_succeeded_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AppSettingsRow {
  default_image_model_configuration_id: string | null;
  default_text_model_configuration_id: string | null;
  first_run_setup_completed_at: string | null;
  default_image_size: unknown;
  default_image_quality: unknown;
  default_image_format: unknown;
  default_image_count: unknown;
  created_at: string;
  updated_at: string;
}

function mapConfigurationRow(row: ModelConfigurationRow): ModelConfiguration {
  return {
    id: row.id,
    type: row.type,
    baseUrl: row.base_url,
    modelName: row.model_name,
    hasCredential: row.has_credential === 1,
    isReady: row.is_ready === 1,
    lastTestSucceededAt: row.last_test_succeeded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSettingsRow(row: AppSettingsRow): AppSettings {
  return {
    defaultImageModelConfigurationId: row.default_image_model_configuration_id,
    defaultTextModelConfigurationId: row.default_text_model_configuration_id,
    firstRunSetupCompletedAt: row.first_run_setup_completed_at,
    defaultImageSpec: parseApplicationDefaultImageSpec({
      size: row.default_image_size,
      quality: row.default_image_quality,
      format: row.default_image_format,
      count: row.default_image_count,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function boolToInteger(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}
