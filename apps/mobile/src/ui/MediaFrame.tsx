import { useState } from "react";
import type { ViewStyle } from "react-native";

import {
  cn,
  Image,
  SymbolIcon,
  Text,
  useCSSVariable,
  View,
  type AppIconName,
} from "@/tw";

export type MediaFrameVariant = "thumbnail" | "card" | "detail";
export type MediaFrameThumbnailSize = 72 | 104 | 112;

interface MediaFrameCommonProps {
  accessibilityLabel: string;
  onError?(): void;
  placeholderIcon?: AppIconName;
  placeholderLabel: string;
  uri: string | null;
}

interface ThumbnailMediaFrameProps extends MediaFrameCommonProps {
  thumbnailSize?: MediaFrameThumbnailSize;
  variant: "thumbnail";
}

interface CardMediaFrameProps extends MediaFrameCommonProps {
  variant: "card";
}

interface DetailMediaFrameProps extends MediaFrameCommonProps {
  aspectRatio?: number;
  variant: "detail";
}

export type MediaFrameProps =
  ThumbnailMediaFrameProps | CardMediaFrameProps | DetailMediaFrameProps;

interface MediaFrameContentProps extends MediaFrameCommonProps {
  aspectRatio?: number;
  thumbnailSize: MediaFrameThumbnailSize;
  variant: MediaFrameVariant;
}

const FRAME_BASE_CLASS =
  "items-center justify-center overflow-hidden rounded-[12px] border border-app-stroke bg-app-media-matte";

const THUMBNAIL_SIZE_CLASS: Record<MediaFrameThumbnailSize, string> = {
  72: "h-[72px] w-[72px]",
  104: "h-[104px] w-[104px]",
  112: "h-28 w-28",
};

const FRAME_VARIANT_CLASS: Record<
  Exclude<MediaFrameVariant, "thumbnail">,
  string
> = {
  card: "aspect-video w-full",
  detail: "min-h-[260px] max-h-[520px] w-full self-center",
};

const IMAGE_CLASS: Record<MediaFrameVariant, string> = {
  thumbnail: "h-full w-full object-cover",
  card: "h-full w-full object-cover",
  detail: "h-full w-full object-contain",
};

const PLACEHOLDER_CLASS: Record<MediaFrameVariant, string> = {
  thumbnail: "gap-1 p-2",
  card: "gap-2 p-4",
  detail: "gap-2.5 p-5",
};

const PLACEHOLDER_TEXT_CLASS: Record<MediaFrameVariant, string> = {
  thumbnail:
    "text-center text-[11px] font-bold leading-[14px] text-app-ink-muted",
  card: "text-center text-[13px] font-bold leading-[18px] text-app-ink-muted",
  detail: "text-center text-sm font-bold leading-5 text-app-ink-muted",
};

const PLACEHOLDER_ICON_SIZE: Record<MediaFrameVariant, number> = {
  thumbnail: 20,
  card: 30,
  detail: 40,
};

export function MediaFrame(props: MediaFrameProps) {
  const aspectRatio =
    props.variant === "detail" ? props.aspectRatio : undefined;
  const thumbnailSize =
    props.variant === "thumbnail" ? (props.thumbnailSize ?? 72) : 72;

  return (
    <MediaFrameContent
      key={props.uri ?? "empty"}
      accessibilityLabel={props.accessibilityLabel}
      aspectRatio={aspectRatio}
      onError={props.onError}
      placeholderIcon={props.placeholderIcon}
      placeholderLabel={props.placeholderLabel}
      thumbnailSize={thumbnailSize}
      uri={props.uri}
      variant={props.variant}
    />
  );
}

function MediaFrameContent({
  accessibilityLabel,
  aspectRatio,
  onError,
  placeholderIcon = "photo",
  placeholderLabel,
  thumbnailSize,
  uri,
  variant,
}: MediaFrameContentProps) {
  const [hasImageError, setHasImageError] = useState(false);
  const mutedColor = useCSSVariable("--app-ink-muted");
  const frameClass =
    variant === "thumbnail"
      ? THUMBNAIL_SIZE_CLASS[thumbnailSize]
      : FRAME_VARIANT_CLASS[variant];
  const frameStyle: ViewStyle = {
    borderCurve: "continuous",
    ...(variant === "detail"
      ? { aspectRatio: getValidAspectRatio(aspectRatio) }
      : null),
  };

  function handleImageError() {
    setHasImageError(true);
    onError?.();
  }

  return (
    <View className={cn(FRAME_BASE_CLASS, frameClass)} style={frameStyle}>
      {uri && !hasImageError ? (
        <Image
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="image"
          className={IMAGE_CLASS[variant]}
          contentFit={variant === "detail" ? "contain" : "cover"}
          onError={handleImageError}
          source={{ uri }}
        />
      ) : (
        <View
          accessibilityLabel={placeholderLabel}
          accessibilityRole="image"
          accessible
          className={cn(
            "h-full w-full items-center justify-center",
            PLACEHOLDER_CLASS[variant],
          )}
        >
          <SymbolIcon
            name={placeholderIcon}
            size={PLACEHOLDER_ICON_SIZE[variant]}
            tintColor={mutedColor}
          />
          <Text
            accessible={false}
            className={PLACEHOLDER_TEXT_CLASS[variant]}
            numberOfLines={2}
            selectable
          >
            {placeholderLabel}
          </Text>
        </View>
      )}
    </View>
  );
}

function getValidAspectRatio(aspectRatio: number | undefined): number {
  return typeof aspectRatio === "number" &&
    Number.isFinite(aspectRatio) &&
    aspectRatio > 0
    ? aspectRatio
    : 1;
}
