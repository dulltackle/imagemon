import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import type {
  ModelConfiguration,
  ModelConfigurationType,
} from "../../src/model-configurations";

export default function ModelConfigurationsScreen() {
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const { refreshSettings, repository, settings } = runtime;
  const [configurations, setConfigurations] = useState<ModelConfiguration[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      const nextConfigurations = await repository.list();
      if (!cancelled) {
        setConfigurations(nextConfigurations);
        await refreshSettings();
        setIsLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [refreshSettings, repository]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      style={styles.screen}
    >
      <View style={styles.newActions}>
        <ActionButton
          icon="image-outline"
          label="新建图片模型"
          onPress={() =>
            router.push({
              pathname: "/model-configurations/new",
              params: { type: "image" },
            })
          }
        />
        <ActionButton
          icon="chatbubble-ellipses-outline"
          label="新建文本模型"
          onPress={() =>
            router.push({
              pathname: "/model-configurations/new",
              params: { type: "text" },
            })
          }
          variant="secondary"
        />
      </View>

      {isLoading ? (
        <ActivityIndicator color="#0F766E" />
      ) : (
        <>
          <ConfigurationGroup
            configurations={configurations.filter((configuration) => configuration.type === "image")}
            defaultId={settings.defaultImageModelConfigurationId}
            title="图片模型"
            type="image"
          />
          <ConfigurationGroup
            configurations={configurations.filter((configuration) => configuration.type === "text")}
            defaultId={settings.defaultTextModelConfigurationId}
            title="文本模型"
            type="text"
          />
        </>
      )}
    </ScrollView>
  );
}

interface ConfigurationGroupProps {
  configurations: ModelConfiguration[];
  defaultId: string | null;
  title: string;
  type: ModelConfigurationType;
}

function ConfigurationGroup({
  configurations,
  defaultId,
  title,
  type,
}: ConfigurationGroupProps) {
  const router = useRouter();

  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {configurations.length === 0 ? (
        <Text style={styles.emptyText}>
          {type === "image" ? "暂无图片模型配置" : "暂无文本模型配置"}
        </Text>
      ) : (
        configurations.map((configuration) => (
          <Pressable
            accessibilityRole="button"
            key={configuration.id}
            onPress={() =>
              router.push({
                pathname: "/model-configurations/[id]",
                params: { id: configuration.id },
              })
            }
            style={({ pressed }) => [styles.configurationRow, pressed && styles.pressed]}
          >
            <View style={styles.configurationMain}>
              <View style={styles.configurationTitleRow}>
                <Text numberOfLines={1} style={styles.configurationName}>
                  {configuration.modelName}
                </Text>
                {configuration.id === defaultId ? <Text style={styles.defaultBadge}>默认</Text> : null}
              </View>
              <Text numberOfLines={1} style={styles.configurationMeta}>
                {formatBaseUrlBrief(configuration.baseUrl)}
              </Text>
            </View>
            <Text style={[styles.statusText, configuration.isReady ? styles.readyText : styles.notReadyText]}>
              {configuration.isReady ? "就绪" : "未就绪"}
            </Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

interface ActionButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
  variant?: "primary" | "secondary";
}

function ActionButton({ icon, label, onPress, variant = "primary" }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        variant === "secondary" && styles.secondaryActionButton,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={variant === "secondary" ? "#0F766E" : "#FFFFFF"} name={icon} size={18} />
      <Text style={[styles.actionButtonText, variant === "secondary" && styles.secondaryActionButtonText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function formatBaseUrlBrief(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return baseUrl;
  }
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 8,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  configurationMain: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  configurationMeta: {
    color: "#64748B",
    fontSize: 13,
    lineHeight: 18,
  },
  configurationName: {
    color: "#0F172A",
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
  },
  configurationRow: {
    alignItems: "center",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  configurationTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  content: {
    gap: 20,
    padding: 20,
    paddingBottom: 32,
  },
  defaultBadge: {
    backgroundColor: "#CCFBF1",
    borderRadius: 999,
    color: "#0F766E",
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  emptyText: {
    color: "#64748B",
    fontSize: 14,
    lineHeight: 20,
  },
  group: {
    gap: 10,
  },
  groupTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
  },
  newActions: {
    flexDirection: "row",
    gap: 12,
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
  secondaryActionButton: {
    backgroundColor: "#E0F2F1",
  },
  secondaryActionButtonText: {
    color: "#0F766E",
  },
  statusText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
