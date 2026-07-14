import { ActivityIndicator } from "react-native";

import {
  cn,
  Pressable,
  SymbolIcon,
  Text,
  useCSSVariable,
} from "../tw";

interface DestructiveActionButtonProps {
  disabled?: boolean;
  isDeleting?: boolean;
  label: string;
  onPress(): void;
}

export function DestructiveActionButton({
  disabled = false,
  isDeleting = false,
  label,
  onPress,
}: DestructiveActionButtonProps) {
  const dangerColor = useCSSVariable("--sf-red");
  const isDisabled = disabled || isDeleting;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: isDeleting, disabled: isDisabled }}
      className={cn(
        "min-h-11 flex-row items-center justify-center gap-2 rounded-lg bg-sf-fill px-4 active:opacity-75",
        isDisabled && "opacity-50",
      )}
      disabled={isDisabled}
      onPress={onPress}
    >
      {isDeleting ? (
        <ActivityIndicator color={dangerColor} size="small" />
      ) : (
        <SymbolIcon
          className="h-[18px] w-[18px]"
          name="delete"
          tintColor={dangerColor}
        />
      )}
      <Text className="text-[15px] font-bold leading-[21px] text-sf-red">
        {isDeleting ? "删除中…" : label}
      </Text>
    </Pressable>
  );
}
