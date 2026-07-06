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

import { useReadyAppRuntime } from "../../src/app-state";
import {
  getImageTaskSnapshotSummary,
  getPromptdexSourceTypeLabel,
  getPromptdexTaskInputRows,
  getPromptdexTaskTypeLabel,
  type ImageResult,
  type ImageTaskHistory,
  type ImageTaskStatus,
  type PromptdexImageTaskSnapshot,
} from "../../src/image-tasks";

type HistoryDetailState =
  | { status: "loading" }
  | { status: "missing" }
  | {
      status: "ready";
      history: ImageTaskHistory;
      imageResults: ImageResult[];
    };

export default function HistoryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const runtime = useReadyAppRuntime();
  const [state, setState] = useState<HistoryDetailState>({ status: "loading" });
  const id = typeof params.id === "string" ? params.id : null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!id) {
        setState({ status: "missing" });
        return;
      }

      const history = await runtime.imageTaskRepository.getHistory(id);
      if (!history) {
        if (!cancelled) {
          setState({ status: "missing" });
        }
        return;
      }

      const imageResults =
        await runtime.imageTaskRepository.listImageResultsForTaskHistory(id);
      if (!cancelled) {
        setState({ status: "ready", history, imageResults });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [id, runtime.imageTaskRepository]);

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
        <Text style={styles.stateTitle}>任务历史不存在</Text>
      </View>
    );
  }

  const { history, imageResults } = state;

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
        <Text style={styles.title}>任务详情</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.statusRow}>
        <Text style={[styles.statusBadge, statusStyle(history.status)]}>
          {statusLabel(history.status)}
        </Text>
        <Text style={styles.metaText}>{formatDateTime(history.createdAt)}</Text>
      </View>
        <Text style={styles.promptText}>
          {getImageTaskSnapshotSummary(history.snapshot)}
        </Text>
      </View>

      {history.snapshot.source === "promptdex" ? (
        <PromptdexSnapshotSections snapshot={history.snapshot} />
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>图片规格</Text>
        <KeyValue label="尺寸" value={history.snapshot.imageSpec.size} />
        <KeyValue label="质量" value={history.snapshot.imageSpec.quality} />
        <KeyValue label="格式" value={history.snapshot.imageSpec.format.toUpperCase()} />
        <KeyValue label="数量" value={String(history.snapshot.imageSpec.n)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>模型配置快照</Text>
        <KeyValue label="类型" value="图片模型" />
        <KeyValue label="模型" value={history.snapshot.modelConfiguration.modelName} />
        <KeyValue label="Base URL" value={history.snapshot.modelConfiguration.baseUrl} />
      </View>

      {history.errorSummary ? (
        <View style={styles.failureSection}>
          <Text style={styles.sectionTitle}>失败摘要</Text>
          <Text style={styles.failureMessage}>{history.errorSummary.message}</Text>
          <KeyValue label="原因" value={history.errorSummary.reason} />
          {history.errorSummary.statusCode ? (
            <KeyValue
              label="HTTP"
              value={String(history.errorSummary.statusCode)}
            />
          ) : null}
          {history.errorSummary.providerCode ? (
            <KeyValue label="平台码" value={history.errorSummary.providerCode} />
          ) : null}
        </View>
      ) : null}

      {history.status === "completed" ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>关联图片</Text>
          {imageResults.length === 0 ? (
            <Text style={styles.metaText}>未找到关联图片结果。</Text>
          ) : (
            imageResults.map((imageResult) => (
              <Pressable
                accessibilityRole="button"
                key={imageResult.id}
                onPress={() =>
                  router.push(
                    `/images/${encodeURIComponent(imageResult.id)}` as never,
                  )
                }
                style={({ pressed }) => [
                  styles.linkRow,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.linkMain}>
                  <Text style={styles.linkTitle}>
                    {formatImageSpec(imageResult)}
                  </Text>
                  <Text style={styles.metaText}>
                    {formatDateTime(imageResult.createdAt)}
                  </Text>
                </View>
                <Ionicons color="#94A3B8" name="chevron-forward" size={18} />
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.keyValueRow}>
      <Text style={styles.keyText}>{label}</Text>
      <Text selectable style={styles.valueText}>
        {value}
      </Text>
    </View>
  );
}

function PromptdexSnapshotSections({
  snapshot,
}: {
  snapshot: PromptdexImageTaskSnapshot;
}) {
  const taskInputRows = getPromptdexTaskInputRows(snapshot);

  return (
    <>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>图鉴条目</Text>
        <KeyValue label="名称" value={snapshot.promptdexEntry.name} />
        <KeyValue
          label="来源"
          value={getPromptdexSourceTypeLabel(snapshot.promptdexEntry.sourceType)}
        />
        <KeyValue
          label="类型"
          value={getPromptdexTaskTypeLabel(snapshot.promptdexEntry.taskType)}
        />
        <Text selectable style={styles.longText}>
          {snapshot.promptdexEntry.description}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>任务输入</Text>
        {taskInputRows.length === 0 ? (
          <Text style={styles.metaText}>未填写模板输入。</Text>
        ) : (
          taskInputRows.map((row) => (
            <KeyValue key={row.name} label={row.name} value={row.value} />
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>完整提示词</Text>
        <Text selectable style={styles.longText}>
          {snapshot.fullPrompt}
        </Text>
      </View>
    </>
  );
}

function statusLabel(status: ImageTaskStatus): string {
  switch (status) {
    case "running":
      return "进行中";
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "unknown":
      return "状态未知";
  }
}

function statusStyle(status: ImageTaskStatus) {
  switch (status) {
    case "completed":
      return styles.completedBadge;
    case "failed":
      return styles.failedBadge;
    case "running":
      return styles.runningBadge;
    case "unknown":
      return styles.unknownBadge;
  }
}

function formatImageSpec(imageResult: ImageResult): string {
  const size =
    imageResult.width && imageResult.height
      ? `${imageResult.width}x${imageResult.height}`
      : "尺寸未知";
  return `${size} · ${imageResult.format.toUpperCase()}`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const styles = StyleSheet.create({
  completedBadge: {
    backgroundColor: "#DCFCE7",
    color: "#166534",
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 32,
  },
  failedBadge: {
    backgroundColor: "#FEE2E2",
    color: "#991B1B",
  },
  failureMessage: {
    color: "#991B1B",
    fontSize: 15,
    lineHeight: 22,
  },
  failureSection: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingTop: 8,
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
  keyText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "700",
    width: 82,
  },
  keyValueRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
  },
  longText: {
    color: "#0F172A",
    fontSize: 14,
    lineHeight: 21,
  },
  linkMain: {
    flex: 1,
    gap: 3,
  },
  linkRow: {
    alignItems: "center",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  linkTitle: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "800",
  },
  metaText: {
    color: "#64748B",
    fontSize: 13,
  },
  pressed: {
    opacity: 0.78,
  },
  promptText: {
    color: "#0F172A",
    fontSize: 16,
    lineHeight: 23,
  },
  runningBadge: {
    backgroundColor: "#DBEAFE",
    color: "#1D4ED8",
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
    gap: 10,
    padding: 16,
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 17,
    fontWeight: "800",
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
    fontWeight: "700",
  },
  statusBadge: {
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  title: {
    color: "#0F172A",
    flex: 1,
    fontSize: 24,
    fontWeight: "800",
  },
  unknownBadge: {
    backgroundColor: "#E2E8F0",
    color: "#475569",
  },
  valueText: {
    color: "#0F172A",
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});
