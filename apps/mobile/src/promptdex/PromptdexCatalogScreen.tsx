import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  usePromptdexCatalogService,
  useTemplateRefinementDraftRepository,
} from "../app-state";
import { useModelCallLock } from "../model-calls";
import {
  type MergedPromptdexEntryListItem,
  type TemplateRefinementDraftStatus,
} from "./index";

type CatalogState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      entries: MergedPromptdexEntryListItem[];
      refinementDraftStatus: TemplateRefinementDraftStatus | null;
    };

export function PromptdexCatalogScreen() {
  const router = useRouter();
  const promptdexCatalogService = usePromptdexCatalogService();
  const templateRefinementDraftRepository = useTemplateRefinementDraftRepository();
  const modelCallLock = useModelCallLock();
  const [state, setState] = useState<CatalogState>({ status: "loading" });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function loadCatalog() {
        setState({ status: "loading" });
        try {
          const [entries, refinementDraft] = await Promise.all([
            promptdexCatalogService.list(),
            templateRefinementDraftRepository.get(),
          ]);
          if (!cancelled) {
            setState({
              status: "ready",
              entries,
              refinementDraftStatus: refinementDraft?.status ?? null,
            });
          }
        } catch (error) {
          if (!cancelled) {
            setState({
              status: "failed",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      void loadCatalog();

      return () => {
        cancelled = true;
      };
    }, [promptdexCatalogService, templateRefinementDraftRepository]),
  );

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>图鉴</Text>
      </View>

      {state.status === "ready" ? (
        <PromptdexRefinementEntry
          active={
            modelCallLock.activeCall?.type === "templateRefinement" ||
            state.refinementDraftStatus === "generating"
          }
          draftStatus={state.refinementDraftStatus}
          onPress={() => router.push("/promptdex/refine" as never)}
        />
      ) : null}

      {state.status === "loading" ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color="#0F766E" />
          <Text style={styles.stateText}>正在加载图鉴。</Text>
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
          <Text style={styles.stateText}>没有可用的图鉴条目。</Text>
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
                  <SourceBadge entry={entry} />
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

function PromptdexRefinementEntry({
  active,
  draftStatus,
  onPress,
}: {
  active: boolean;
  draftStatus: TemplateRefinementDraftStatus | null;
  onPress: () => void;
}) {
  const presentation = getRefinementEntryPresentation(active, draftStatus);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.refinementEntry, pressed && styles.pressed]}
    >
      <View style={styles.refinementIcon}>
        <Ionicons color="#0F766E" name={presentation.icon} size={22} />
      </View>
      <View style={styles.entryMain}>
        <Text style={styles.refinementTitle}>{presentation.title}</Text>
        <Text style={styles.entryDescription}>{presentation.description}</Text>
      </View>
      <Text style={styles.entryMeta}>{presentation.status}</Text>
    </Pressable>
  );
}

function getRefinementEntryPresentation(
  active: boolean,
  draftStatus: TemplateRefinementDraftStatus | null,
) {
  if (active) {
    return {
      icon: "hourglass-outline" as const,
      title: "模板提炼",
      description: "已有提炼调用正在进行。",
      status: "进行中",
    };
  }

  switch (draftStatus) {
    case "ready_for_review":
      return {
        icon: "document-text-outline" as const,
        title: "模板提炼",
        description: "有一份提炼方案等待确认写入。",
        status: "待审阅",
      };
    case "failed":
      return {
        icon: "alert-circle-outline" as const,
        title: "模板提炼",
        description: "上次提炼失败，可修改输入后重新生成。",
        status: "待处理",
      };
    case "editing_input":
      return {
        icon: "create-outline" as const,
        title: "模板提炼",
        description: "继续编辑未完成的提炼输入。",
        status: "编辑中",
      };
    case null:
      return {
        icon: "sparkles-outline" as const,
        title: "模板提炼",
        description: "从外部完整提示词生成个人图鉴条目。",
        status: "新建",
      };
    default:
      // "generating" 状态由调用方的 active 判定提前返回，不会到达此处；
      // 若未来新增草稿状态未被覆盖，则明确抛错而非返回 undefined 触发渲染崩溃。
      throw new Error(`未处理的模板提炼草稿状态：${String(draftStatus)}`);
  }
}

function SourceBadge({ entry }: { entry: MergedPromptdexEntryListItem }) {
  return (
    <Text
      style={[
        styles.badge,
        entry.sourceType === "personal"
          ? styles.personalSourceBadge
          : styles.builtInSourceBadge,
      ]}
    >
      {entry.sourceLabel}
    </Text>
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
  builtInSourceBadge: {
    backgroundColor: "#F1F5F9",
    color: "#475569",
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
  personalSourceBadge: {
    backgroundColor: "#EEF2FF",
    color: "#4338CA",
  },
  refinementEntry: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#99F6E4",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  refinementIcon: {
    alignItems: "center",
    backgroundColor: "#CCFBF1",
    borderRadius: 8,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  refinementTitle: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "800",
  },
});
