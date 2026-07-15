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

export function Badge({ children, variant = "neutral" }: BadgeProps) {
  return (
    <View
      className={`min-h-6 shrink-0 items-center justify-center rounded-full px-2.5 py-1 ${BADGE_CONTAINER_CLASS[variant]}`}
    >
      <Text
        className="text-xs font-bold leading-4 text-app-ink"
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
}
