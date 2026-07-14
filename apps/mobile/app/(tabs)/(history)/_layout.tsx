import Stack from "expo-router/stack";

import { useCSSVariable } from "../../../src/tw";

export default function HistoryStackLayout() {
  const actionColor = useCSSVariable("--app-action");
  const canvasColor = useCSSVariable("--app-canvas");
  const inkColor = useCSSVariable("--app-ink");
  const surfaceColor = useCSSVariable("--app-surface");

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: canvasColor },
        headerBackButtonDisplayMode: "minimal",
        headerLargeStyle: { backgroundColor: surfaceColor },
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerLargeTitleStyle: { color: inkColor },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: surfaceColor },
        headerTintColor: actionColor,
        headerTitleStyle: { color: inkColor },
      }}
    >
      <Stack.Screen name="history" options={{ title: "历史" }} />
    </Stack>
  );
}
