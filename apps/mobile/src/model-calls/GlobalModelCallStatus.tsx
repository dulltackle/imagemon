import { router, useSegments, type Href } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Pressable, SymbolIcon, Text, useCSSVariable } from "../tw";
import {
  GLOBAL_MODEL_CALL_STATUS_HORIZONTAL_GAP,
  getGlobalModelCallStatusBottomOffset,
  isGlobalModelCallStatusTabRoute,
} from "./global-model-call-status-layout";
import { useModelCallLock } from "./model-call-context";
import { getModelCallStatusLabel } from "./model-call-lock";

export function GlobalModelCallStatus() {
  const { activeCall } = useModelCallLock();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const accentColor = useCSSVariable("--sf-blue");

  if (!activeCall) {
    return null;
  }

  const label = getModelCallStatusLabel(activeCall.type);
  const bottom = getGlobalModelCallStatusBottomOffset({
    safeAreaBottom: insets.bottom,
    isTabRoute: isGlobalModelCallStatusTabRoute(segments),
  });

  return (
    <Pressable
      accessibilityHint="返回当前模型调用的页面"
      accessibilityLabel={`${label}，返回发起页面`}
      accessibilityLiveRegion="polite"
      accessibilityRole="button"
      accessibilityState={{ busy: true }}
      className="absolute z-50 min-h-14 flex-row items-center gap-3 rounded-full border border-sf-separator bg-sf-bg-3 px-4 shadow-lg active:opacity-80"
      hitSlop={8}
      onPress={() => {
        router.navigate(activeCall.returnHref as Href);
      }}
      style={{
        bottom,
        left: Math.max(insets.left, GLOBAL_MODEL_CALL_STATUS_HORIZONTAL_GAP),
        right: Math.max(insets.right, GLOBAL_MODEL_CALL_STATUS_HORIZONTAL_GAP),
      }}
    >
      <ActivityIndicator color={accentColor} />
      <Text className="min-w-0 flex-1 text-[15px] font-bold leading-[21px] text-sf-text">
        {label}
      </Text>
      <Text className="text-[13px] font-bold leading-[18px] text-sf-blue">
        返回
      </Text>
      <SymbolIcon
        className="h-4 w-4"
        name="chevron-right"
        tintColor={accentColor}
      />
    </Pressable>
  );
}
