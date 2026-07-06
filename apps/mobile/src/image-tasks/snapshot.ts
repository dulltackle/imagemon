import {
  IMAGE_TASK_AVAILABLE_SIZES,
  type ImageTaskInternalAttachmentSnapshot,
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
        ...(snapshot.inputAttachments !== undefined
          ? {
              inputAttachments: clonePromptdexInputAttachments(
                snapshot.inputAttachments,
              ),
            }
          : {}),
        imageSpec: cloneImageSpec(snapshot.imageSpec),
        modelConfiguration: cloneModelConfiguration(snapshot.modelConfiguration),
        fullPrompt: snapshot.fullPrompt,
      };
    default: {
      // 穷尽性检查：新增 source 变体时在编译期暴露遗漏，避免运行时静默返回 undefined。
      const _exhaustive: never = snapshot;
      throw new Error(`未知的图片任务快照 source: ${JSON.stringify(_exhaustive)}`);
    }
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

  const promptdexEntry = parsePromptdexEntry(value.promptdexEntry);
  const inputAttachments = Object.hasOwn(value, "inputAttachments")
    ? parsePromptdexInputAttachments(
        value.inputAttachments,
        promptdexEntry.taskType,
      )
    : undefined;

  return {
    source: "promptdex",
    promptdexEntry,
    taskInputs: parseStringRecord(value.taskInputs, "taskInputs"),
    ...(inputAttachments !== undefined ? { inputAttachments } : {}),
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
    ...(typeof value.version === "string" || typeof value.version === "boolean"
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

function parsePromptdexInputAttachments(
  value: unknown,
  taskType: "generate" | "edit",
): PromptdexImageTaskSnapshot["inputAttachments"] {
  if (!isRecord(value)) {
    throw new Error("Promptdex 快照 inputAttachments 必须是对象。");
  }

  const inputAttachments: PromptdexImageTaskSnapshot["inputAttachments"] = {};
  if (Object.hasOwn(value, "image")) {
    inputAttachments.image = parseInternalAttachment(value.image, "image");
  }
  if (Object.hasOwn(value, "mask")) {
    inputAttachments.mask = parseInternalAttachment(value.mask, "mask");
  }

  if (taskType === "edit" && inputAttachments.image === undefined) {
    throw new Error("编辑 Promptdex 快照缺少 inputAttachments.image。");
  }

  return inputAttachments;
}

function parseInternalAttachment(
  value: unknown,
  expectedRole: ImageTaskInternalAttachmentSnapshot["role"],
): ImageTaskInternalAttachmentSnapshot {
  if (!isRecord(value)) {
    throw new Error(`Promptdex 快照 ${expectedRole} 附件必须是对象。`);
  }
  if (value.role !== expectedRole) {
    throw new Error(`Promptdex 快照 ${expectedRole} 附件 role 不匹配。`);
  }
  if (typeof value.filePath !== "string" || !value.filePath.trim()) {
    throw new Error(`Promptdex 快照 ${expectedRole} 附件缺少 filePath。`);
  }
  if (typeof value.mimeType !== "string" || !value.mimeType.trim()) {
    throw new Error(`Promptdex 快照 ${expectedRole} 附件缺少 mimeType。`);
  }
  if (
    value.originalFileName !== null &&
    typeof value.originalFileName !== "string"
  ) {
    throw new Error(
      `Promptdex 快照 ${expectedRole} 附件 originalFileName 不受支持。`,
    );
  }

  return {
    role: expectedRole,
    filePath: value.filePath,
    mimeType: value.mimeType,
    originalFileName: value.originalFileName,
    width: parseNullablePositiveInteger(
      value.width,
      `Promptdex 快照 ${expectedRole} 附件 width`,
    ),
    height: parseNullablePositiveInteger(
      value.height,
      `Promptdex 快照 ${expectedRole} 附件 height`,
    ),
    byteSize: parseNullableNonNegativeInteger(
      value.byteSize,
      `Promptdex 快照 ${expectedRole} 附件 byteSize`,
    ),
  };
}

function parseNullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error(`${label} 必须是正整数或 null。`);
}

function parseNullableNonNegativeInteger(
  value: unknown,
  label: string,
): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new Error(`${label} 必须是非负整数或 null。`);
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

function clonePromptdexInputAttachments(
  inputAttachments: NonNullable<
    PromptdexImageTaskSnapshot["inputAttachments"]
  >,
): NonNullable<PromptdexImageTaskSnapshot["inputAttachments"]> {
  return {
    ...(inputAttachments.image !== undefined
      ? { image: { ...inputAttachments.image } }
      : {}),
    ...(inputAttachments.mask !== undefined
      ? { mask: { ...inputAttachments.mask } }
      : {}),
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
