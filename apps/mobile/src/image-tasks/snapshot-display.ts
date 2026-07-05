import type {
  ImageTaskSnapshot,
  PromptdexEntrySourceType,
  PromptdexImageTaskSnapshot,
} from "./types";

export function getImageTaskSnapshotSummary(
  snapshot: ImageTaskSnapshot,
): string {
  if (snapshot.source === "promptdex") {
    return snapshot.promptdexEntry.name;
  }
  return snapshot.prompt;
}

export function getImageTaskSnapshotFullPrompt(
  snapshot: ImageTaskSnapshot,
): string {
  if (snapshot.source === "promptdex") {
    return snapshot.fullPrompt;
  }
  return snapshot.prompt;
}

export function getPromptdexSourceTypeLabel(
  sourceType: PromptdexEntrySourceType,
): string {
  switch (sourceType) {
    case "built-in":
      return "内置";
    case "personal":
      return "个人";
  }
}

export function getPromptdexTaskTypeLabel(taskType: "generate" | "edit"): string {
  switch (taskType) {
    case "generate":
      return "生成";
    case "edit":
      return "编辑";
  }
}

export function getPromptdexTaskInputRows(
  snapshot: PromptdexImageTaskSnapshot,
): Array<{ name: string; value: string }> {
  return Object.entries(snapshot.taskInputs).map(([name, value]) => ({
    name,
    value,
  }));
}
