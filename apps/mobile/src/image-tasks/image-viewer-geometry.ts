export const IMAGE_VIEWER_MIN_SCALE = 1;
export const IMAGE_VIEWER_DOUBLE_TAP_SCALE = 2.5;
export const IMAGE_VIEWER_MAX_SCALE = 5;

export interface ImageViewerGeometryInput {
  viewportWidth: number;
  viewportHeight: number;
  fittedImageWidth: number;
  fittedImageHeight: number;
  scale: number;
}

export interface ImageViewerTranslationInput extends ImageViewerGeometryInput {
  x: number;
  y: number;
}

export function clampImageViewerScale(scale: number): number {
  "worklet";
  if (!Number.isFinite(scale)) {
    return IMAGE_VIEWER_MIN_SCALE;
  }
  return Math.min(
    IMAGE_VIEWER_MAX_SCALE,
    Math.max(IMAGE_VIEWER_MIN_SCALE, scale),
  );
}

export function getImageViewerTranslationBounds(
  input: ImageViewerGeometryInput,
): { maxX: number; maxY: number } {
  "worklet";
  const {
    viewportWidth,
    viewportHeight,
    fittedImageWidth,
    fittedImageHeight,
  } = input;
  const scale = clampImageViewerScale(input.scale);

  if (
    scale <= IMAGE_VIEWER_MIN_SCALE ||
    !isPositiveFinite(viewportWidth) ||
    !isPositiveFinite(viewportHeight) ||
    !isPositiveFinite(fittedImageWidth) ||
    !isPositiveFinite(fittedImageHeight)
  ) {
    return { maxX: 0, maxY: 0 };
  }

  return {
    maxX: Math.max(0, (fittedImageWidth * scale - viewportWidth) / 2),
    maxY: Math.max(0, (fittedImageHeight * scale - viewportHeight) / 2),
  };
}

export function clampImageViewerTranslation(
  input: ImageViewerTranslationInput,
): { x: number; y: number } {
  "worklet";
  const bounds = getImageViewerTranslationBounds(input);
  const x = Number.isFinite(input.x) ? input.x : 0;
  const y = Number.isFinite(input.y) ? input.y : 0;

  return {
    x:
      bounds.maxX === 0
        ? 0
        : Math.min(bounds.maxX, Math.max(-bounds.maxX, x)),
    y:
      bounds.maxY === 0
        ? 0
        : Math.min(bounds.maxY, Math.max(-bounds.maxY, y)),
  };
}

function isPositiveFinite(value: number): boolean {
  "worklet";
  return Number.isFinite(value) && value > 0;
}
