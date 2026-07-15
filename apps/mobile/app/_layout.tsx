import "../src/global.css";

import { useFonts } from "expo-font";
import { Redirect, Stack, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppRuntimeProvider, useAppRuntime } from "../src/app-state";
import { BusinessCallAttentionProvider } from "../src/business-call-attentions";
import { ModelCallLockProvider } from "../src/model-calls";
import { GlobalModelCallStatus } from "../src/model-calls/GlobalModelCallStatus";
import { Text, useCSSVariable, View } from "../src/tw";
import { symbolIconFonts } from "../src/tw/symbol-icon-fonts";
import { Surface } from "../src/ui/Surface";

const SCREENSHOT_RUNTIME_ENABLED =
  process.env.EXPO_PUBLIC_IMAGEMON_SCREENSHOT_MODE === "1";

export default function AppLayout() {
  const [fontsLoaded, fontError] = useFonts(symbolIconFonts);

  if (fontError) {
    return (
      <StateScreen title="启动失败" message={fontError.message} tone="danger" />
    );
  }

  if (!fontsLoaded) {
    return <StateScreen title="正在启动" message="正在加载图标字体。" />;
  }

  // expo-router 与 native-stack 都不提供 SafeAreaProvider（只有 bottom-tabs 自带），
  // 而吸底提交栏需要 useSafeAreaInsets，缺少 Provider 时该 Hook 会直接抛错。
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppRuntimeProvider>
          <AppShell />
        </AppRuntimeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppShell() {
  const runtime = useAppRuntime();
  const segments = useSegments();
  const actionColor = useCSSVariable("--app-action");
  const canvasColor = useCSSVariable("--app-canvas");
  const inkColor = useCSSVariable("--app-ink");
  const mediaMatteColor = useCSSVariable("--app-media-matte");
  const surfaceColor = useCSSVariable("--app-surface");

  if (runtime.status === "loading") {
    return <StateScreen title="正在启动" message="正在初始化本地数据。" />;
  }

  if (runtime.status === "failed") {
    return (
      <StateScreen
        title="启动失败"
        message={runtime.error.message}
        tone="danger"
      />
    );
  }

  const isFirstRunRoute = segments[0] === "first-run";
  const firstRunCompleted = runtime.settings.firstRunSetupCompletedAt !== null;

  if (!firstRunCompleted && !isFirstRunRoute) {
    return <Redirect href="/first-run" />;
  }

  if (firstRunCompleted && isFirstRunRoute && !SCREENSHOT_RUNTIME_ENABLED) {
    return <Redirect href="/" />;
  }

  return (
    <BusinessCallAttentionProvider
      repository={runtime.businessCallAttentionRepository}
    >
      <ModelCallLockProvider>
        <View className="flex-1">
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
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="default-image-spec"
              options={{ title: "应用默认规格" }}
            />
            <Stack.Screen name="first-run" options={{ title: "首次设置" }} />
            <Stack.Screen name="history/[id]" options={{ title: "任务详情" }} />
            <Stack.Screen name="images/[id]" options={{ title: "图片详情" }} />
            <Stack.Screen
              name="image-viewer/[id]"
              options={{
                contentStyle: { backgroundColor: mediaMatteColor },
                gestureEnabled: true,
                headerShown: false,
                presentation: "fullScreenModal",
              }}
            />
            <Stack.Screen
              name="model-configurations"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="promptdex/refine"
              options={{ title: "模板提炼" }}
            />
            <Stack.Screen
              name="promptdex/[name]"
              options={{ title: "图鉴条目" }}
            />
            <Stack.Screen
              name="table-backup/index"
              options={{ title: "表格备份" }}
            />
            <Stack.Screen
              name="table-backup/restore"
              options={{ title: "表格恢复" }}
            />
            <Stack.Screen
              name="screenshot-symbol-icons"
              options={{ title: "图标验收" }}
            />
          </Stack>
          <GlobalModelCallStatus />
        </View>
      </ModelCallLockProvider>
    </BusinessCallAttentionProvider>
  );
}

interface StateScreenProps {
  title: string;
  message: string;
  tone?: "neutral" | "danger";
}

function StateScreen({ title, message, tone = "neutral" }: StateScreenProps) {
  return (
    <View className="flex-1 items-center justify-center bg-app-surface-raised">
      <View className="w-full max-w-[720px] px-5">
        <Surface tone={tone} variant="feedback">
          <Text
            className={`text-center text-2xl font-bold leading-[31px] ${tone === "danger" ? "text-app-danger" : "text-app-ink"}`}
            selectable
          >
            {title}
          </Text>
          <Text
            className={`text-center text-[15px] leading-[22px] ${tone === "danger" ? "text-app-danger" : "text-app-ink-muted"}`}
            selectable
          >
            {message}
          </Text>
        </Surface>
      </View>
    </View>
  );
}
