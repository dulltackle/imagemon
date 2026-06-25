import { beforeEach, describe, expect, it } from "vitest";

import type { ModelConfigurationCredentialAdapter } from "../storage";
import {
  ModelConfigurationRepositoryError,
  type ModelConfigurationStore,
  createModelConfigurationRepository,
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
    name: "默认图片模型",
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
  });

  it("同类型名称必须唯一，但不同类型可以同名", async () => {
    const repo = repository();
    await repo.save(validImageInput());
    await repo.save({
      type: "text",
      name: "默认图片模型",
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.2",
    });

    await expect(repo.save(validImageInput())).rejects.toMatchObject({
      code: "duplicate_name",
    });
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

  it("调用行为字段变化后清除就绪状态和默认引用，重命名不清除", async () => {
    const repo = repository();
    const created = await repo.save({
      ...validImageInput(),
      apiKey: "sk-test",
    });
    await repo.markReady(created.id, "2026-06-25T01:00:00.000Z");
    await repo.setDefault("image", created.id);

    const renamed = await repo.save({
      ...validImageInput(),
      id: created.id,
      name: "新的名称",
    });
    expect(renamed.isReady).toBe(true);
    expect((await repo.getSettings()).defaultImageModelConfigurationId).toBe(created.id);

    const changed = await repo.save({
      ...validImageInput(),
      id: created.id,
      name: "新的名称",
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
});
