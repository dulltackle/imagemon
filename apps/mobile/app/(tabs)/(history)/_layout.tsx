import Stack from "expo-router/stack";

export default function HistoryStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="history" options={{ title: "历史" }} />
    </Stack>
  );
}
