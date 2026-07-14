import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { useCssElement } from "react-native-css";
import { StyleSheet } from "react-native";

import {
  getAppIconDefinition,
  resolveSymbolIconSize,
} from "./symbol-icon-definitions";
import type { SymbolIconProps } from "./symbol-icon.types";

function FallbackSymbolIcon({
  name,
  size,
  style,
  tintColor,
  testID,
}: SymbolIconProps) {
  const flattenedStyle = StyleSheet.flatten(style) ?? {};
  const resolvedSize = resolveSymbolIconSize(
    size,
    flattenedStyle.width,
    flattenedStyle.height,
  );
  const definition = getAppIconDefinition(name);
  const resolvedDimension =
    process.env.EXPO_OS === "web" ? `${resolvedSize}px` : resolvedSize;
  const resolvedStyle = StyleSheet.flatten([
    style,
    { width: resolvedDimension, height: resolvedDimension },
  ]) as ComponentProps<typeof Ionicons>["style"];

  return (
    <Ionicons
      color={tintColor}
      name={definition.fallback}
      size={resolvedSize}
      style={resolvedStyle}
      testID={testID}
    />
  );
}

export function SymbolIcon(props: SymbolIconProps) {
  return useCssElement(FallbackSymbolIcon, props, { className: "style" });
}
