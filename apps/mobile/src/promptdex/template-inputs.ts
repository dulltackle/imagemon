import type { PromptdexTemplateInput } from "@imagemon/core";

/**
 * 叶子模块：只依赖 @imagemon/core 的类型。
 *
 * image-tasks 与 promptdex 两侧都需要「哪些输入是文本输入」这条规则，而
 * promptdex barrel 经 home.ts 反向依赖 image-tasks barrel，直接互相引用会成环。
 * 因此把规则下沉到这里，两侧各自深路径引入。
 */
const ATTACHMENT_INPUT_NAMES = ["image", "mask"];

export interface TextPromptdexInput {
  name: string;
  required: boolean;
  description: string;
}

export function getTextPromptdexInputs(
  inputs: Record<string, PromptdexTemplateInput>,
): TextPromptdexInput[] {
  return Object.entries(inputs)
    .filter(([name]) => !ATTACHMENT_INPUT_NAMES.includes(name))
    .map(([name, input]) => ({
      name,
      required: input.required,
      description: input.description,
    }));
}
