import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Icon,
  Label,
  NativeTabs,
  VectorIcon,
} from "expo-router/unstable-native-tabs";

import { TAB_ICON_DEFINITIONS } from "../../src/tw/symbol-icon-definitions";

export default function TabsLayout() {
  return (
    <NativeTabs tintColor="#0F766E" minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(catalog)">
        <Icon
          androidSrc={
            <VectorIcon
              family={Ionicons}
              name={TAB_ICON_DEFINITIONS.catalog.fallback}
            />
          }
          sf={TAB_ICON_DEFINITIONS.catalog.ios}
        />
        <Label>图鉴</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(history)">
        <Icon
          androidSrc={
            <VectorIcon
              family={Ionicons}
              name={TAB_ICON_DEFINITIONS.history.fallback}
            />
          }
          sf={TAB_ICON_DEFINITIONS.history.ios}
        />
        <Label>历史</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <Icon
          androidSrc={
            <VectorIcon
              family={Ionicons}
              name={TAB_ICON_DEFINITIONS.settings.fallback}
            />
          }
          sf={TAB_ICON_DEFINITIONS.settings.ios}
        />
        <Label>设置</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
