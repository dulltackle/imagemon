import Stack from "expo-router/stack";

import { useCSSVariable } from "../../src/tw";

export default function ModelConfigurationsStackLayout() {
  const actionColor = useCSSVariable("--app-action");
  const canvasColor = useCSSVariable("--app-canvas");
  const inkColor = useCSSVariable("--app-ink");
  const surfaceColor = useCSSVariable("--app-surface");

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: canvasColor },
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: surfaceColor },
        headerTintColor: actionColor,
        headerTitleStyle: { color: inkColor },
      }}
    >
      <Stack.Screen name="index" options={{ title: "模型配置" }} />
      <Stack.Screen name="new" options={{ title: "新建模型配置" }} />
      <Stack.Screen name="[id]" options={{ title: "模型配置详情" }} />
    </Stack>
  );
}
