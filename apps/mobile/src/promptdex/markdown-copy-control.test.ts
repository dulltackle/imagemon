import { describe, expect, it } from "vitest";

import {
  PROMPTDEX_MARKDOWN_COPY_DEBOUNCE_MS,
  canStartPromptdexMarkdownCopy,
  createPromptdexMarkdownCopyControlState,
  finishPromptdexMarkdownCopy,
  getPromptdexMarkdownCopyControlPresentation,
  releasePromptdexMarkdownCopy,
  startPromptdexMarkdownCopy,
} from "./markdown-copy-control";

describe("PromptdexMarkdownCopyControl", () => {
  it("空闲状态允许立即启动复制", () => {
    const idle = createPromptdexMarkdownCopyControlState();

    expect(canStartPromptdexMarkdownCopy(idle)).toBe(true);
    expect(getPromptdexMarkdownCopyControlPresentation(idle)).toEqual({
      feedback: null,
      inProgress: false,
    });

    const copying = startPromptdexMarkdownCopy(idle);

    expect(copying).toEqual({
      status: "copying",
      feedback: null,
    });
    expect(getPromptdexMarkdownCopyControlPresentation(copying)).toEqual({
      feedback: null,
      inProgress: true,
    });
  });

  it("防抖窗口内重复启动会被忽略", () => {
    const copying = startPromptdexMarkdownCopy(
      createPromptdexMarkdownCopyControlState(),
    );

    expect(canStartPromptdexMarkdownCopy(copying)).toBe(false);
    expect(startPromptdexMarkdownCopy(copying)).toBe(copying);
    expect(PROMPTDEX_MARKDOWN_COPY_DEBOUNCE_MS).toBe(800);
  });

  it("复制成功时保留 loading 并返回页面内成功反馈", () => {
    const copying = startPromptdexMarkdownCopy(
      createPromptdexMarkdownCopyControlState(),
    );

    const finished = finishPromptdexMarkdownCopy(copying, { status: "copied" });

    expect(getPromptdexMarkdownCopyControlPresentation(finished)).toEqual({
      feedback: {
        tone: "success",
        message: "Promptdex Markdown 已复制。",
      },
      inProgress: true,
    });
    expect(canStartPromptdexMarkdownCopy(finished)).toBe(false);

    const released = releasePromptdexMarkdownCopy(finished);
    expect(getPromptdexMarkdownCopyControlPresentation(released)).toEqual({
      feedback: {
        tone: "success",
        message: "Promptdex Markdown 已复制。",
      },
      inProgress: false,
    });
    expect(canStartPromptdexMarkdownCopy(released)).toBe(true);
  });

  it("复制失败时不进入持久错误状态", () => {
    const copying = startPromptdexMarkdownCopy(
      createPromptdexMarkdownCopyControlState(),
    );

    const failed = finishPromptdexMarkdownCopy(copying, { status: "failed" });

    expect(getPromptdexMarkdownCopyControlPresentation(failed)).toEqual({
      feedback: {
        tone: "error",
        message: "无法复制到剪贴板，请稍后重试。",
      },
      inProgress: true,
    });

    const retried = startPromptdexMarkdownCopy(
      releasePromptdexMarkdownCopy(failed),
    );
    expect(retried).toEqual({
      status: "copying",
      feedback: null,
    });
  });
});
