import type { ImageModel, ImageSpec } from "./image.js";
import { validateImageSpecForModel } from "./image.js";
import type { PromptdexTaskType, PromptdexTemplate, PromptdexTemplateInput } from "./promptdex.js";
import { renderPromptdexTemplate } from "./promptdex.js";

export type PromptdexEntrySourceType = "built-in" | "personal";

export interface PromptdexEntryDisplayInfo {
  title: string;
  purpose: string;
  category: string;
  searchTags: readonly string[];
  taskType: PromptdexTaskType;
}

export interface PromptdexEntrySnapshot {
  name: string;
  description: string;
  version?: string | boolean;
  sourceType: PromptdexEntrySourceType;
  inputs: Record<string, PromptdexTemplateInput>;
  body: string;
  taskType: PromptdexTaskType;
  displayInfo: PromptdexEntryDisplayInfo;
}

export interface ModelConfigurationSnapshot {
  name: string;
  baseURL: string;
  model: ImageModel;
  parameters?: Record<string, unknown>;
}

export interface ImageTaskSnapshot {
  capturedAt: string;
  entry: PromptdexEntrySnapshot;
  taskInputs: Record<string, string>;
  imageSpec: ImageSpec;
  modelConfiguration: ModelConfigurationSnapshot;
  taskType: PromptdexTaskType;
  fullPrompt: string;
}

export interface BuildImageTaskSnapshotInput {
  entry: PromptdexTemplate;
  sourceType: PromptdexEntrySourceType;
  displayInfo: PromptdexEntryDisplayInfo;
  taskInputs: Record<string, unknown>;
  imageSpec: ImageSpec;
  modelConfiguration: ModelConfigurationSnapshot;
  capturedAt?: Date | string;
}

export function buildImageTaskSnapshot(input: BuildImageTaskSnapshotInput): ImageTaskSnapshot {
  const rendered = renderPromptdexTemplate(input.entry, input.taskInputs);
  validateImageSpecForModel(input.imageSpec, rendered.taskType, input.modelConfiguration.model);

  return {
    capturedAt: normalizeTimestamp(input.capturedAt ?? new Date()),
    entry: {
      name: input.entry.name,
      description: input.entry.description,
      ...(Object.hasOwn(input.entry, "version") ? { version: input.entry.version } : {}),
      sourceType: input.sourceType,
      inputs: copyInputs(input.entry.inputs),
      body: input.entry.body,
      taskType: input.entry.taskType,
      displayInfo: {
        title: input.displayInfo.title,
        purpose: input.displayInfo.purpose,
        category: input.displayInfo.category,
        searchTags: [...input.displayInfo.searchTags],
        taskType: input.displayInfo.taskType,
      },
    },
    taskInputs: copyDeclaredTaskInputs(input.entry, input.taskInputs),
    imageSpec: { ...input.imageSpec },
    modelConfiguration: sanitizeModelConfigurationSnapshot(input.modelConfiguration),
    taskType: rendered.taskType,
    fullPrompt: rendered.prompt,
  };
}

function copyInputs(inputs: Record<string, PromptdexTemplateInput>): Record<string, PromptdexTemplateInput> {
  return Object.fromEntries(
    Object.entries(inputs).map(([name, input]) => [
      name,
      {
        required: input.required,
        description: input.description,
      },
    ]),
  );
}

function copyDeclaredTaskInputs(
  entry: PromptdexTemplate,
  taskInputs: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of Object.keys(entry.inputs)) {
    if (!Object.hasOwn(taskInputs, name)) {
      continue;
    }

    const value = taskInputs[name];
    if (typeof value !== "string") {
      throw new Error(`输入 "${name}" 必须是字符串`);
    }
    result[name] = value;
  }
  return result;
}

function sanitizeModelConfigurationSnapshot(snapshot: ModelConfigurationSnapshot): ModelConfigurationSnapshot {
  return {
    name: snapshot.name,
    baseURL: snapshot.baseURL,
    model: snapshot.model,
    ...(snapshot.parameters ? { parameters: sanitizeParameters(snapshot.parameters) } : {}),
  };
}

function sanitizeParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (!isSensitiveKey(key)) {
      result[key] = value;
    }
  }
  return result;
}

function isSensitiveKey(key: string): boolean {
  return /(?:api[-_]?key|authorization|credential|password|secret|token)/i.test(key);
}

function normalizeTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("capturedAt must be a valid date");
  }
  return parsed.toISOString();
}
