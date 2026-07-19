import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import { ModelConfigurationEditor } from "../../src/model-configurations/ModelConfigurationEditor";
import type { ModelConfiguration } from "../../src/model-configurations";
import { Text, useCSSVariable, View } from "../../src/tw";
import { ScreenCanvas } from "../../src/ui/ScreenCanvas";

export default function ModelConfigurationDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const runtime = useReadyAppRuntime();
  const { repository } = runtime;
  const actionColor = useCSSVariable("--app-action");
  const [configuration, setConfiguration] = useState<ModelConfiguration | null>(
    null,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "missing">(
    "loading",
  );
  const id = typeof params.id === "string" ? params.id : null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!id) {
        setStatus("missing");
        return;
      }
      const nextConfiguration = await repository.get(id);
      if (!cancelled) {
        setConfiguration(nextConfiguration);
        setStatus(nextConfiguration ? "ready" : "missing");
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [id, repository]);

  if (status === "loading") {
    return (
      <ScreenCanvas variant="tool">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={actionColor} />
        </View>
      </ScreenCanvas>
    );
  }

  if (status === "missing" || !configuration) {
    return (
      <ScreenCanvas variant="tool">
        <View className="flex-1 items-center justify-center">
          <Text className="text-xl font-bold leading-7 text-app-ink">
            模型配置不存在
          </Text>
        </View>
      </ScreenCanvas>
    );
  }

  return (
    <ModelConfigurationEditor
      initialConfiguration={configuration}
      initialType={configuration.type}
    />
  );
}
