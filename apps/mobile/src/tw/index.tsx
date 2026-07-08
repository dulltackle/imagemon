import type { ComponentProps, ComponentRef } from "react";
import { forwardRef } from "react";
import { Link as RouterLink } from "expo-router";
import {
  useCssElement,
  useNativeVariable as useFunctionalVariable,
} from "react-native-css";
import {
  Pressable as RNPressable,
  ScrollView as RNScrollView,
  Text as RNText,
  TextInput as RNTextInput,
  View as RNView,
} from "react-native";

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

export type PressableProps = ComponentProps<typeof RNPressable> & {
  className?: string;
};

export const Pressable = forwardRef<
  ComponentRef<typeof RNPressable>,
  PressableProps
>((props, ref) => {
  return useCssElement(RNPressable, { ...props, ref }, { className: "style" });
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
