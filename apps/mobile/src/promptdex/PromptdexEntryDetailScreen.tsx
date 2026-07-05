import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { PromptdexTemplate } from "@imagemon/core";

import { findBuiltInPromptdexTemplate } from "./index";

type DetailState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "failed"; message: string }
  | { status: "ready"; template: PromptdexTemplate };

export function PromptdexEntryDetailScreen() {
  const params = useLocalSearchParams<{ name?: string }>();
  const router = useRouter();
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const name = typeof params.name === "string" ? params.name : null;

  useEffect(() => {
    if (!name) {
      setState({ status: "missing" });
      return;
    }

    try {
      const template = findBuiltInPromptdexTemplate(name);
      setState(template ? { status: "ready", template } : { status: "missing" });
    } catch (error) {
      setState({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [name]);

  if (state.status === "loading") {
    return (
      <View style={styles.stateScreen}>
        <ActivityIndicator color="#0F766E" />
      </View>
    );
  }

  if (state.status === "missing") {
    return (
      <View style={styles.stateScreen}>
        <Text style={styles.stateTitle}>图鉴条目不存在</Text>
      </View>
    );
  }

  if (state.status === "failed") {
    return (
      <View style={styles.stateScreen}>
        <Text selectable style={styles.failureText}>
          {state.message}
        </Text>
      </View>
    );
  }

  const { template } = state;

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Ionicons color="#0F172A" name="chevron-back" size={22} />
        </Pressable>
        <View style={styles.headerText}>
          <Text numberOfLines={2} style={styles.title}>
            {template.name}
          </Text>
          <Text style={styles.sourceText}>内置图鉴</Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.statusRow}>
          <TaskTypeBadge taskType={template.taskType} />
          <Text style={styles.metaText}>
            {template.taskType === "generate" ? "可执行" : "编辑任务后续支持"}
          </Text>
        </View>
        <Text style={styles.description}>{template.description}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>输入声明</Text>
        <View style={styles.inputList}>
          {Object.entries(template.inputs).map(([inputName, input]) => (
            <View key={inputName} style={styles.inputRow}>
              <View style={styles.inputHeader}>
                <Text style={styles.inputName}>{inputName}</Text>
                <Text style={styles.inputRequirement}>
                  {input.required ? "必需" : "可选"}
                </Text>
              </View>
              <Text style={styles.inputDescription}>{input.description}</Text>
            </View>
          ))}
        </View>
      </View>

      {template.taskType === "edit" ? (
        <View style={styles.noticeBox}>
          <Ionicons color="#64748B" name="lock-closed-outline" size={20} />
          <Text style={styles.noticeText}>编辑任务后续支持。</Text>
        </View>
      ) : (
        <View style={styles.noticeBox}>
          <Ionicons color="#0F766E" name="sparkles-outline" size={20} />
          <Text style={styles.noticeText}>生成任务表单将在此条目中填写。</Text>
        </View>
      )}
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
  description: {
    color: "#475569",
    fontSize: 15,
    lineHeight: 22,
  },
  editBadge: {
    backgroundColor: "#F1F5F9",
    color: "#475569",
  },
  failureText: {
    color: "#991B1B",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  generateBadge: {
    backgroundColor: "#CCFBF1",
    color: "#0F766E",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingTop: 8,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  iconButton: {
    alignItems: "center",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  inputDescription: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  inputHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  inputList: {
    gap: 12,
  },
  inputName: {
    color: "#0F172A",
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  inputRequirement: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
  },
  inputRow: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  metaText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "700",
  },
  noticeBox: {
    alignItems: "flex-start",
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  noticeText: {
    color: "#475569",
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  screen: {
    backgroundColor: "#F8FAFC",
    flex: 1,
  },
  section: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 17,
    fontWeight: "800",
  },
  sourceText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "700",
  },
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
    fontWeight: "800",
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  title: {
    color: "#0F172A",
    fontSize: 24,
    fontWeight: "800",
  },
});
