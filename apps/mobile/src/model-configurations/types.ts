export type ModelConfigurationType = "image" | "text";

export interface ModelConfiguration {
  id: string;
  type: ModelConfigurationType;
  baseUrl: string;
  modelName: string;
  hasCredential: boolean;
  isReady: boolean;
  lastTestSucceededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  defaultImageModelConfigurationId: string | null;
  defaultTextModelConfigurationId: string | null;
  firstRunSetupCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveModelConfigurationInput {
  id?: string;
  type: ModelConfigurationType;
  baseUrl: string;
  modelName: string;
  apiKey?: string;
  clearCredential?: boolean;
}

export type ModelConfigurationValidationField = "type" | "baseUrl" | "modelName";

export type ModelConfigurationValidationCode =
  | "required"
  | "invalid_type"
  | "invalid_url"
  | "unsupported_protocol"
  | "missing_host"
  | "endpoint_path";

export interface ModelConfigurationValidationIssue {
  field: ModelConfigurationValidationField;
  code: ModelConfigurationValidationCode;
  message: string;
}

export type ModelConnectionFailureReason =
  | "missing_credential"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "timeout"
  | "invalid_response"
  | "unknown_error";

export interface ModelConnectionFailureSummary {
  reason: ModelConnectionFailureReason;
  message: string;
  occurredAt: string;
}
