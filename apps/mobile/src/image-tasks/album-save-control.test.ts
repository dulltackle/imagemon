import { describe, expect, it } from "vitest";

import {
  canStartImageResultAlbumSave,
  createImageResultAlbumSaveControlState,
  finishImageResultAlbumSave,
  getImageResultAlbumSaveControlPresentation,
  startImageResultAlbumSave,
  type ImageResultAlbumSaveControlState,
} from "./album-save-control";

describe("ImageResultAlbumSaveControl", () => {
  it("检查中和不可用状态会禁用保存入口并展示原因", () => {
    const checking: ImageResultAlbumSaveControlState = { status: "checking" };
    expect(getImageResultAlbumSaveControlPresentation(checking)).toEqual({
      disabled: true,
      feedback: null,
      inProgress: false,
      label: "保存到系统相册",
    });

    const unsupported = createImageResultAlbumSaveControlState({
      status: "unsupported",
    });
    expect(canStartImageResultAlbumSave(unsupported)).toBe(false);
    expect(getImageResultAlbumSaveControlPresentation(unsupported)).toEqual({
      disabled: true,
      feedback: {
        tone: "muted",
        message: "当前平台不支持保存到系统相册。",
      },
      inProgress: false,
      label: "保存到系统相册",
    });

    const missingFile = createImageResultAlbumSaveControlState({
      status: "missingFile",
    });
    expect(
      getImageResultAlbumSaveControlPresentation(missingFile).feedback,
    ).toEqual({
      tone: "muted",
      message: "图片文件缺失，无法保存到系统相册。",
    });
  });

  it("保存进行中会禁用入口，阻止重复启动同一次保存", () => {
    const ready = createImageResultAlbumSaveControlState({ status: "ready" });

    expect(canStartImageResultAlbumSave(ready)).toBe(true);
    const saving = startImageResultAlbumSave(ready);

    expect(canStartImageResultAlbumSave(saving)).toBe(false);
    expect(startImageResultAlbumSave(saving)).toBe(saving);
    expect(getImageResultAlbumSaveControlPresentation(saving)).toEqual({
      disabled: true,
      feedback: null,
      inProgress: true,
      label: "保存中",
    });
  });

  it("保存成功后退出进行中并展示一次性成功反馈", () => {
    const saving = startImageResultAlbumSave(
      createImageResultAlbumSaveControlState({ status: "ready" }),
    );

    const finished = finishImageResultAlbumSave(saving, { status: "saved" });

    expect(getImageResultAlbumSaveControlPresentation(finished)).toEqual({
      disabled: false,
      feedback: {
        tone: "success",
        message: "已保存到系统相册。",
      },
      inProgress: false,
      label: "保存到系统相册",
    });
  });

  it("保存失败会退出进行中并映射为当前页面反馈", () => {
    const saving = startImageResultAlbumSave(
      createImageResultAlbumSaveControlState({ status: "ready" }),
    );

    const denied = finishImageResultAlbumSave(saving, {
      status: "failed",
      reason: "permissionDenied",
    });
    expect(getImageResultAlbumSaveControlPresentation(denied)).toEqual({
      disabled: false,
      feedback: {
        tone: "error",
        message: "未获得相册写入权限，无法保存。",
      },
      inProgress: false,
      label: "保存到系统相册",
    });

    const missingFile = finishImageResultAlbumSave(saving, {
      status: "failed",
      reason: "missingFile",
    });
    expect(canStartImageResultAlbumSave(missingFile)).toBe(false);
    expect(getImageResultAlbumSaveControlPresentation(missingFile)).toEqual({
      disabled: true,
      feedback: {
        tone: "error",
        message: "图片文件缺失，无法保存到系统相册。",
      },
      inProgress: false,
      label: "保存到系统相册",
    });
  });
});
