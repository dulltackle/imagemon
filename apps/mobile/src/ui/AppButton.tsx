import { ActivityIndicator } from "react-native";

import {
  cn,
  Pressable,
  SymbolIcon,
  Text,
  useCSSVariable,
  View,
  type AppIconName,
} from "@/tw";

export type AppButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface AppButtonProps {
  accessibilityLabel?: string;
  disabled?: boolean;
  icon?: AppIconName;
  label: string;
  loading?: boolean;
  onPress(): void;
  variant?: AppButtonVariant;
}

const BUTTON_CLASS: Record<AppButtonVariant, string> = {
  primary:
    "border-app-action bg-app-action active:border-app-action-pressed active:bg-app-action-pressed",
  secondary:
    "border-app-stroke bg-app-surface-raised active:bg-app-action-soft",
  danger: "border-app-danger bg-app-danger-soft active:bg-app-surface-raised",
  ghost: "border-transparent bg-transparent active:bg-app-action-soft",
};

const BUTTON_TEXT_CLASS: Record<AppButtonVariant, string> = {
  primary: "text-app-on-action",
  secondary: "text-app-action",
  danger: "text-app-danger",
  ghost: "text-app-action",
};

const BUTTON_ICON_COLOR_VARIABLE: Record<AppButtonVariant, string> = {
  primary: "--app-on-action",
  secondary: "--app-action",
  danger: "--app-danger",
  ghost: "--app-action",
};

export function AppButton({
  accessibilityLabel,
  disabled = false,
  icon,
  label,
  loading = false,
  onPress,
  variant = "primary",
}: AppButtonProps) {
  const isDisabled = disabled || loading;
  const activeContentColor = useCSSVariable(
    BUTTON_ICON_COLOR_VARIABLE[variant],
  );
  const disabledContentColor = useCSSVariable("--app-ink");
  const contentColor = isDisabled ? disabledContentColor : activeContentColor;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: isDisabled }}
      className={cn(
        "min-h-11 flex-row items-center justify-center gap-2 rounded-[14px] border px-4 py-2.5 transition-colors duration-150",
        BUTTON_CLASS[variant],
        isDisabled && "border-app-stroke bg-app-action-soft",
      )}
      disabled={isDisabled}
      onPress={onPress}
      style={{ borderCurve: "continuous" }}
    >
      {loading || icon ? (
        <View className="h-5 w-5 items-center justify-center">
          {loading ? (
            <ActivityIndicator color={contentColor} size="small" />
          ) : icon ? (
            <SymbolIcon name={icon} size={18} tintColor={contentColor} />
          ) : null}
        </View>
      ) : null}
      <Text
        className={cn(
          "text-[15px] font-bold leading-[21px]",
          BUTTON_TEXT_CLASS[variant],
          isDisabled && "text-app-ink",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
