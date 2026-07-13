import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import { ModelConfigurationEditor } from "../../src/model-configurations/ModelConfigurationEditor";
import type { ModelConfiguration } from "../../src/model-configurations";
import { Text, useCSSVariable, View } from "../../src/tw";

export default function ModelConfigurationDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const runtime = useReadyAppRuntime();
  const { repository } = runtime;
  const accentColor = useCSSVariable("--sf-blue");
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
      <View className="flex-1 items-center justify-center bg-sf-bg-2 p-6">
        <ActivityIndicator color={accentColor} />
      </View>
    );
  }

  if (status === "missing" || !configuration) {
    return (
      <View className="flex-1 items-center justify-center bg-sf-bg-2 p-6">
        <Text className="text-xl font-bold leading-7 text-sf-text" selectable>
          模型配置不存在
        </Text>
      </View>
    );
  }

  return (
    <ModelConfigurationEditor
      initialConfiguration={configuration}
      initialType={configuration.type}
    />
  );
}
