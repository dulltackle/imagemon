import { Image, View } from "@/tw";

export type WatercolorBackdropVariant =
  | "catalogCool"
  | "catalogWarm"
  | "emptyState";

interface WatercolorBackdropProps {
  variant: WatercolorBackdropVariant;
}

const WATERCOLOR_ASSET = {
  catalogCool: require("../../assets/watercolor/catalog-wash-cool.webp"),
  catalogWarm: require("../../assets/watercolor/catalog-wash-warm.webp"),
  emptyState: require("../../assets/watercolor/empty-state-watercolor.webp"),
} as const;

const BACKDROP_CLASS: Record<WatercolorBackdropVariant, string> = {
  catalogCool: "absolute -left-8 -top-8 h-28 w-[168px]",
  catalogWarm: "absolute right-0 -top-2 h-28 w-28",
  emptyState: "absolute inset-0",
};

const CONTENT_POSITION: Record<
  WatercolorBackdropVariant,
  "center" | "left top" | "right top"
> = {
  catalogCool: "left top",
  catalogWarm: "right top",
  emptyState: "center",
};

export function WatercolorBackdrop({ variant }: WatercolorBackdropProps) {
  return (
    <View
      accessibilityElementsHidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      className={BACKDROP_CLASS[variant]}
    >
      <Image
        accessible={false}
        className="h-full w-full"
        contentFit="contain"
        contentPosition={CONTENT_POSITION[variant]}
        pointerEvents="none"
        source={WATERCOLOR_ASSET[variant]}
      />
    </View>
  );
}
