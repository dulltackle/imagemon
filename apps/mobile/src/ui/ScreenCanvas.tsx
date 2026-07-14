import type { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScrollView, View } from "@/tw";

export type ScreenCanvasVariant = "brand" | "tool";

interface ScreenCanvasProps {
  children: ReactNode;
  variant?: ScreenCanvasVariant;
}

interface ScreenScrollViewProps extends ScreenCanvasProps {
  keyboardBehavior?: "default" | "form";
}

const SCREEN_BACKGROUND_CLASS: Record<ScreenCanvasVariant, string> = {
  brand: "bg-app-canvas",
  tool: "bg-app-surface-raised",
};

const SCREEN_CONTENT_CLASS =
  "w-full max-w-[720px] flex-1 self-center gap-[18px] px-5 pt-5";

const SCROLL_CONTENT_CLASS =
  "w-full max-w-[720px] self-center gap-[18px] px-5 pb-8 pt-5";

export function ScreenCanvas({
  children,
  variant = "tool",
}: ScreenCanvasProps) {
  const insets = useSafeAreaInsets();

  return (
    <View className={`flex-1 ${SCREEN_BACKGROUND_CLASS[variant]}`}>
      <View
        className={SCREEN_CONTENT_CLASS}
        style={{ paddingBottom: Math.max(32, insets.bottom + 20) }}
      >
        {children}
      </View>
    </View>
  );
}

export function ScreenScrollView({
  children,
  keyboardBehavior = "default",
  variant = "tool",
}: ScreenScrollViewProps) {
  const isForm = keyboardBehavior === "form";

  return (
    <ScrollView
      className={`flex-1 ${SCREEN_BACKGROUND_CLASS[variant]}`}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName={SCROLL_CONTENT_CLASS}
      keyboardDismissMode={
        isForm && process.env.EXPO_OS === "ios" ? "interactive" : "none"
      }
      keyboardShouldPersistTaps={isForm ? "handled" : "never"}
    >
      {children}
    </ScrollView>
  );
}
