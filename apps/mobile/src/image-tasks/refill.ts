import type { PromptdexTemplate } from "@imagemon/core";

import { getTextPromptdexInputs } from "../promptdex/template-inputs";
import type { ImageTaskHistory, PromptdexEntrySourceType } from "./types";

export type TaskRefillIneligibleReason =
  | "status_not_refillable"
  | "not_promptdex_task"
  | "entry_missing"
  | "entry_incompatible";

export interface TaskRefillPlan {
  entryName: string;
  /** 仅保留当前模板仍声明的文本输入。 */
  prefillInputs: Record<string, string>;
  /** 快照里有、当前模板已删除的输入。 */
  droppedInputNames: string[];
  /** 当前必填、快照里没有的输入。 */
  missingRequiredInputNames: string[];
  /** edit 条目需要重新选择输入图片（内部附件不预填）。 */
  requiresEditImage: boolean;
}

export type TaskRefillResolution =
  | { status: "eligible"; plan: TaskRefillPlan }
  | { status: "ineligible"; reason: TaskRefillIneligibleReason };

export interface TaskRefillEntry {
  template: PromptdexTemplate;
  sourceType: PromptdexEntrySourceType;
}

const REFILLABLE_STATUSES = ["failed", "unknown"];

/**
 * 失败 / 状态未知任务的「重新填写」资格判定（ADR 0026 / 0187）。
 *
 * 仅当当前图鉴条目仍存在、且历史快照能被当前版本解析出可匹配输入时才给入口；
 * 预填只是「可编辑建议」，确认后创建全新任务历史，原记录不变。
 */
export function resolveTaskRefill(input: {
  history: ImageTaskHistory;
  entry: TaskRefillEntry | null;
}): TaskRefillResolution {
  const { history, entry } = input;

  if (!REFILLABLE_STATUSES.includes(history.status)) {
    return { status: "ineligible", reason: "status_not_refillable" };
  }

  const snapshot = history.snapshot;
  if (snapshot.source !== "promptdex") {
    return { status: "ineligible", reason: "not_promptdex_task" };
  }

  if (!entry) {
    return { status: "ineligible", reason: "entry_missing" };
  }

  if (entry.template.taskType !== snapshot.promptdexEntry.taskType) {
    return { status: "ineligible", reason: "entry_incompatible" };
  }

  const textInputs = getTextPromptdexInputs(entry.template.inputs);
  const currentInputNames = new Set(textInputs.map((textInput) => textInput.name));
  const snapshotInputNames = Object.keys(snapshot.taskInputs);

  const matchedInputNames = snapshotInputNames.filter((name) =>
    currentInputNames.has(name),
  );
  if (matchedInputNames.length === 0) {
    return { status: "ineligible", reason: "entry_incompatible" };
  }

  const prefillInputs: Record<string, string> = {};
  for (const name of matchedInputNames) {
    prefillInputs[name] = snapshot.taskInputs[name];
  }

  return {
    status: "eligible",
    plan: {
      entryName: snapshot.promptdexEntry.name,
      prefillInputs,
      droppedInputNames: snapshotInputNames.filter(
        (name) => !currentInputNames.has(name),
      ),
      missingRequiredInputNames: textInputs
        .filter(
          (textInput) =>
            textInput.required && !(textInput.name in snapshot.taskInputs),
        )
        .map((textInput) => textInput.name),
      requiresEditImage: entry.template.taskType === "edit",
    },
  };
}
