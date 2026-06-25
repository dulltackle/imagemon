import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import type { ModelConfiguration } from "../../src/model-configurations";

export default function PromptdexScreen() {
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const { repository, settings } = runtime;
  const [defaultImageConfiguration, setDefaultImageConfiguration] =
    useState<ModelConfiguration | null>(null);
  const [defaultTextConfiguration, setDefaultTextConfiguration] =
    useState<ModelConfiguration | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDefaults() {
      const [image, text] = await Promise.all([
        settings.defaultImageModelConfigurationId
          ? repository.get(settings.defaultImageModelConfigurationId)
          : Promise.resolve(null),
        settings.defaultTextModelConfigurationId
          ? repository.get(settings.defaultTextModelConfigurationId)
          : Promise.resolve(null),
      ]);
      if (!cancelled) {
        setDefaultImageConfiguration(image?.isReady ? image : null);
        setDefaultTextConfiguration(text?.isReady ? text : null);
      }
    }

    void loadDefaults();

    return () => {
      cancelled = true;
    };
  }, [
    repository,
    settings.defaultImageModelConfigurationId,
    settings.defaultTextModelConfigurationId,
  ]);

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>图鉴</Text>
      </View>

      <EntrySection
        actionLabel={defaultImageConfiguration ? "待接入" : "配置图片模型"}
        icon="image-outline"
        isReady={defaultImageConfiguration !== null}
        onPress={() => {
          if (!defaultImageConfiguration) {
            router.push("/model-configurations");
          }
        }}
        status={defaultImageConfiguration ? defaultImageConfiguration.modelName : "需要配置"}
        title="图片任务"
      />

      <EntrySection
        actionLabel={defaultTextConfiguration ? "待接入" : "配置文本模型"}
        icon="sparkles-outline"
        isReady={defaultTextConfiguration !== null}
        onPress={() => {
          if (!defaultTextConfiguration) {
            router.push("/model-configurations");
          }
        }}
        status={defaultTextConfiguration ? defaultTextConfiguration.modelName : "需要配置"}
        title="模板提炼"
      />
    </ScrollView>
  );
}

interface EntrySectionProps {
  actionLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  isReady: boolean;
  onPress(): void;
  status: string;
  title: string;
}

function EntrySection({
  actionLabel,
  icon,
  isReady,
  onPress,
  status,
  title,
}: EntrySectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Ionicons color="#0F766E" name={icon} size={22} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <Text style={[styles.statusText, isReady ? styles.readyText : styles.notReadyText]}>
          {status}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={isReady}
        onPress={onPress}
        style={({ pressed }) => [
          styles.actionButton,
          isReady && styles.disabledButton,
          pressed && !isReady && styles.pressed,
        ]}
      >
        <Ionicons color="#FFFFFF" name={isReady ? "hourglass-outline" : "settings-outline"} size={18} />
        <Text style={styles.actionButtonText}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 32,
  },
  disabledButton: {
    opacity: 0.5,
  },
  header: {
    paddingTop: 8,
  },
  notReadyText: {
    color: "#B45309",
  },
  pressed: {
    opacity: 0.78,
  },
  readyText: {
    color: "#0F766E",
  },
  screen: {
    backgroundColor: "#F8FAFC",
    flex: 1,
  },
  section: {
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 16,
    padding: 16,
  },
  sectionHeader: {
    gap: 8,
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
  },
  sectionTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: "700",
  },
  title: {
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "800",
  },
});
