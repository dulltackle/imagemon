import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import { useCssElement } from "react-native-css";
import { StyleSheet } from "react-native";

import {
  getAppIconDefinition,
  resolveSymbolIconSize,
} from "./symbol-icon-definitions";
import type { SymbolIconProps } from "./symbol-icon.types";

function IOSSymbolIcon({
  name,
  size,
  style,
  tintColor,
  testID,
  weight = "regular",
}: SymbolIconProps) {
  const flattenedStyle = StyleSheet.flatten(style) ?? {};
  const resolvedSize = resolveSymbolIconSize(
    size,
    flattenedStyle.width,
    flattenedStyle.height,
  );
  const definition = getAppIconDefinition(name);
  const resolvedStyle = StyleSheet.flatten([
    style,
    { width: resolvedSize, height: resolvedSize },
  ]) as ComponentProps<typeof SymbolView>["style"];

  return (
    <SymbolView
      name={definition.ios}
      resizeMode="scaleAspectFit"
      size={resolvedSize}
      style={resolvedStyle}
      testID={testID}
      tintColor={tintColor}
      weight={weight}
    />
  );
}

export function SymbolIcon(props: SymbolIconProps) {
  return useCssElement(IOSSymbolIcon, props, { className: "style" });
}
