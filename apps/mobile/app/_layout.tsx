import { Redirect, Stack, useSegments } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { AppRuntimeProvider, useAppRuntime } from "../src/app-state";
import { ModelCallLockProvider } from "../src/model-calls";

export default function AppLayout() {
  return (
    <AppRuntimeProvider>
      <AppShell />
    </AppRuntimeProvider>
  );
}

function AppShell() {
  const runtime = useAppRuntime();
  const segments = useSegments();

  if (runtime.status === "loading") {
    return <StateScreen title="正在启动" message="正在初始化本地数据。" />;
  }

  if (runtime.status === "failed") {
    return <StateScreen title="启动失败" message={runtime.error.message} />;
  }

  const isFirstRunRoute = segments[0] === "first-run";
  const firstRunCompleted = runtime.settings.firstRunSetupCompletedAt !== null;

  if (!firstRunCompleted && !isFirstRunRoute) {
    return <Redirect href="/first-run" />;
  }

  if (firstRunCompleted && isFirstRunRoute) {
    return <Redirect href="/" />;
  }

  return (
    <ModelCallLockProvider>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="first-run" />
        <Stack.Screen name="history/[id]" />
        <Stack.Screen name="images/[id]" />
        <Stack.Screen name="model-configurations" />
      </Stack>
    </ModelCallLockProvider>
  );
}

interface StateScreenProps {
  title: string;
  message: string;
}

function StateScreen({ title, message }: StateScreenProps) {
  return (
    <View style={styles.stateContainer}>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stateContainer: {
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  stateMessage: {
    color: "#475569",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  stateTitle: {
    color: "#0F172A",
    fontSize: 24,
    fontWeight: "700",
  },
});
