import type { ImagePickerAsset } from "expo-image-picker";
import { describe, expect, it } from "vitest";

import { normalizePickedEditInputImage } from "./picked-image";

function imageAsset(
  overrides: Partial<ImagePickerAsset> = {},
): ImagePickerAsset {
  return {
    uri: "file:///picked/input.png",
    width: 1200,
    height: 800,
    type: "image",
    fileName: "input.png",
    fileSize: 123456,
    mimeType: "image/png",
    ...overrides,
  };
}

describe("normalizePickedEditInputImage", () => {
  it("归一化有效的 ImagePicker 图片结果", async () => {
    await expect(
      normalizePickedEditInputImage(imageAsset()),
    ).resolves.toEqual({
      status: "ready",
      image: {
        uri: "file:///picked/input.png",
        mimeType: "image/png",
        fileName: "input.png",
        width: 1200,
        height: 800,
        byteSize: 123456,
      },
    });
  });

  it("缺少 MIME 时按文件扩展名推断", async () => {
    await expect(
      normalizePickedEditInputImage(
        imageAsset({
          uri: "file:///picked/input.JPEG?cache=1",
          fileName: null,
          mimeType: undefined,
        }),
      ),
    ).resolves.toMatchObject({
      status: "ready",
      image: {
        mimeType: "image/jpeg",
      },
    });
  });

  it("缺少 fileSize 时从文件信息补齐大小", async () => {
    const result = await normalizePickedEditInputImage(
      imageAsset({
        fileSize: undefined,
      }),
      {
        getFileInfo: async () => ({
          exists: true,
          size: 654321,
        }),
      },
    );

    expect(result).toMatchObject({
      status: "ready",
      image: {
        byteSize: 654321,
      },
    });
  });

  it("拒绝非图片、不可读或尺寸无效的输入", async () => {
    await expect(
      normalizePickedEditInputImage(
        imageAsset({
          mimeType: "video/mp4",
        }),
      ),
    ).resolves.toMatchObject({
      status: "failed",
      error: {
        reason: "non_image",
        message: "请选择图片文件。",
      },
    });

    await expect(
      normalizePickedEditInputImage(
        imageAsset({
          uri: " ",
        }),
      ),
    ).resolves.toMatchObject({
      status: "failed",
      error: {
        reason: "unreadable",
        message: "无法读取所选图片，请重新选择。",
      },
    });

    await expect(
      normalizePickedEditInputImage(
        imageAsset({
          width: 0,
        }),
      ),
    ).resolves.toMatchObject({
      status: "failed",
      error: {
        reason: "unreadable",
      },
    });
  });

  it("拒绝超过 20MB 或 25MP 的图片", async () => {
    await expect(
      normalizePickedEditInputImage(
        imageAsset({
          fileSize: 20 * 1024 * 1024 + 1,
        }),
      ),
    ).resolves.toMatchObject({
      status: "failed",
      error: {
        reason: "too_large",
        message: "所选图片超过 20MB，请选择较小的图片。",
      },
    });

    await expect(
      normalizePickedEditInputImage(
        imageAsset({
          width: 5001,
          height: 5000,
        }),
      ),
    ).resolves.toMatchObject({
      status: "failed",
      error: {
        reason: "too_many_pixels",
        message: "所选图片像素过高，请选择不超过 25MP 的图片。",
      },
    });
  });

  it("文件信息不可读时返回统一错误", async () => {
    await expect(
      normalizePickedEditInputImage(
        imageAsset({
          fileSize: undefined,
        }),
        {
          getFileInfo: async () => ({
            exists: false,
          }),
        },
      ),
    ).resolves.toMatchObject({
      status: "failed",
      error: {
        reason: "unreadable",
        message: "无法读取所选图片，请重新选择。",
      },
    });
  });
});
