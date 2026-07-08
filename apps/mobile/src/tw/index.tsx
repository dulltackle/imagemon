import type { ComponentProps } from "react";
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

export function View(props: ViewProps) {
  return useCssElement(RNView, props, { className: "style" });
}

export type TextProps = ComponentProps<typeof RNText> & {
  className?: string;
};

export function Text(props: TextProps) {
  return useCssElement(RNText, props, { className: "style" });
}

export type ScrollViewProps = ComponentProps<typeof RNScrollView> & {
  className?: string;
  contentContainerClassName?: string;
};

export function ScrollView(props: ScrollViewProps) {
  return useCssElement(RNScrollView, props, {
    className: "style",
    contentContainerClassName: "contentContainerStyle",
  });
}

export type PressableProps = ComponentProps<typeof RNPressable> & {
  className?: string;
};

export function Pressable(props: PressableProps) {
  return useCssElement(RNPressable, props, { className: "style" });
}

export type TextInputProps = ComponentProps<typeof RNTextInput> & {
  className?: string;
};

export function TextInput(props: TextInputProps) {
  return useCssElement(RNTextInput, props, { className: "style" });
}
