import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAppSettings, useModelConfigurationRepository } from "../../../src/app-state";
import type { ModelConfiguration } from "../../../src/model-configurations";

export default function SettingsScreen() {
  const router = useRouter();
  const settings = useAppSettings();
  const repository = useModelConfigurationRepository();
  const [defaultImageConfiguration, setDefaultImageConfiguration] =
    useState<ModelConfiguration | null>(null);
  const [defaultTextConfiguration, setDefaultTextConfiguration] =
    useState<ModelConfiguration | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDefaultConfigurations() {
      const [image, text] = await Promise.all([
        settings.defaultImageModelConfigurationId
          ? repository.get(settings.defaultImageModelConfigurationId)
          : Promise.resolve(null),
        settings.defaultTextModelConfigurationId
          ? repository.get(settings.defaultTextModelConfigurationId)
          : Promise.resolve(null),
      ]);
      if (!cancelled) {
        setDefaultImageConfiguration(image);
        setDefaultTextConfiguration(text);
      }
    }

    void loadDefaultConfigurations();

    return () => {
      cancelled = true;
    };
  }, [
    repository,
    settings.defaultImageModelConfigurationId,
    settings.defaultTextModelConfigurationId,
  ]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      style={styles.screen}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/model-configurations")}
        style={({ pressed }) => [styles.rowButton, pressed && styles.pressed]}
      >
        <View style={styles.rowIcon}>
          <Ionicons color="#0F766E" name="server-outline" size={22} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>模型配置</Text>
          <Text style={styles.rowSubtitle}>
            图片默认：{defaultImageConfiguration?.modelName ?? "未设置"} · 文本默认：
            {defaultTextConfiguration?.modelName ?? "未设置"}
          </Text>
        </View>
        <Ionicons color="#64748B" name="chevron-forward" size={20} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
    paddingBottom: 32,
    paddingTop: 20,
  },
  pressed: {
    opacity: 0.78,
  },
  rowButton: {
    alignItems: "center",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 20,
    minHeight: 72,
    paddingHorizontal: 14,
  },
  rowIcon: {
    alignItems: "center",
    backgroundColor: "#CCFBF1",
    borderRadius: 8,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  rowSubtitle: {
    color: "#64748B",
    fontSize: 13,
    lineHeight: 18,
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "700",
  },
  screen: {
    backgroundColor: "#F8FAFC",
    flex: 1,
  },
});
