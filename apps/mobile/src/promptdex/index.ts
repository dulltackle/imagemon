import {
  parsePromptdexTemplates,
  toPromptdexTemplateListItem,
  type PromptdexTaskType,
  type PromptdexTemplate,
  type PromptdexTemplateInput,
  type PromptdexTemplateSource,
} from "@imagemon/core";

import { BUILT_IN_PROMPTDEX_TEMPLATE_SOURCES } from "./built-in-template-sources";
import type {
  PersonalPromptdexEntry,
  PersonalPromptdexEntryRepository,
} from "./personal-entry-repository";

export type BuiltInPromptdexEntryExecutionState =
  | "executable"
  | "unsupported_edit_mask";
export type PromptdexCatalogEntrySourceType = "personal" | "built-in";
export type PromptdexCatalogEntrySourceLabel = "个人" | "内置";

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

export interface MergedPromptdexEntryListItem {
  sourceType: PromptdexCatalogEntrySourceType;
  sourceLabel: PromptdexCatalogEntrySourceLabel;
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

export interface MergedPromptdexCatalogEntry {
  sourceType: PromptdexCatalogEntrySourceType;
  sourceLabel: PromptdexCatalogEntrySourceLabel;
  template: PromptdexTemplate;
  executionState: BuiltInPromptdexEntryExecutionState;
}

export interface MergedPromptdexCatalogService {
  list(): Promise<MergedPromptdexEntryListItem[]>;
  get(name: string): Promise<MergedPromptdexCatalogEntry | null>;
}

interface CreateMergedPromptdexCatalogServiceOptions {
  personalRepository: PersonalPromptdexEntryRepository;
  builtInSources?: readonly PromptdexTemplateSource[];
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

export function createMergedPromptdexCatalogService({
  personalRepository,
  builtInSources = BUILT_IN_PROMPTDEX_TEMPLATE_SOURCES,
}: CreateMergedPromptdexCatalogServiceOptions): MergedPromptdexCatalogService {
  return {
    async list() {
      const personalEntries = await personalRepository.list();
      const personalNames = new Set(
        personalEntries.map((entry) => entry.name),
      );
      const builtInCatalog = loadBuiltInPromptdexCatalog(builtInSources);
      const builtInTemplates = builtInCatalog.templates
        .filter((template) => !personalNames.has(template.name))
        .sort(compareTemplateNameAscending);

      return [
        ...personalEntries
          .slice()
          .sort(compareTemplateNameAscending)
          .map(toPersonalPromptdexEntryListItem),
        ...builtInTemplates.map(toBuiltInMergedPromptdexEntryListItem),
      ];
    },

    async get(name) {
      const personalEntry = await personalRepository.get(name);
      if (personalEntry) {
        return toMergedPromptdexCatalogEntry("personal", personalEntry);
      }

      const template = findBuiltInPromptdexTemplate(name, builtInSources);
      return template
        ? toMergedPromptdexCatalogEntry("built-in", template)
        : null;
    },
  };
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

function toPersonalPromptdexEntryListItem(
  entry: PersonalPromptdexEntry,
): MergedPromptdexEntryListItem {
  return toMergedPromptdexEntryListItem("personal", entry);
}

function toBuiltInMergedPromptdexEntryListItem(
  template: PromptdexTemplate,
): MergedPromptdexEntryListItem {
  return toMergedPromptdexEntryListItem("built-in", template);
}

function toMergedPromptdexEntryListItem(
  sourceType: PromptdexCatalogEntrySourceType,
  template: PromptdexTemplate,
): MergedPromptdexEntryListItem {
  const item = toPromptdexTemplateListItem(template);
  return {
    sourceType,
    sourceLabel: getPromptdexCatalogEntrySourceLabel(sourceType),
    name: item.name,
    description: item.description,
    taskType: item.taskType,
    inputs: item.inputs,
    executionState: getBuiltInPromptdexEntryExecutionState(item),
  };
}

function toMergedPromptdexCatalogEntry(
  sourceType: PromptdexCatalogEntrySourceType,
  template: PromptdexTemplate,
): MergedPromptdexCatalogEntry {
  return {
    sourceType,
    sourceLabel: getPromptdexCatalogEntrySourceLabel(sourceType),
    template,
    executionState: getBuiltInPromptdexEntryExecutionState(template),
  };
}

function getPromptdexCatalogEntrySourceLabel(
  sourceType: PromptdexCatalogEntrySourceType,
): PromptdexCatalogEntrySourceLabel {
  return sourceType === "personal" ? "个人" : "内置";
}

function compareTemplateNameAscending(
  left: Pick<PromptdexTemplate, "name">,
  right: Pick<PromptdexTemplate, "name">,
): number {
  return left.name.localeCompare(right.name);
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

export * from "./personal-entry-repository";
export * from "./template-refinement-draft-repository";
export * from "./template-refinement-parser";
