export const GLOBAL_MODEL_CALL_STATUS_EDGE_GAP = 12;
export const GLOBAL_MODEL_CALL_STATUS_HORIZONTAL_GAP = 16;
export const GLOBAL_MODEL_CALL_STATUS_TAB_BAR_CLEARANCE = 64;

interface GlobalModelCallStatusBottomOffsetInput {
  readonly safeAreaBottom: number;
  readonly isTabRoute: boolean;
}

export function isGlobalModelCallStatusTabRoute(
  segments: readonly string[],
): boolean {
  return segments[0] === "(tabs)";
}

export function getGlobalModelCallStatusBottomOffset({
  safeAreaBottom,
  isTabRoute,
}: GlobalModelCallStatusBottomOffsetInput): number {
  const safeBottom = Number.isFinite(safeAreaBottom)
    ? Math.max(safeAreaBottom, 0)
    : 0;

  return (
    Math.max(safeBottom, GLOBAL_MODEL_CALL_STATUS_EDGE_GAP) +
    (isTabRoute ? GLOBAL_MODEL_CALL_STATUS_TAB_BAR_CLEARANCE : 0)
  );
}
