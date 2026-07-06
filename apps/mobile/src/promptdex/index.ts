import {
  parsePromptdexTemplates,
  toPromptdexTemplateListItem,
  type PromptdexTaskType,
  type PromptdexTemplate,
  type PromptdexTemplateInput,
  type PromptdexTemplateSource,
} from "@imagemon/core";

import { BUILT_IN_PROMPTDEX_TEMPLATE_SOURCES } from "./built-in-template-sources";

export type BuiltInPromptdexEntryExecutionState =
  | "executable"
  | "unsupported_edit_mask";

export interface BuiltInPromptdexEntryListItem {
  sourceType: "built-in";
  name: string;
  description: string;
  taskType: PromptdexTaskType;
  inputs: Array<{
    name: string;
    required: boolean;
    description: string;
  }>;
  executionState: BuiltInPromptdexEntryExecutionState;
}

export interface BuiltInPromptdexCatalog {
  sourceType: "built-in";
  entries: BuiltInPromptdexEntryListItem[];
  templates: PromptdexTemplate[];
}

export function loadBuiltInPromptdexCatalog(
  sources: readonly PromptdexTemplateSource[] = BUILT_IN_PROMPTDEX_TEMPLATE_SOURCES,
): BuiltInPromptdexCatalog {
  const templates = parsePromptdexTemplates(sources);
  return {
    sourceType: "built-in",
    templates,
    entries: templates.map(toBuiltInPromptdexEntryListItem),
  };
}

export function findBuiltInPromptdexTemplate(
  name: string,
  sources?: readonly PromptdexTemplateSource[],
): PromptdexTemplate | null {
  const catalog = loadBuiltInPromptdexCatalog(sources);
  return catalog.templates.find((template) => template.name === name) ?? null;
}

export function isBuiltInPromptdexEntryExecutable(
  entry: Pick<BuiltInPromptdexEntryListItem | PromptdexTemplate, "taskType" | "inputs">,
): boolean {
  return getBuiltInPromptdexEntryExecutionState(entry) === "executable";
}

export function getBuiltInPromptdexEntryExecutionState(
  entry: Pick<BuiltInPromptdexEntryListItem | PromptdexTemplate, "taskType" | "inputs">,
): BuiltInPromptdexEntryExecutionState {
  if (entry.taskType === "generate") {
    return "executable";
  }
  return hasPromptdexInput(entry.inputs, "mask")
    ? "unsupported_edit_mask"
    : "executable";
}

export function getTextPromptdexInputs(
  inputs: Record<string, PromptdexTemplateInput>,
): Array<{ name: string; required: boolean; description: string }> {
  return Object.entries(inputs)
    .filter(([name]) => name !== "image" && name !== "mask")
    .map(([name, input]) => ({
      name,
      required: input.required,
      description: input.description,
    }));
}

function toBuiltInPromptdexEntryListItem(
  template: PromptdexTemplate,
): BuiltInPromptdexEntryListItem {
  const item = toPromptdexTemplateListItem(template);
  return {
    sourceType: "built-in",
    name: item.name,
    description: item.description,
    taskType: item.taskType,
    inputs: item.inputs,
    executionState: getBuiltInPromptdexEntryExecutionState(item),
  };
}

function hasPromptdexInput(
  inputs:
    | Record<string, PromptdexTemplateInput>
    | Array<{ name: string; required: boolean; description: string }>,
  name: string,
): boolean {
  if (Array.isArray(inputs)) {
    return inputs.some((input) => input.name === name);
  }
  return Object.hasOwn(inputs, name);
}
