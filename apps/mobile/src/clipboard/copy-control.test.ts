import { describe, expect, it } from "vitest";

import {
  CLIPBOARD_COPY_DEBOUNCE_MS,
  canStartClipboardCopy,
  createClipboardCopyControlState,
  finishClipboardCopy,
  getClipboardCopyControlPresentation,
  releaseClipboardCopy,
  startClipboardCopy,
} from "./copy-control";

const messages = {
  success: "内容已复制。",
  failure: "复制失败。",
};

describe("ClipboardCopyControl", () => {
  it("复制开始后阻止防抖窗口内的重复操作", () => {
    const idle = createClipboardCopyControlState();
    const copying = startClipboardCopy(idle);

    expect(canStartClipboardCopy(idle)).toBe(true);
    expect(canStartClipboardCopy(copying)).toBe(false);
    expect(startClipboardCopy(copying)).toBe(copying);
    expect(CLIPBOARD_COPY_DEBOUNCE_MS).toBe(800);
  });

  it("使用调用方文案生成成功反馈并在释放后恢复可用", () => {
    const copying = startClipboardCopy(createClipboardCopyControlState());
    const finished = finishClipboardCopy(
      copying,
      { status: "copied" },
      messages,
    );

    expect(getClipboardCopyControlPresentation(finished)).toEqual({
      feedback: { tone: "success", message: "内容已复制。" },
      inProgress: true,
    });
    expect(getClipboardCopyControlPresentation(releaseClipboardCopy(finished)))
      .toEqual({
        feedback: { tone: "success", message: "内容已复制。" },
        inProgress: false,
      });
  });

  it("复制失败后显示调用方错误文案且允许重试", () => {
    const copying = startClipboardCopy(createClipboardCopyControlState());
    const failed = finishClipboardCopy(
      copying,
      { status: "failed" },
      messages,
    );
    const released = releaseClipboardCopy(failed);

    expect(getClipboardCopyControlPresentation(released)).toEqual({
      feedback: { tone: "error", message: "复制失败。" },
      inProgress: false,
    });
    expect(startClipboardCopy(released)).toEqual({
      status: "copying",
      feedback: null,
    });
  });
});
