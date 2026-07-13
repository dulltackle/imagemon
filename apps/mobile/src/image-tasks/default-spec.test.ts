import { describe, expect, it } from "vitest";

import {
  APPLICATION_DEFAULT_IMAGE_SPEC,
  getImageTaskSizeLabel,
  parseApplicationDefaultImageSpec,
} from "./default-spec";

describe("parseApplicationDefaultImageSpec", () => {
  it("原样返回合法的持久化值", () => {
    expect(
      parseApplicationDefaultImageSpec({
        size: "1024x1536",
        quality: "auto",
        format: "png",
        count: 1,
      }),
    ).toEqual({
      size: "1024x1536",
      quality: "auto",
      format: "png",
      count: 1,
    });
  });

  it("非法尺寸回落到默认尺寸", () => {
    expect(
      parseApplicationDefaultImageSpec({
        size: "4096x4096",
        quality: "auto",
        format: "png",
        count: 1,
      }).size,
    ).toBe(APPLICATION_DEFAULT_IMAGE_SPEC.size);
  });

  it("未来版本才支持的质量值回落到 auto 且不抛错", () => {
    expect(() =>
      parseApplicationDefaultImageSpec({
        size: "1024x1024",
        quality: "high",
        format: "png",
        count: 1,
      }),
    ).not.toThrow();
    expect(
      parseApplicationDefaultImageSpec({
        size: "1024x1024",
        quality: "high",
        format: "png",
        count: 1,
      }).quality,
    ).toBe("auto");
  });

  it("未来版本才支持的格式值回落到 png", () => {
    expect(
      parseApplicationDefaultImageSpec({
        size: "1024x1024",
        quality: "auto",
        format: "webp",
        count: 1,
      }).format,
    ).toBe("png");
  });

  it("未来版本才支持的数量值回落到 1", () => {
    expect(
      parseApplicationDefaultImageSpec({
        size: "1024x1024",
        quality: "auto",
        format: "png",
        count: 4,
      }).count,
    ).toBe(1);
  });

  it("null 与 undefined 回落到应用默认规格", () => {
    expect(
      parseApplicationDefaultImageSpec({
        size: null,
        quality: null,
        format: null,
        count: null,
      }),
    ).toEqual(APPLICATION_DEFAULT_IMAGE_SPEC);
    expect(
      parseApplicationDefaultImageSpec({
        size: undefined,
        quality: undefined,
        format: undefined,
        count: undefined,
      }),
    ).toEqual(APPLICATION_DEFAULT_IMAGE_SPEC);
  });

  it("四维全非法时整体回落到应用默认规格", () => {
    expect(
      parseApplicationDefaultImageSpec({
        size: 42,
        quality: {},
        format: [],
        count: "1",
      }),
    ).toEqual(APPLICATION_DEFAULT_IMAGE_SPEC);
  });
});

describe("getImageTaskSizeLabel", () => {
  it("为每档尺寸返回中文标签", () => {
    expect(getImageTaskSizeLabel("1024x1024")).toBe("方图");
    expect(getImageTaskSizeLabel("1536x1024")).toBe("横图");
    expect(getImageTaskSizeLabel("1024x1536")).toBe("竖图");
  });
});
