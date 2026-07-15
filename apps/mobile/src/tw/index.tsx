import type { ComponentProps, ComponentRef } from "react";
import { forwardRef } from "react";
import { Image as ExpoImage } from "expo-image";
import { Link as RouterLink } from "expo-router";
import { clsx, type ClassValue } from "clsx";
import {
  useCssElement,
  useNativeVariable as useFunctionalVariable,
} from "react-native-css";
import {
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Pressable as RNPressable,
  ScrollView as RNScrollView,
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  View as RNView,
} from "react-native";
import { twMerge } from "tailwind-merge";

import {
  getPressFeedbackDelayProps,
  type PressFeedbackDelayProps,
} from "./press-feedback";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type LinkProps = ComponentProps<typeof RouterLink> & {
  className?: string;
};

export const Link = Object.assign(
  (props: LinkProps) => {
    return useCssElement(RouterLink, props, { className: "style" });
  },
  {
    Menu: RouterLink.Menu,
    MenuAction: RouterLink.MenuAction,
    Preview: RouterLink.Preview,
    resolveHref: RouterLink.resolveHref,
    Trigger: RouterLink.Trigger,
  },
);

export const useCSSVariable =
  process.env.EXPO_OS !== "web"
    ? useFunctionalVariable
    : (variable: string) => `var(${variable})`;

export type ViewProps = ComponentProps<typeof RNView> & {
  className?: string;
};

export const View = forwardRef<ComponentRef<typeof RNView>, ViewProps>(
  (props, ref) => {
    return useCssElement(RNView, { ...props, ref }, { className: "style" });
  },
);

export type TextProps = ComponentProps<typeof RNText> & {
  className?: string;
};

export const Text = forwardRef<ComponentRef<typeof RNText>, TextProps>(
  (props, ref) => {
    return useCssElement(RNText, { ...props, ref }, { className: "style" });
  },
);

export type ScrollViewProps = ComponentProps<typeof RNScrollView> & {
  className?: string;
  contentContainerClassName?: string;
};

export const ScrollView = forwardRef<
  ComponentRef<typeof RNScrollView>,
  ScrollViewProps
>((props, ref) => {
  return useCssElement(
    RNScrollView,
    { ...props, ref },
    {
      className: "style",
      contentContainerClassName: "contentContainerStyle",
    },
  );
});

export type KeyboardAvoidingViewProps = ComponentProps<
  typeof RNKeyboardAvoidingView
> & {
  className?: string;
};

export const KeyboardAvoidingView = forwardRef<
  ComponentRef<typeof RNKeyboardAvoidingView>,
  KeyboardAvoidingViewProps
>((props, ref) => {
  return useCssElement(
    RNKeyboardAvoidingView,
    { ...props, ref },
    { className: "style" },
  );
});

export type PressableProps = ComponentProps<typeof RNPressable> & {
  className?: string;
  pressFeedbackDelayMs?: number;
};

export const Pressable = forwardRef<
  ComponentRef<typeof RNPressable>,
  PressableProps
>(({ pressFeedbackDelayMs, ...props }, ref) => {
  const runtimePressableProps = {
    ...props,
    ...getPressFeedbackDelayProps(
      process.env.EXPO_OS,
      pressFeedbackDelayMs,
    ),
  } satisfies Omit<PressableProps, "pressFeedbackDelayMs"> &
    PressFeedbackDelayProps;

  return useCssElement(
    RNPressable,
    { ...runtimePressableProps, ref },
    { className: "style" },
  );
});

export type TextInputProps = ComponentProps<typeof RNTextInput> & {
  className?: string;
};

export const TextInput = forwardRef<
  ComponentRef<typeof RNTextInput>,
  TextInputProps
>((props, ref) => {
  return useCssElement(RNTextInput, { ...props, ref }, { className: "style" });
});

type ExpoImageProps = ComponentProps<typeof ExpoImage>;

function CSSImage(props: ExpoImageProps) {
  const flattenedStyle = StyleSheet.flatten(props.style) ?? {};
  const { objectFit, objectPosition, ...style } = flattenedStyle as Record<
    string,
    unknown
  >;
  const contentFit =
    props.contentFit ??
    (typeof objectFit === "string"
      ? (objectFit as ExpoImageProps["contentFit"])
      : undefined);
  const contentPosition =
    props.contentPosition ??
    (typeof objectPosition === "string"
      ? (objectPosition as ExpoImageProps["contentPosition"])
      : undefined);

  return (
    <ExpoImage
      {...props}
      contentFit={contentFit}
      contentPosition={contentPosition}
      style={style}
    />
  );
}

export type ImageProps = ComponentProps<typeof CSSImage> & {
  className?: string;
};

export const Image = (props: ImageProps) => {
  return useCssElement(CSSImage, props, { className: "style" });
};

export { SymbolIcon } from "./symbol-icon";
export type { AppIconName } from "./symbol-icon-definitions";
export type { SymbolIconProps } from "./symbol-icon.types";
