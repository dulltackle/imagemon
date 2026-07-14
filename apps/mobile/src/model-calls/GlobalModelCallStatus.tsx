import { router, useSegments, type Href } from "expo-router";
import { ActivityIndicator, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Pressable, SymbolIcon, Text, useCSSVariable } from "../tw";
import {
  GLOBAL_MODEL_CALL_STATUS_HORIZONTAL_GAP,
  getGlobalModelCallStatusBottomOffset,
  isGlobalModelCallStatusTabRoute,
} from "./global-model-call-status-layout";
import { useModelCallLock } from "./model-call-context";
import { getModelCallStatusLabel } from "./model-call-lock";

const GLOBAL_MODEL_CALL_STATUS_MAX_WIDTH = 680;

export function GlobalModelCallStatus() {
  const { activeCall } = useModelCallLock();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const actionColor = useCSSVariable("--app-action");

  if (!activeCall) {
    return null;
  }

  const label = getModelCallStatusLabel(activeCall.type);
  const bottom = getGlobalModelCallStatusBottomOffset({
    safeAreaBottom: insets.bottom,
    isTabRoute: isGlobalModelCallStatusTabRoute(segments),
  });
  const leftInset = Math.max(
    insets.left,
    GLOBAL_MODEL_CALL_STATUS_HORIZONTAL_GAP,
  );
  const rightInset = Math.max(
    insets.right,
    GLOBAL_MODEL_CALL_STATUS_HORIZONTAL_GAP,
  );
  const availableWidth = Math.max(0, viewportWidth - leftInset - rightInset);
  const width = Math.min(GLOBAL_MODEL_CALL_STATUS_MAX_WIDTH, availableWidth);
  const left = leftInset + Math.max(0, (availableWidth - width) / 2);

  return (
    <Pressable
      aria-busy
      accessibilityHint="返回当前模型调用的页面"
      accessibilityLabel={`${label}，返回发起页面`}
      accessibilityLiveRegion="polite"
      accessibilityRole="button"
      accessibilityState={{ busy: true }}
      className="absolute z-50 min-h-14 flex-row items-center gap-3 rounded-[18px] border border-app-stroke bg-app-surface-raised px-4 transition-colors duration-150 active:bg-app-action-soft"
      hitSlop={8}
      onPress={() => {
        router.navigate(activeCall.returnHref as Href);
      }}
      style={{
        bottom,
        left,
        width,
      }}
    >
      <ActivityIndicator color={actionColor} />
      <Text className="min-w-0 flex-1 text-[15px] font-bold leading-[21px] text-app-ink">
        {label}
      </Text>
      <Text className="text-[13px] font-bold leading-[18px] text-app-action">
        返回
      </Text>
      <SymbolIcon
        className="h-4 w-4"
        name="chevron-right"
        tintColor={actionColor}
      />
    </Pressable>
  );
}
