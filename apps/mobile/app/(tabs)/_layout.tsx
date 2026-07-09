import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";

export default function TabsLayout() {
  return (
    <NativeTabs tintColor="#0F766E" minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(catalog)">
        <Icon
          sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }}
        />
        <Label>图鉴</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(history)">
        <Icon sf={{ default: "clock", selected: "clock.fill" }} />
        <Label>历史</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <Label>设置</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
