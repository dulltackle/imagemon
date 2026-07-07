import {
  validatePromptdexTemplate,
  type PromptdexTemplate,
  type PromptdexTemplateInput,
} from "@imagemon/core";

import type {
  TemplateRefinementFailureReason,
  TemplateRefinementProposal,
} from "./template-refinement-draft-repository";

export type TemplateRefinementProposalParseFailureReason = Extract<
  TemplateRefinementFailureReason,
  "invalid_response" | "promptdex_contract_invalid"
>;

export class TemplateRefinementProposalParseError extends Error {
  constructor(
    readonly reason: TemplateRefinementProposalParseFailureReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TemplateRefinementProposalParseError";
  }
}

export function parseTemplateRefinementProposalJson(
  source: string,
): TemplateRefinementProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw invalidResponse("模型返回内容不是 JSON 对象文本。", error);
  }

  const root = requireObject(parsed, "提炼方案");
  if (Object.hasOwn(root, "taskType")) {
    throw invalidResponse("提炼方案不能独立声明 taskType。");
  }

  const template = parseTemplate(root.template);
  const proposal: TemplateRefinementProposal = {
    template,
    taskTypeRationale: requireString(root.taskTypeRationale, "taskTypeRationale"),
    retainedRules: requireStringArray(root.retainedRules, "retainedRules"),
    removedRules: requireObjectArray(root.removedRules, "removedRules", (item, index) => ({
      reason: requireString(item.reason, `removedRules[${index}].reason`),
      summary: requireString(item.summary, `removedRules[${index}].summary`),
    })),
    additions: requireObjectArray(root.additions, "additions", (item, index) => ({
      summary: requireString(item.summary, `additions[${index}].summary`),
      reason: requireString(item.reason, `additions[${index}].reason`),
      impactIfRejected: requireString(
        item.impactIfRejected,
        `additions[${index}].impactIfRejected`,
      ),
    })),
  };

  buildPromptdexTemplateFromRefinementProposal(proposal);
  return proposal;
}

export function buildPromptdexTemplateFromRefinementProposal(
  proposal: TemplateRefinementProposal,
): PromptdexTemplate {
  const fileName = `${proposal.template.name}.md`;
  try {
    return validatePromptdexTemplate(
      {
        name: proposal.template.name,
        description: proposal.template.description,
        ...(Object.hasOwn(proposal.template, "version")
          ? { version: proposal.template.version }
          : {}),
        inputs: proposal.template.inputs,
        body: proposal.template.body,
        fileName,
      },
      fileName,
    );
  } catch (error) {
    throw new TemplateRefinementProposalParseError(
      "promptdex_contract_invalid",
      error instanceof Error ? error.message : "Promptdex 模板契约校验失败。",
    );
  }
}

function parseTemplate(value: unknown): TemplateRefinementProposal["template"] {
  const template = requireObject(value, "template");
  if (Object.hasOwn(template, "taskType")) {
    throw invalidResponse("template 不能独立声明 taskType。");
  }

  const version = template.version;
  if (
    Object.hasOwn(template, "version") &&
    typeof version !== "string" &&
    typeof version !== "boolean"
  ) {
    throw invalidResponse("template.version 必须是字符串或布尔值。");
  }
  const parsedVersion = version as string | boolean | undefined;

  return {
    name: requireString(template.name, "template.name"),
    description: requireString(template.description, "template.description"),
    ...(Object.hasOwn(template, "version") ? { version: parsedVersion } : {}),
    inputs: parseInputs(template.inputs),
    body: requireString(template.body, "template.body"),
  };
}

function parseInputs(value: unknown): Record<string, PromptdexTemplateInput> {
  const inputRecords = requireObject(value, "template.inputs");
  return Object.fromEntries(
    Object.entries(inputRecords).map(([name, input]) => {
      const inputRecord = requireObject(input, `template.inputs.${name}`);
      return [
        name,
        {
          required: requireBoolean(
            inputRecord.required,
            `template.inputs.${name}.required`,
          ),
          description: requireString(
            inputRecord.description,
            `template.inputs.${name}.description`,
          ),
        },
      ];
    }),
  );
}

function requireObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponse(`${fieldName} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw invalidResponse(`${fieldName} 必须是字符串。`);
  }
  return value;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw invalidResponse(`${fieldName} 必须是布尔值。`);
  }
  return value;
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw invalidResponse(`${fieldName} 必须是数组。`);
  }
  return value.map((item, index) => requireString(item, `${fieldName}[${index}]`));
}

function requireObjectArray<T>(
  value: unknown,
  fieldName: string,
  mapItem: (item: Record<string, unknown>, index: number) => T,
): T[] {
  if (!Array.isArray(value)) {
    throw invalidResponse(`${fieldName} 必须是数组。`);
  }
  return value.map((item, index) =>
    mapItem(requireObject(item, `${fieldName}[${index}]`), index),
  );
}

function invalidResponse(message: string, cause?: unknown): TemplateRefinementProposalParseError {
  return new TemplateRefinementProposalParseError(
    "invalid_response",
    message,
    cause === undefined ? undefined : { cause },
  );
}
