import { describe, expect, it } from "vitest";

import {
  createExpoImageResultAlbumSaver,
  createMemoryImageResultAlbumSaver,
  getImageResultAlbumSaveAvailabilityMessage,
  getImageResultAlbumSaveFailureMessage,
  getImageResultAlbumSaveSuccessMessage,
} from "./album-saver";

describe("ImageResultAlbumSaver", () => {
  it("在不支持系统相册写入的平台禁用保存", async () => {
    let permissionRequested = false;
    let saved = false;
    const saver = createExpoImageResultAlbumSaver({
      platformOS: "web",
      getFileInfo: async () => ({ exists: true }),
      requestWritePermission: async () => {
        permissionRequested = true;
        return true;
      },
      saveToLibrary: async () => {
        saved = true;
      },
    });

    await expect(saver.getAvailability("file:///result.png")).resolves.toEqual({
      status: "unsupported",
    });
    await expect(saver.save("file:///result.png")).resolves.toEqual({
      status: "failed",
      reason: "unsupported",
    });
    expect(permissionRequested).toBe(false);
    expect(saved).toBe(false);
  });

  it("图片文件缺失时不请求权限也不写入系统相册", async () => {
    let permissionRequested = false;
    let saved = false;
    const saver = createExpoImageResultAlbumSaver({
      platformOS: "ios",
      getFileInfo: async () => ({ exists: false }),
      requestWritePermission: async () => {
        permissionRequested = true;
        return true;
      },
      saveToLibrary: async () => {
        saved = true;
      },
    });

    await expect(saver.getAvailability("file:///missing.png")).resolves.toEqual({
      status: "missingFile",
    });
    await expect(saver.save("file:///missing.png")).resolves.toEqual({
      status: "failed",
      reason: "missingFile",
    });
    expect(permissionRequested).toBe(false);
    expect(saved).toBe(false);
  });

  it("拒绝写入权限时不保存图片", async () => {
    let saved = false;
    const saver = createExpoImageResultAlbumSaver({
      platformOS: "ios",
      getFileInfo: async () => ({ exists: true }),
      requestWritePermission: async () => false,
      saveToLibrary: async () => {
        saved = true;
      },
    });

    await expect(saver.save("file:///result.png")).resolves.toEqual({
      status: "failed",
      reason: "permissionDenied",
    });
    expect(saved).toBe(false);
  });

  it("获得写入权限后保存当前图片文件 URI", async () => {
    const savedUris: string[] = [];
    const saver = createExpoImageResultAlbumSaver({
      platformOS: "android",
      getFileInfo: async () => ({ exists: true }),
      requestWritePermission: async () => true,
      saveToLibrary: async (uri) => {
        savedUris.push(uri);
      },
    });

    await expect(saver.getAvailability(" file:///result.png ")).resolves.toEqual({
      status: "ready",
    });
    await expect(saver.save(" file:///result.png ")).resolves.toEqual({
      status: "saved",
    });
    expect(savedUris).toEqual(["file:///result.png"]);
  });

  it("系统相册写入失败时返回可展示错误", async () => {
    const saver = createExpoImageResultAlbumSaver({
      platformOS: "ios",
      getFileInfo: async () => ({ exists: true }),
      requestWritePermission: async () => true,
      saveToLibrary: async () => {
        throw new Error("write failed");
      },
    });

    await expect(saver.save("file:///result.png")).resolves.toEqual({
      status: "failed",
      reason: "writeFailed",
    });
  });

  it("内存实现可用于非原生兜底和测试", async () => {
    const saver = createMemoryImageResultAlbumSaver({
      supported: true,
      existingUris: ["memory:///result.png"],
    });

    await expect(saver.save("memory:///result.png")).resolves.toEqual({
      status: "saved",
    });
    expect(saver.savedUris).toEqual(["memory:///result.png"]);
    await expect(saver.save("memory:///missing.png")).resolves.toEqual({
      status: "failed",
      reason: "missingFile",
    });
  });

  it("提供保存结果和禁用原因的中文反馈", () => {
    expect(getImageResultAlbumSaveSuccessMessage()).toBe("已保存到系统相册。");
    expect(getImageResultAlbumSaveFailureMessage("permissionDenied")).toBe(
      "未获得相册写入权限，无法保存。",
    );
    expect(
      getImageResultAlbumSaveAvailabilityMessage({ status: "unsupported" }),
    ).toBe("当前平台不支持保存到系统相册。");
    expect(
      getImageResultAlbumSaveAvailabilityMessage({ status: "missingFile" }),
    ).toBe("图片文件缺失，无法保存到系统相册。");
  });
});
