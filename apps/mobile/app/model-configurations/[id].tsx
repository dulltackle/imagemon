import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import {
  ModelConfigurationEditor,
} from "../../src/model-configurations/ModelConfigurationEditor";
import type { ModelConfiguration } from "../../src/model-configurations";

export default function ModelConfigurationDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const runtime = useReadyAppRuntime();
  const { repository } = runtime;
  const [configuration, setConfiguration] = useState<ModelConfiguration | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
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
      <View style={styles.stateScreen}>
        <ActivityIndicator color="#0F766E" />
      </View>
    );
  }

  if (status === "missing" || !configuration) {
    return (
      <View style={styles.stateScreen}>
        <Text style={styles.stateTitle}>模型配置不存在</Text>
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

const styles = StyleSheet.create({
  stateScreen: {
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  stateTitle: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "700",
  },
});
