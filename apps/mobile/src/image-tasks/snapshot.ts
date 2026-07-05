import {
  IMAGE_TASK_AVAILABLE_SIZES,
  type ImageTaskImageSpecSnapshot,
  type ImageTaskModelConfigurationSnapshot,
  type ImageTaskSnapshot,
  type PromptdexImageTaskEntrySnapshot,
  type PromptdexImageTaskSnapshot,
  type PromptdexImageTaskSnapshotInput,
} from "./types";

export function serializeImageTaskSnapshot(snapshot: ImageTaskSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseImageTaskSnapshotJson(value: string): ImageTaskSnapshot {
  try {
    return parseImageTaskSnapshot(JSON.parse(value));
  } catch (error) {
    throw new Error("snapshot_json 不是有效图片任务快照。", { cause: error });
  }
}

export function parseImageTaskSnapshot(value: unknown): ImageTaskSnapshot {
  if (!isRecord(value)) {
    throw new Error("图片任务快照必须是对象。");
  }

  const source = typeof value.source === "string" ? value.source : undefined;
  if (source === "promptdex") {
    return parsePromptdexImageTaskSnapshot(value);
  }
  if (source === "manual" || (!source && typeof value.prompt === "string")) {
    return parseManualImageTaskSnapshot(value);
  }

  throw new Error("图片任务快照 source 不受支持。");
}

export function cloneImageTaskSnapshot(
  snapshot: ImageTaskSnapshot,
): ImageTaskSnapshot {
  switch (snapshot.source) {
    case "manual":
      return {
        source: "manual",
        prompt: snapshot.prompt,
        imageSpec: cloneImageSpec(snapshot.imageSpec),
        modelConfiguration: cloneModelConfiguration(snapshot.modelConfiguration),
      };
    case "promptdex":
      return {
        source: "promptdex",
        promptdexEntry: clonePromptdexEntry(snapshot.promptdexEntry),
        taskInputs: { ...snapshot.taskInputs },
        imageSpec: cloneImageSpec(snapshot.imageSpec),
        modelConfiguration: cloneModelConfiguration(snapshot.modelConfiguration),
        fullPrompt: snapshot.fullPrompt,
      };
  }
}

function parseManualImageTaskSnapshot(
  value: Record<string, unknown>,
): ImageTaskSnapshot {
  if (typeof value.prompt !== "string") {
    throw new Error("manual 快照缺少 prompt。");
  }

  return {
    source: "manual",
    prompt: value.prompt,
    imageSpec: parseImageSpec(value.imageSpec),
    modelConfiguration: parseModelConfiguration(value.modelConfiguration),
  };
}

function parsePromptdexImageTaskSnapshot(
  value: Record<string, unknown>,
): PromptdexImageTaskSnapshot {
  if (typeof value.fullPrompt !== "string") {
    throw new Error("Promptdex 快照缺少 fullPrompt。");
  }

  return {
    source: "promptdex",
    promptdexEntry: parsePromptdexEntry(value.promptdexEntry),
    taskInputs: parseStringRecord(value.taskInputs, "taskInputs"),
    imageSpec: parseImageSpec(value.imageSpec),
    modelConfiguration: parseModelConfiguration(value.modelConfiguration),
    fullPrompt: value.fullPrompt,
  };
}

function parsePromptdexEntry(value: unknown): PromptdexImageTaskEntrySnapshot {
  if (!isRecord(value)) {
    throw new Error("Promptdex 条目快照必须是对象。");
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("Promptdex 条目快照缺少 name。");
  }
  if (typeof value.description !== "string") {
    throw new Error("Promptdex 条目快照缺少 description。");
  }
  if (value.sourceType !== "built-in" && value.sourceType !== "personal") {
    throw new Error("Promptdex 条目快照 sourceType 不受支持。");
  }
  if (value.taskType !== "generate" && value.taskType !== "edit") {
    throw new Error("Promptdex 条目快照 taskType 不受支持。");
  }
  if (typeof value.body !== "string") {
    throw new Error("Promptdex 条目快照缺少 body。");
  }

  return {
    name: value.name,
    description: value.description,
    ...(typeof value.version === "string" ||
    typeof value.version === "number" ||
    typeof value.version === "boolean"
      ? { version: value.version }
      : {}),
    sourceType: value.sourceType,
    taskType: value.taskType,
    inputs: parsePromptdexInputs(value.inputs),
    body: value.body,
  };
}

function parsePromptdexInputs(
  value: unknown,
): Record<string, PromptdexImageTaskSnapshotInput> {
  if (!isRecord(value)) {
    throw new Error("Promptdex 条目 inputs 必须是对象。");
  }

  const inputs: Record<string, PromptdexImageTaskSnapshotInput> = {};
  for (const [name, input] of Object.entries(value)) {
    if (!isRecord(input)) {
      throw new Error(`Promptdex 输入 ${name} 必须是对象。`);
    }
    if (typeof input.required !== "boolean") {
      throw new Error(`Promptdex 输入 ${name} 缺少 required。`);
    }
    if (typeof input.description !== "string") {
      throw new Error(`Promptdex 输入 ${name} 缺少 description。`);
    }
    inputs[name] = {
      required: input.required,
      description: input.description,
    };
  }
  return inputs;
}

function parseStringRecord(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`${label} 必须是对象。`);
  }

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== "string") {
      throw new Error(`${label}.${key} 必须是字符串。`);
    }
    result[key] = rawValue;
  }
  return result;
}

function parseImageSpec(value: unknown): ImageTaskImageSpecSnapshot {
  if (!isRecord(value)) {
    throw new Error("图片规格快照必须是对象。");
  }
  if (
    typeof value.size !== "string" ||
    !IMAGE_TASK_AVAILABLE_SIZES.includes(
      value.size as (typeof IMAGE_TASK_AVAILABLE_SIZES)[number],
    )
  ) {
    throw new Error("图片规格尺寸不受支持。");
  }
  if (value.quality !== "auto" || value.format !== "png" || value.n !== 1) {
    throw new Error("图片规格快照不受支持。");
  }
  return {
    size: value.size as ImageTaskImageSpecSnapshot["size"],
    quality: "auto",
    format: "png",
    n: 1,
  };
}

function parseModelConfiguration(
  value: unknown,
): ImageTaskModelConfigurationSnapshot {
  if (!isRecord(value)) {
    throw new Error("模型配置快照必须是对象。");
  }
  if (
    value.type !== "image" ||
    typeof value.baseUrl !== "string" ||
    typeof value.modelName !== "string"
  ) {
    throw new Error("模型配置快照不受支持。");
  }
  return {
    type: "image",
    baseUrl: value.baseUrl,
    modelName: value.modelName,
  };
}

function clonePromptdexEntry(
  entry: PromptdexImageTaskEntrySnapshot,
): PromptdexImageTaskEntrySnapshot {
  return {
    name: entry.name,
    description: entry.description,
    ...(entry.version !== undefined ? { version: entry.version } : {}),
    sourceType: entry.sourceType,
    taskType: entry.taskType,
    inputs: Object.fromEntries(
      Object.entries(entry.inputs).map(([name, input]) => [
        name,
        {
          required: input.required,
          description: input.description,
        },
      ]),
    ),
    body: entry.body,
  };
}

function cloneImageSpec(
  imageSpec: ImageTaskImageSpecSnapshot,
): ImageTaskImageSpecSnapshot {
  return { ...imageSpec };
}

function cloneModelConfiguration(
  modelConfiguration: ImageTaskModelConfigurationSnapshot,
): ImageTaskModelConfigurationSnapshot {
  return { ...modelConfiguration };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
