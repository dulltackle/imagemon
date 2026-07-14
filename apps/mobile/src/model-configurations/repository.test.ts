import { beforeEach, describe, expect, it } from "vitest";

import { APPLICATION_DEFAULT_IMAGE_SPEC } from "../image-tasks/default-spec";
import type {
  ApplicationDatabase,
  ModelConfigurationCredentialAdapter,
} from "../storage";
import {
  ModelConfigurationRepositoryError,
  type ModelConfigurationStore,
  createModelConfigurationRepository,
  createSqliteModelConfigurationStore,
} from "./repository";
import type { AppSettings, ModelConfiguration } from "./types";

class MemoryCredentialAdapter implements ModelConfigurationCredentialAdapter {
  readonly values = new Map<string, string>();
  readonly deletedIds: string[] = [];

  async get(configurationId: string): Promise<string | null> {
    return this.values.get(configurationId) ?? null;
  }

  async save(configurationId: string, apiKey: string): Promise<void> {
    this.values.set(configurationId, apiKey);
  }

  async delete(configurationId: string): Promise<void> {
    this.deletedIds.push(configurationId);
    this.values.delete(configurationId);
  }
}

class MemoryModelConfigurationStore implements ModelConfigurationStore {
  configurations = new Map<string, ModelConfiguration>();
  settings: AppSettings = {
    defaultImageModelConfigurationId: null,
    defaultTextModelConfigurationId: null,
    firstRunSetupCompletedAt: null,
    defaultImageSpec: APPLICATION_DEFAULT_IMAGE_SPEC,
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z",
  };

  async withTransaction<T>(task: () => Promise<T>): Promise<T> {
    const configurationSnapshot = new Map(this.configurations);
    const settingsSnapshot = { ...this.settings };
    try {
      return await task();
    } catch (error) {
      this.configurations = configurationSnapshot;
      this.settings = settingsSnapshot;
      throw error;
    }
  }

  async listConfigurations(): Promise<ModelConfiguration[]> {
    return [...this.configurations.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getConfiguration(id: string): Promise<ModelConfiguration | null> {
    return this.configurations.get(id) ?? null;
  }

  async insertConfiguration(configuration: ModelConfiguration): Promise<void> {
    this.configurations.set(configuration.id, configuration);
  }

  async updateConfiguration(configuration: ModelConfiguration): Promise<void> {
    this.configurations.set(configuration.id, configuration);
  }

  async deleteConfiguration(id: string): Promise<void> {
    this.configurations.delete(id);
  }

  async getSettings(): Promise<AppSettings> {
    return this.settings;
  }

  async updateSettings(settings: AppSettings): Promise<void> {
    this.settings = settings;
  }
}

function validImageInput() {
  return {
    type: "image" as const,
    baseUrl: "https://api.openai.com/v1/",
    modelName: "gpt-image-2",
  };
}

describe("ModelConfigurationRepository", () => {
  let store: MemoryModelConfigurationStore;
  let credentials: MemoryCredentialAdapter;
  let idCounter: number;
  let timeCounter: number;

  beforeEach(() => {
    store = new MemoryModelConfigurationStore();
    credentials = new MemoryCredentialAdapter();
    idCounter = 0;
    timeCounter = 0;
  });

  function repository() {
    return createModelConfigurationRepository({
      store,
      credentials,
      generateId: () => `config-${++idCounter}`,
      now: () => `2026-06-25T00:00:0${++timeCounter}.000Z`,
    });
  }

  it("保存未就绪草稿时不要求 API Key", async () => {
    const repo = repository();

    const configuration = await repo.save(validImageInput());

    expect(configuration).toMatchObject({
      id: "config-1",
      baseUrl: "https://api.openai.com/v1",
      hasCredential: false,
      isReady: false,
      lastTestSucceededAt: null,
    });
    expect(await repo.list("image")).toHaveLength(1);
  });

  it("保存新 API Key 时只在 SQLite 记录 hasCredential", async () => {
    const repo = repository();

    const configuration = await repo.save({
      ...validImageInput(),
      apiKey: " sk-test ",
    });

    expect(configuration.hasCredential).toBe(true);
    expect(credentials.values.get("config-1")).toBe("sk-test");
    await expect(repo.getCredential(configuration.id)).resolves.toBe("sk-test");
  });

  it("允许保存同类型相同模型信息的多条配置", async () => {
    const repo = repository();

    const first = await repo.save(validImageInput());
    const second = await repo.save(validImageInput());

    expect(first.id).toBe("config-1");
    expect(second.id).toBe("config-2");
    expect(await repo.list("image")).toHaveLength(2);
  });

  it("只有就绪且类型匹配的配置可以设为默认", async () => {
    const repo = repository();
    const configuration = await repo.save({
      ...validImageInput(),
      apiKey: "sk-test",
    });

    await expect(repo.setDefault("image", configuration.id)).rejects.toMatchObject({
      code: "not_ready",
    });

    await repo.markReady(configuration.id, "2026-06-25T01:00:00.000Z");
    await expect(repo.setDefault("text", configuration.id)).rejects.toMatchObject({
      code: "type_mismatch",
    });

    const settings = await repo.setDefault("image", configuration.id);
    expect(settings.defaultImageModelConfigurationId).toBe(configuration.id);
  });

  it("调用行为字段变化后清除就绪状态和默认引用", async () => {
    const repo = repository();
    const created = await repo.save({
      ...validImageInput(),
      apiKey: "sk-test",
    });
    await repo.markReady(created.id, "2026-06-25T01:00:00.000Z");
    await repo.setDefault("image", created.id);

    const unchanged = await repo.save({
      ...validImageInput(),
      id: created.id,
    });
    expect(unchanged.isReady).toBe(true);
    expect((await repo.getSettings()).defaultImageModelConfigurationId).toBe(created.id);

    const changed = await repo.save({
      ...validImageInput(),
      id: created.id,
      baseUrl: "https://example.com/v1",
    });
    expect(changed.isReady).toBe(false);
    expect(changed.lastTestSucceededAt).toBeNull();
    expect((await repo.getSettings()).defaultImageModelConfigurationId).toBeNull();
  });

  it("替换或清除凭据后清除就绪状态和默认引用", async () => {
    const repo = repository();
    const created = await repo.save({
      ...validImageInput(),
      apiKey: "sk-old",
    });
    await repo.markReady(created.id, "2026-06-25T01:00:00.000Z");
    await repo.setDefault("image", created.id);

    const replaced = await repo.save({
      ...validImageInput(),
      id: created.id,
      apiKey: "sk-new",
    });
    expect(replaced.isReady).toBe(false);
    expect((await repo.getSettings()).defaultImageModelConfigurationId).toBeNull();

    await repo.markReady(created.id, "2026-06-25T02:00:00.000Z");
    await repo.setDefault("image", created.id);
    const cleared = await repo.save({
      ...validImageInput(),
      id: created.id,
      clearCredential: true,
    });
    expect(cleared.hasCredential).toBe(false);
    expect(cleared.isReady).toBe(false);
    expect(credentials.deletedIds).toContain(created.id);
    expect((await repo.getSettings()).defaultImageModelConfigurationId).toBeNull();
  });

  it("删除配置时同步删除凭据并清除默认引用", async () => {
    const repo = repository();
    const created = await repo.save({
      ...validImageInput(),
      apiKey: "sk-test",
    });
    await repo.markReady(created.id, "2026-06-25T01:00:00.000Z");
    await repo.setDefault("image", created.id);

    await repo.delete(created.id);

    expect(await repo.get(created.id)).toBeNull();
    expect(credentials.deletedIds).toEqual([created.id]);
    expect((await repo.getSettings()).defaultImageModelConfigurationId).toBeNull();
  });

  it("显式记录首次设置完成时间", async () => {
    const repo = repository();

    const settings = await repo.completeFirstRunSetup("2026-06-25T03:00:00.000Z");

    expect(settings.firstRunSetupCompletedAt).toBe("2026-06-25T03:00:00.000Z");
  });

  it("校验失败时抛出仓储错误", async () => {
    const repo = repository();

    await expect(
      repo.save({
        ...validImageInput(),
        baseUrl: "ftp://example.com",
      }),
    ).rejects.toBeInstanceOf(ModelConfigurationRepositoryError);
  });

  it("默认设置携带应用默认规格", async () => {
    const repo = repository();

    const settings = await repo.getSettings();

    expect(settings.defaultImageSpec).toEqual(APPLICATION_DEFAULT_IMAGE_SPEC);
  });

  it("写入应用默认规格后可从设置读回新尺寸", async () => {
    const repo = repository();

    const updated = await repo.updateDefaultImageSpec({
      ...APPLICATION_DEFAULT_IMAGE_SPEC,
      size: "1024x1536",
    });

    expect(updated.defaultImageSpec.size).toBe("1024x1536");
    const settings = await repo.getSettings();
    expect(settings.defaultImageSpec.size).toBe("1024x1536");
  });

  it("写入应用默认规格会刷新更新时间且不影响默认模型配置", async () => {
    const repo = repository();
    const before = await repo.getSettings();

    const updated = await repo.updateDefaultImageSpec({
      ...APPLICATION_DEFAULT_IMAGE_SPEC,
      size: "1536x1024",
    });

    expect(updated.updatedAt).not.toBe(before.updatedAt);
    expect(updated.defaultImageModelConfigurationId).toBe(
      before.defaultImageModelConfigurationId,
    );
    expect(updated.defaultTextModelConfigurationId).toBe(
      before.defaultTextModelConfigurationId,
    );
  });
});

describe("createSqliteModelConfigurationStore 的应用默认规格列映射", () => {
  function storeReadingSettingsRow(row: Record<string, unknown>) {
    const db: ApplicationDatabase = {
      async execAsync() {},
      async runAsync() {
        return {};
      },
      async getFirstAsync<T>(): Promise<T | null> {
        return row as T;
      },
      async getAllAsync<T>(): Promise<T[]> {
        return [];
      },
      async withTransactionAsync(task: () => Promise<void>) {
        await task();
      },
    };
    return createSqliteModelConfigurationStore(db);
  }

  it("把四个规格列分别映射到对应维度", async () => {
    const store = storeReadingSettingsRow({
      default_image_model_configuration_id: null,
      default_text_model_configuration_id: null,
      first_run_setup_completed_at: null,
      default_image_size: "1536x1024",
      default_image_quality: "auto",
      default_image_format: "png",
      default_image_count: 1,
      created_at: "2026-06-25T00:00:00.000Z",
      updated_at: "2026-06-25T00:00:00.000Z",
    });

    const settings = await store.getSettings();

    expect(settings.defaultImageSpec).toEqual({
      size: "1536x1024",
      quality: "auto",
      format: "png",
      count: 1,
    });
  });

  it("读到不被当前版本支持的列值时回落到应用默认规格且不抛错", async () => {
    const store = storeReadingSettingsRow({
      default_image_model_configuration_id: null,
      default_text_model_configuration_id: null,
      first_run_setup_completed_at: null,
      default_image_size: "4096x4096",
      default_image_quality: "high",
      default_image_format: "webp",
      default_image_count: 4,
      created_at: "2026-06-25T00:00:00.000Z",
      updated_at: "2026-06-25T00:00:00.000Z",
    });

    const settings = await store.getSettings();

    expect(settings.defaultImageSpec).toEqual(APPLICATION_DEFAULT_IMAGE_SPEC);
  });
});
