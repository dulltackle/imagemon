import type { SymbolWeight } from "expo-symbols";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";

import type { AppIconName } from "./symbol-icon-definitions";

export interface SymbolIconProps {
  name: AppIconName;
  className?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  tintColor?: ColorValue;
  testID?: string;
  weight?: SymbolWeight;
}
