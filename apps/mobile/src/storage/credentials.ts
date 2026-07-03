export interface SecureCredentialStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface ModelConfigurationCredentialAdapter {
  get(configurationId: string): Promise<string | null>;
  save(configurationId: string, apiKey: string): Promise<void>;
  delete(configurationId: string): Promise<void>;
}

export function deriveModelConfigurationCredentialKey(configurationId: string): string {
  return `imagemon.model-configuration-api-key.${configurationId}`;
}

export function createModelConfigurationCredentialAdapter(
  storage: SecureCredentialStorage,
): ModelConfigurationCredentialAdapter {
  return {
    async get(configurationId) {
      return storage.getItemAsync(deriveModelConfigurationCredentialKey(configurationId));
    },
    async save(configurationId, apiKey) {
      await storage.setItemAsync(deriveModelConfigurationCredentialKey(configurationId), apiKey);
    },
    async delete(configurationId) {
      await storage.deleteItemAsync(deriveModelConfigurationCredentialKey(configurationId));
    },
  };
}

export function createMemoryModelConfigurationCredentialAdapter(): ModelConfigurationCredentialAdapter {
  const values = new Map<string, string>();

  return {
    async get(configurationId) {
      return values.get(configurationId) ?? null;
    },
    async save(configurationId, apiKey) {
      values.set(configurationId, apiKey);
    },
    async delete(configurationId) {
      values.delete(configurationId);
    },
  };
}

export async function createSecureStoreModelConfigurationCredentialAdapter(): Promise<ModelConfigurationCredentialAdapter> {
  const secureStore = await import("expo-secure-store");
  return createModelConfigurationCredentialAdapter(secureStore);
}
