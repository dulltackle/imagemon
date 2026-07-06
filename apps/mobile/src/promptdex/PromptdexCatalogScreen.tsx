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

import {
  loadBuiltInPromptdexCatalog,
  type BuiltInPromptdexEntryListItem,
} from "./index";

type CatalogState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; entries: BuiltInPromptdexEntryListItem[] };

export function PromptdexCatalogScreen() {
  const router = useRouter();
  const [state, setState] = useState<CatalogState>({ status: "loading" });

  useEffect(() => {
    try {
      const catalog = loadBuiltInPromptdexCatalog();
      setState({ status: "ready", entries: catalog.entries });
    } catch (error) {
      setState({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>图鉴</Text>
      </View>

      {state.status === "loading" ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color="#0F766E" />
          <Text style={styles.stateText}>正在加载内置图鉴。</Text>
        </View>
      ) : null}

      {state.status === "failed" ? (
        <View style={styles.failureBox}>
          <Ionicons color="#B91C1C" name="alert-circle-outline" size={20} />
          <Text selectable style={styles.failureText}>
            {state.message}
          </Text>
        </View>
      ) : null}

      {state.status === "ready" && state.entries.length === 0 ? (
        <View style={styles.stateBox}>
          <Ionicons color="#64748B" name="file-tray-outline" size={24} />
          <Text style={styles.stateText}>没有可用的内置图鉴条目。</Text>
        </View>
      ) : null}

      {state.status === "ready" && state.entries.length > 0 ? (
        <View style={styles.list}>
          {state.entries.map((entry) => (
            <Pressable
              accessibilityRole="button"
              key={entry.name}
              onPress={() =>
                router.push(`/promptdex/${encodeURIComponent(entry.name)}` as never)
              }
              style={({ pressed }) => [styles.entryRow, pressed && styles.pressed]}
            >
              <View style={styles.entryMain}>
                <View style={styles.entryTitleRow}>
                  <Text numberOfLines={1} style={styles.entryName}>
                    {entry.name}
                  </Text>
                  <TaskTypeBadge taskType={entry.taskType} />
                </View>
                <Text numberOfLines={2} style={styles.entryDescription}>
                  {entry.description}
                </Text>
                <Text style={styles.entryMeta}>
                  {entry.executionState === "executable"
                    ? "可执行"
                    : "蒙版编辑后续支持"}
                </Text>
              </View>
              <Ionicons color="#94A3B8" name="chevron-forward" size={18} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function TaskTypeBadge({ taskType }: { taskType: "generate" | "edit" }) {
  return (
    <Text style={[styles.badge, taskType === "generate" ? styles.generateBadge : styles.editBadge]}>
      {taskType === "generate" ? "生成" : "编辑"}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 8,
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 32,
  },
  editBadge: {
    backgroundColor: "#F1F5F9",
    color: "#475569",
  },
  entryDescription: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  entryMain: {
    flex: 1,
    gap: 8,
  },
  entryMeta: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "700",
  },
  entryName: {
    color: "#0F172A",
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
  },
  entryRow: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  entryTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  failureBox: {
    alignItems: "flex-start",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  failureText: {
    color: "#991B1B",
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  generateBadge: {
    backgroundColor: "#CCFBF1",
    color: "#0F766E",
  },
  header: {
    gap: 6,
    paddingTop: 8,
  },
  list: {
    gap: 12,
  },
  pressed: {
    opacity: 0.72,
  },
  screen: {
    backgroundColor: "#F8FAFC",
    flex: 1,
  },
  stateBox: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 18,
  },
  stateText: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  title: {
    color: "#0F172A",
    fontSize: 30,
    fontWeight: "800",
  },
});
