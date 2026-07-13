import Stack from "expo-router/stack";

export default function SettingsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="settings" options={{ title: "设置" }} />
    </Stack>
  );
}
