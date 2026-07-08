import Stack from "expo-router/stack";

export default function ModelConfigurationsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "模型配置" }} />
      <Stack.Screen name="new" options={{ title: "新建模型配置" }} />
      <Stack.Screen name="[id]" options={{ title: "模型配置详情" }} />
    </Stack>
  );
}
