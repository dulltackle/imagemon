import type { PromptdexTemplate } from "@imagemon/core";
import { describe, expect, it } from "vitest";

import { resolveTaskRefill, type TaskRefillEntry } from "./refill";
import type {
  ImageTaskHistory,
  ImageTaskStatus,
  ImageTaskType,
  PromptdexImageTaskSnapshot,
} from "./types";

const IMAGE_SPEC = {
  size: "1024x1024",
  quality: "auto",
  format: "png",
  n: 1,
} as const;

const MODEL_CONFIGURATION = {
  type: "image",
  baseUrl: "https://example.com/v1",
  modelName: "gpt-image-1",
} as const;

function promptdexSnapshot(
  overrides: {
    taskType?: ImageTaskType;
    taskInputs?: Record<string, string>;
  } = {},
): PromptdexImageTaskSnapshot {
  const taskType = overrides.taskType ?? "generate";
  return {
    source: "promptdex",
    promptdexEntry: {
      name: "海报生成",
      description: "生成海报",
      sourceType: "built-in",
      taskType,
      inputs: {
        content: { required: true, description: "海报文案" },
      },
      body: "画一张海报：{{content}}",
    },
    taskInputs: overrides.taskInputs ?? { content: "夏日促销" },
    imageSpec: IMAGE_SPEC,
    modelConfiguration: MODEL_CONFIGURATION,
    fullPrompt: "画一张海报：夏日促销",
  };
}

function history(
  overrides: {
    status?: ImageTaskStatus;
    taskType?: ImageTaskType;
    snapshot?: ImageTaskHistory["snapshot"];
  } = {},
): ImageTaskHistory {
  const taskType = overrides.taskType ?? "generate";
  return {
    id: "task-1",
    taskType,
    status: overrides.status ?? "failed",
    snapshot: overrides.snapshot ?? promptdexSnapshot({ taskType }),
    errorSummary: null,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    completedAt: null,
  };
}

function entry(
  overrides: {
    taskType?: ImageTaskType;
    inputs?: PromptdexTemplate["inputs"];
  } = {},
): TaskRefillEntry {
  return {
    sourceType: "built-in",
    template: {
      name: "海报生成",
      description: "生成海报",
      fileName: "poster.md",
      taskType: overrides.taskType ?? "generate",
      inputs: overrides.inputs ?? {
        content: { required: true, description: "海报文案" },
      },
      body: "画一张海报：{{content}}",
    },
  };
}

describe("resolveTaskRefill", () => {
  it("失败任务在条目仍存在时可重新填写", () => {
    const resolution = resolveTaskRefill({
      history: history({ status: "failed" }),
      entry: entry(),
    });

    expect(resolution).toEqual({
      status: "eligible",
      plan: {
        entryName: "海报生成",
        prefillInputs: { content: "夏日促销" },
        droppedInputNames: [],
        missingRequiredInputNames: [],
        requiresEditImage: false,
      },
    });
  });

  it("状态未知任务与失败任务走同一套规则", () => {
    const resolution = resolveTaskRefill({
      history: history({ status: "unknown" }),
      entry: entry(),
    });

    expect(resolution.status).toBe("eligible");
  });

  it("已完成任务不提供重新填写入口", () => {
    const resolution = resolveTaskRefill({
      history: history({ status: "completed" }),
      entry: entry(),
    });

    expect(resolution).toEqual({
      status: "ineligible",
      reason: "status_not_refillable",
    });
  });

  it("运行中任务不提供重新填写入口", () => {
    const resolution = resolveTaskRefill({
      history: history({ status: "running" }),
      entry: entry(),
    });

    expect(resolution).toEqual({
      status: "ineligible",
      reason: "status_not_refillable",
    });
  });

  it("manual 快照不提供重新填写入口", () => {
    const resolution = resolveTaskRefill({
      history: history({
        snapshot: {
          source: "manual",
          prompt: "一只猫",
          imageSpec: IMAGE_SPEC,
          modelConfiguration: MODEL_CONFIGURATION,
        },
      }),
      entry: entry(),
    });

    expect(resolution).toEqual({
      status: "ineligible",
      reason: "not_promptdex_task",
    });
  });

  it("当前图鉴已无同名条目时不提供入口", () => {
    const resolution = resolveTaskRefill({
      history: history(),
      entry: null,
    });

    expect(resolution).toEqual({
      status: "ineligible",
      reason: "entry_missing",
    });
  });

  it("条目任务类型已变更时不提供入口", () => {
    const resolution = resolveTaskRefill({
      history: history({ taskType: "generate" }),
      entry: entry({
        taskType: "edit",
        inputs: {
          content: { required: true, description: "海报文案" },
        },
      }),
    });

    expect(resolution).toEqual({
      status: "ineligible",
      reason: "entry_incompatible",
    });
  });

  it("快照输入与当前输入声明无交集时不提供入口", () => {
    const resolution = resolveTaskRefill({
      history: history(),
      entry: entry({
        inputs: {
          headline: { required: true, description: "主标题" },
        },
      }),
    });

    expect(resolution).toEqual({
      status: "ineligible",
      reason: "entry_incompatible",
    });
  });

  it("当前模板已删除的输入进入 droppedInputNames 且不预填", () => {
    const resolution = resolveTaskRefill({
      history: history({
        snapshot: promptdexSnapshot({
          taskInputs: { content: "夏日促销", legacy: "旧字段" },
        }),
      }),
      entry: entry(),
    });

    expect(resolution).toEqual({
      status: "eligible",
      plan: {
        entryName: "海报生成",
        prefillInputs: { content: "夏日促销" },
        droppedInputNames: ["legacy"],
        missingRequiredInputNames: [],
        requiresEditImage: false,
      },
    });
  });

  it("当前新增的必填输入进入 missingRequiredInputNames", () => {
    const resolution = resolveTaskRefill({
      history: history(),
      entry: entry({
        inputs: {
          content: { required: true, description: "海报文案" },
          headline: { required: true, description: "主标题" },
          subtitle: { required: false, description: "副标题" },
        },
      }),
    });

    expect(resolution).toEqual({
      status: "eligible",
      plan: {
        entryName: "海报生成",
        prefillInputs: { content: "夏日促销" },
        droppedInputNames: [],
        missingRequiredInputNames: ["headline"],
        requiresEditImage: false,
      },
    });
  });

  it("edit 条目要求重新选择输入图片", () => {
    const resolution = resolveTaskRefill({
      history: history({ taskType: "edit" }),
      entry: entry({ taskType: "edit" }),
    });

    expect(resolution.status).toBe("eligible");
    if (resolution.status === "eligible") {
      expect(resolution.plan.requiresEditImage).toBe(true);
    }
  });

  it("image / mask 附件输入不计入文本输入交集", () => {
    const resolution = resolveTaskRefill({
      history: history({ taskType: "edit" }),
      entry: entry({
        taskType: "edit",
        inputs: {
          image: { required: true, description: "输入图片" },
          content: { required: true, description: "海报文案" },
        },
      }),
    });

    expect(resolution.status).toBe("eligible");
    if (resolution.status === "eligible") {
      expect(resolution.plan.prefillInputs).toEqual({ content: "夏日促销" });
      expect(resolution.plan.missingRequiredInputNames).toEqual([]);
    }
  });
});
