import type { ReactNode } from "react";
import type { ViewStyle } from "react-native";

import { cn, Pressable, View } from "@/tw";

export type SurfaceVariant =
  "panel" | "interactive" | "brand" | "feedback" | "fieldGroup";

export type FeedbackTone = "neutral" | "success" | "warning" | "danger";

interface StaticSurfaceProps {
  children: ReactNode;
  variant?: "panel" | "fieldGroup";
}

interface StaticBrandSurfaceProps {
  accessibilityLabel?: never;
  children: ReactNode;
  onPress?: never;
  variant: "brand";
}

interface InteractiveBrandSurfaceProps {
  accessibilityLabel: string;
  children: ReactNode;
  onPress(): void;
  pressFeedbackDelayMs?: number;
  variant: "brand";
}

interface FeedbackSurfaceProps {
  children: ReactNode;
  tone?: FeedbackTone;
  variant: "feedback";
}

interface InteractiveSurfaceProps {
  accessibilityLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onPress(): void;
  pressFeedbackDelayMs?: number;
  variant: "interactive";
}

export type SurfaceProps =
  | StaticSurfaceProps
  | FeedbackSurfaceProps
  | InteractiveSurfaceProps
  | StaticBrandSurfaceProps
  | InteractiveBrandSurfaceProps;

const CONTINUOUS_BORDER_STYLE: ViewStyle = { borderCurve: "continuous" };

const SURFACE_CLASS: Record<SurfaceVariant, string> = {
  panel: "gap-3 rounded-[18px] border border-app-stroke bg-app-surface p-4",
  interactive:
    "min-h-11 overflow-hidden rounded-[18px] border border-app-stroke bg-app-surface transition-colors duration-150 active:bg-app-action-soft",
  brand:
    "relative gap-4 overflow-hidden rounded-[22px] border border-app-stroke bg-app-surface p-5",
  feedback: "gap-3 rounded-[16px] border bg-app-surface-raised p-4",
  fieldGroup:
    "gap-4 rounded-[16px] border border-app-stroke bg-app-surface-raised p-4",
};

const FEEDBACK_TONE_CLASS: Record<FeedbackTone, string> = {
  neutral: "border-app-stroke",
  success: "border-app-success",
  warning: "border-app-warning",
  danger: "border-app-danger",
};

export function Surface(props: SurfaceProps) {
  if (props.variant === "interactive") {
    const {
      accessibilityLabel,
      children,
      disabled = false,
      onPress,
      pressFeedbackDelayMs,
    } = props;
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        className={cn(
          SURFACE_CLASS.interactive,
          disabled && "bg-app-action-soft",
        )}
        disabled={disabled}
        onPress={onPress}
        pressFeedbackDelayMs={pressFeedbackDelayMs}
        style={CONTINUOUS_BORDER_STYLE}
      >
        {children}
      </Pressable>
    );
  }

  if (props.variant === "brand" && typeof props.onPress === "function") {
    const { accessibilityLabel, children, onPress, pressFeedbackDelayMs } =
      props;
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        className={cn(
          SURFACE_CLASS.brand,
          "transition-colors duration-150 active:bg-app-surface-raised",
        )}
        onPress={onPress}
        pressFeedbackDelayMs={pressFeedbackDelayMs}
        style={CONTINUOUS_BORDER_STYLE}
      >
        {children}
      </Pressable>
    );
  }

  if (props.variant === "feedback") {
    return (
      <View
        accessibilityLiveRegion={
          props.tone === "danger" ? "assertive" : "polite"
        }
        className={cn(
          SURFACE_CLASS.feedback,
          FEEDBACK_TONE_CLASS[props.tone ?? "neutral"],
        )}
        style={CONTINUOUS_BORDER_STYLE}
      >
        {props.children}
      </View>
    );
  }

  const variant = props.variant ?? "panel";

  return (
    <View className={SURFACE_CLASS[variant]} style={CONTINUOUS_BORDER_STYLE}>
      {props.children}
    </View>
  );
}
