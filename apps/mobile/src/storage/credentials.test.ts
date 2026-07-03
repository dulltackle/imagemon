import { describe, expect, it } from "vitest";

import {
  createModelConfigurationCredentialAdapter,
  deriveModelConfigurationCredentialKey,
  type SecureCredentialStorage,
} from "./credentials";

class MemorySecureCredentialStorage implements SecureCredentialStorage {
  readonly values = new Map<string, string>();

  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe("model configuration credential adapter", () => {
  it("按配置 ID 派生 SecureStore key", () => {
    expect(deriveModelConfigurationCredentialKey("config-1")).toBe(
      "imagemon.model-configuration-api-key.config-1",
    );
  });

  it("保存、读取、替换并删除 API Key", async () => {
    const storage = new MemorySecureCredentialStorage();
    const adapter = createModelConfigurationCredentialAdapter(storage);

    await adapter.save("config-1", "sk-old");
    expect(await adapter.get("config-1")).toBe("sk-old");

    await adapter.save("config-1", "sk-new");
    expect(await adapter.get("config-1")).toBe("sk-new");

    await adapter.delete("config-1");
    expect(await adapter.get("config-1")).toBeNull();
  });
});
