import { describe, expect, it } from "vitest";

import {
  TemplateRefinementProposalParseError,
  buildPromptdexTemplateFromRefinementProposal,
  parseTemplateRefinementProposalJson,
} from "./template-refinement-parser";

describe("TemplateRefinementProposalParser", () => {
  it("解析结构化 JSON 提炼方案并可构造 PromptdexTemplate", () => {
    const proposal = parseTemplateRefinementProposalJson(JSON.stringify(validProposal()));
    const template = buildPromptdexTemplateFromRefinementProposal(proposal);

    expect(proposal).toMatchObject({
      template: {
        name: "refined-light-poster",
        description: "用于浅色信息海报",
        inputs: {
          subject: {
            required: true,
            description: "海报主体",
          },
        },
        body: "# 浅色海报\n\n生成一张清爽的浅色信息海报。",
      },
      taskTypeRationale: "未声明 image 输入，因此推断为生成任务。",
      retainedRules: ["保留浅色背景和清晰层级"],
      removedRules: [
        {
          summary: "移除具体活动日期",
          reason: "日期属于一次性任务内容。",
        },
      ],
      additions: [],
    });
    expect(template).toMatchObject({
      name: "refined-light-poster",
      fileName: "refined-light-poster.md",
      taskType: "generate",
      body: "# 浅色海报\n\n生成一张清爽的浅色信息海报。",
    });
  });

  it("非 JSON 或混合自然语言响应按 invalid_response 失败", () => {
    expectParseError("不是 JSON", "invalid_response");
    expectParseError(
      `说明文字 ${JSON.stringify(validProposal())}`,
      "invalid_response",
    );
  });

  it("数组根节点按 invalid_response 失败", () => {
    expectParseError(JSON.stringify([validProposal()]), "invalid_response");
  });

  it("缺少必需字段按 invalid_response 失败", () => {
    const proposal = validProposal();
    delete (proposal as Partial<typeof proposal>).retainedRules;

    expectParseError(JSON.stringify(proposal), "invalid_response");
  });

  it("字段类型错误按 invalid_response 失败", () => {
    expectParseError(
      JSON.stringify({
        ...validProposal(),
        retainedRules: ["保留构图", 123],
      }),
      "invalid_response",
    );
    expectParseError(
      JSON.stringify({
        ...validProposal(),
        template: {
          ...validProposal().template,
          inputs: {
            subject: {
              required: "true",
              description: "海报主体",
            },
          },
        },
      }),
      "invalid_response",
    );
  });

  it("独立 taskType 字段按 invalid_response 失败", () => {
    expectParseError(
      JSON.stringify({
        ...validProposal(),
        taskType: "generate",
      }),
      "invalid_response",
    );
    expectParseError(
      JSON.stringify({
        ...validProposal(),
        template: {
          ...validProposal().template,
          taskType: "generate",
        },
      }),
      "invalid_response",
    );
  });

  it("违反 Promptdex 契约按 promptdex_contract_invalid 失败", () => {
    expectParseError(
      JSON.stringify({
        ...validProposal(),
        template: {
          ...validProposal().template,
          name: "Refined Light Poster",
        },
      }),
      "promptdex_contract_invalid",
    );
    expectParseError(
      JSON.stringify({
        ...validProposal(),
        template: {
          ...validProposal().template,
          inputs: {},
        },
      }),
      "promptdex_contract_invalid",
    );
  });
});

function expectParseError(
  source: string,
  reason: "invalid_response" | "promptdex_contract_invalid",
): void {
  try {
    parseTemplateRefinementProposalJson(source);
    throw new Error("should fail");
  } catch (error) {
    expect(error).toBeInstanceOf(TemplateRefinementProposalParseError);
    expect(error).toMatchObject({ reason });
  }
}

function validProposal() {
  return {
    template: {
      name: "refined-light-poster",
      description: "用于浅色信息海报",
      inputs: {
        subject: {
          required: true,
          description: "海报主体",
        },
      },
      body: "# 浅色海报\n\n生成一张清爽的浅色信息海报。",
    },
    taskTypeRationale: "未声明 image 输入，因此推断为生成任务。",
    retainedRules: ["保留浅色背景和清晰层级"],
    removedRules: [
      {
        summary: "移除具体活动日期",
        reason: "日期属于一次性任务内容。",
      },
    ],
    additions: [],
  };
}
