import { Text, View } from "@/tw";

export type SectionTitleDecoration =
  "none" | "peach" | "teal" | "rose" | "sand";

export interface SectionTitleProps {
  children: string;
  decoration?: SectionTitleDecoration;
}

const DECORATION_CLASS: Record<
  Exclude<SectionTitleDecoration, "none">,
  string
> = {
  peach: "bg-app-wash-peach",
  teal: "bg-app-wash-teal",
  rose: "bg-app-wash-rose",
  sand: "bg-app-wash-sand",
};

export function SectionTitle({
  children,
  decoration = "none",
}: SectionTitleProps) {
  return (
    <View className="flex-row items-center gap-2">
      {decoration === "none" ? null : (
        <View
          aria-hidden
          className={`h-1 w-6 rounded-full ${DECORATION_CLASS[decoration]}`}
        />
      )}
      <Text
        className="min-w-0 flex-1 text-lg font-bold leading-6 text-app-ink"
        selectable
      >
        {children}
      </Text>
    </View>
  );
}
