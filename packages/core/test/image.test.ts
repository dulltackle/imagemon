import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_MODEL,
  GPT_IMAGE_2_UNIQUE_SIZES,
  getImageModelPresetSizes,
  validateEditImageOptions,
  validateGenerateImageOptions,
} from "../src/index.js";

describe("图片领域核心规则", () => {
  it("按模型返回推荐预设尺寸", () => {
    const commonSizes = ["auto", "1024x1024", "1536x1024", "1024x1536"];

    expect(getImageModelPresetSizes()).toEqual([...commonSizes, ...GPT_IMAGE_2_UNIQUE_SIZES]);
    expect(getImageModelPresetSizes(DEFAULT_IMAGE_MODEL)).toEqual([...commonSizes, ...GPT_IMAGE_2_UNIQUE_SIZES]);
    expect(getImageModelPresetSizes("gpt-image-2-2026-04-21")).toEqual([
      ...commonSizes,
      ...GPT_IMAGE_2_UNIQUE_SIZES,
    ]);
    expect(getImageModelPresetSizes("gpt-image-3")).toEqual(commonSizes);
    expect(getImageModelPresetSizes("compatible-image-model")).toBeUndefined();
  });

  it("校验通用图片参数边界", () => {
    expect(() => validateGenerateImageOptions({ prompt: " " })).toThrow("prompt is required");
    expect(() => validateGenerateImageOptions({ prompt: "x", n: 0 })).toThrow("n must be");
    expect(() => validateGenerateImageOptions({ prompt: "x", n: 11 })).toThrow("n must be");
    expect(() => validateGenerateImageOptions({ prompt: "x", partial_images: 4 })).toThrow("partial_images");
    expect(() => validateGenerateImageOptions({ prompt: "x", output_compression: 101 })).toThrow(
      "output_compression",
    );
    expect(() =>
      validateGenerateImageOptions({ prompt: "x", background: "transparent", output_format: "jpeg" }),
    ).toThrow("transparent background requires");
  });

  it("校验已知模型能力并允许未知兼容模型透传", () => {
    expect(() => validateGenerateImageOptions({ prompt: "x", background: "transparent" })).toThrow(
      "transparent background",
    );
    expect(() =>
      validateGenerateImageOptions({ model: "gpt-image-1", prompt: "x", size: "2048x2048" }),
    ).toThrow("does not support custom size");
    expect(() =>
      validateEditImageOptions({ model: "gpt-image-1-mini", prompt: "x", image: "input", input_fidelity: "high" }),
    ).toThrow("does not support input_fidelity");

    expect(() =>
      validateGenerateImageOptions({
        model: "compatible-image-model",
        prompt: "x",
        background: "transparent",
        output_format: "png",
        size: "vendor-size",
      }),
    ).not.toThrow();
  });

  it("校验自定义尺寸规则", () => {
    expect(() => validateGenerateImageOptions({ prompt: "x", size: "1001x1024" })).toThrow("divisible by 16");
    expect(() => validateGenerateImageOptions({ prompt: "x", size: "3088x1024" })).toThrow("aspect ratio");
    expect(() => validateGenerateImageOptions({ prompt: "x", size: "3856x1024" })).toThrow("3840px");
    expect(() => validateGenerateImageOptions({ prompt: "x", size: "800x800" })).toThrow("total pixels");
    expect(() => validateGenerateImageOptions({ prompt: "x", size: "3840x3840" })).toThrow("total pixels");

    for (const size of GPT_IMAGE_2_UNIQUE_SIZES) {
      expect(() => validateGenerateImageOptions({ prompt: "x", size })).not.toThrow();
    }
  });
});
