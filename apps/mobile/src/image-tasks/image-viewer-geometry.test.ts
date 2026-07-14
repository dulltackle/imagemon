import { describe, expect, it } from "vitest";

import {
  IMAGE_VIEWER_DOUBLE_TAP_SCALE,
  IMAGE_VIEWER_MAX_SCALE,
  IMAGE_VIEWER_MIN_SCALE,
  clampImageViewerScale,
  clampImageViewerTranslation,
  getImageViewerTranslationBounds,
} from "./image-viewer-geometry";

describe("图片查看器缩放几何", () => {
  it("把缩放限制在一倍到五倍之间", () => {
    expect(clampImageViewerScale(0.5)).toBe(IMAGE_VIEWER_MIN_SCALE);
    expect(clampImageViewerScale(IMAGE_VIEWER_DOUBLE_TAP_SCALE)).toBe(2.5);
    expect(clampImageViewerScale(8)).toBe(IMAGE_VIEWER_MAX_SCALE);
    expect(clampImageViewerScale(Number.NaN)).toBe(IMAGE_VIEWER_MIN_SCALE);
  });

  it("计算横图放大后的水平拖移边界", () => {
    expect(
      getImageViewerTranslationBounds({
        viewportWidth: 300,
        viewportHeight: 600,
        fittedImageWidth: 300,
        fittedImageHeight: 200,
        scale: 2,
      }),
    ).toEqual({ maxX: 150, maxY: 0 });
  });

  it("计算竖图放大后的双向拖移边界", () => {
    expect(
      getImageViewerTranslationBounds({
        viewportWidth: 300,
        viewportHeight: 600,
        fittedImageWidth: 200,
        fittedImageHeight: 600,
        scale: 2,
      }),
    ).toEqual({ maxX: 50, maxY: 300 });
  });

  it("缩回一倍时把拖移归零", () => {
    expect(
      clampImageViewerTranslation({
        viewportWidth: 300,
        viewportHeight: 600,
        fittedImageWidth: 300,
        fittedImageHeight: 200,
        scale: 1,
        x: 120,
        y: -80,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("把位移限制在边界内", () => {
    expect(
      clampImageViewerTranslation({
        viewportWidth: 300,
        viewportHeight: 600,
        fittedImageWidth: 200,
        fittedImageHeight: 600,
        scale: 2,
        x: 100,
        y: -500,
      }),
    ).toEqual({ x: 50, y: -300 });
  });

  it("零尺寸与非有限输入安全回退", () => {
    expect(
      getImageViewerTranslationBounds({
        viewportWidth: 0,
        viewportHeight: 600,
        fittedImageWidth: 300,
        fittedImageHeight: 200,
        scale: 2,
      }),
    ).toEqual({ maxX: 0, maxY: 0 });
    expect(
      clampImageViewerTranslation({
        viewportWidth: 300,
        viewportHeight: 600,
        fittedImageWidth: 300,
        fittedImageHeight: 200,
        scale: 2,
        x: Number.POSITIVE_INFINITY,
        y: Number.NaN,
      }),
    ).toEqual({ x: 0, y: 0 });
  });
});
