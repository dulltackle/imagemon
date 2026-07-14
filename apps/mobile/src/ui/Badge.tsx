import { Text, View } from "@/tw";

export type BadgeVariant =
  "neutral" | "brand" | "success" | "warning" | "danger";

export interface BadgeProps {
  children: string;
  variant?: BadgeVariant;
}

const BADGE_CONTAINER_CLASS: Record<BadgeVariant, string> = {
  neutral: "bg-app-action-soft",
  brand: "bg-app-action-soft",
  success: "bg-app-success-soft",
  warning: "bg-app-warning-soft",
  danger: "bg-app-danger-soft",
};

const BADGE_TEXT_CLASS: Record<BadgeVariant, string> = {
  neutral: "text-app-ink-muted",
  brand: "text-app-action",
  success: "text-app-success",
  warning: "text-app-warning",
  danger: "text-app-danger",
};

export function Badge({ children, variant = "neutral" }: BadgeProps) {
  return (
    <View
      className={`min-h-6 shrink-0 items-center justify-center rounded-full px-2.5 py-1 ${BADGE_CONTAINER_CLASS[variant]}`}
    >
      <Text
        className={`text-xs font-bold leading-4 ${BADGE_TEXT_CLASS[variant]}`}
        numberOfLines={1}
        selectable
      >
        {children}
      </Text>
    </View>
  );
}
