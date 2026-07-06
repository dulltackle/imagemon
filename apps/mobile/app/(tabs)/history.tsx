import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import {
  getImageTaskSnapshotSummary,
  type ImageResult,
  type ImageTaskHistory,
  type ImageTaskStatus,
} from "../../src/image-tasks";

interface HistoryListItem {
  history: ImageTaskHistory;
  imageResult: ImageResult | null;
  imageUri: string | null;
}

export default function HistoryScreen() {
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const [items, setItems] = useState<HistoryListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function load() {
        setIsLoading(true);
        setError(null);
        try {
          const histories = await runtime.imageTaskRepository.listHistories();
          const nextItems = await Promise.all(
            histories.map(async (history) => {
              const imageResult =
                history.status === "completed"
                  ? (await runtime.imageTaskRepository.listImageResultsForTaskHistory(
                      history.id,
                    ))[0] ?? null
                  : null;
              const imageUri = imageResult
                ? await runtime.imageFileStorage
                    .resolveFileUri(imageResult.filePath)
                    .catch(() => null)
                : null;
              return { history, imageResult, imageUri };
            }),
          );
          if (!cancelled) {
            setItems(nextItems);
          }
        } catch {
          if (!cancelled) {
            setError("加载任务历史失败，请稍后重试。");
          }
        } finally {
          if (!cancelled) {
            setIsLoading(false);
          }
        }
      }

      void load();

      return () => {
        cancelled = true;
      };
    }, [runtime.imageFileStorage, runtime.imageTaskRepository]),
  );

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>历史</Text>
      </View>

      {isLoading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color="#0F766E" />
        </View>
      ) : error ? (
        <View style={styles.stateBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.stateBox}>
          <Text style={styles.emptyText}>暂无任务历史</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.history.id}
              onPress={() =>
                router.push(
                  `/history/${encodeURIComponent(item.history.id)}` as never,
                )
              }
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Thumbnail uri={item.imageUri} />
              <View style={styles.rowMain}>
                <View style={styles.rowHeader}>
                  <Text style={styles.createdAt}>
                    {formatDateTime(item.history.createdAt)}
                  </Text>
                  <Text
                    style={[
                      styles.statusBadge,
                      statusStyle(item.history.status),
                    ]}
                  >
                    {statusLabel(item.history.status)}
                  </Text>
                </View>
                <Text numberOfLines={2} style={styles.promptText}>
                  {getImageTaskSnapshotSummary(item.history.snapshot)}
                </Text>
                <Text style={styles.metaText}>
                  {item.history.snapshot.imageSpec.size}
                </Text>
              </View>
              <Ionicons color="#94A3B8" name="chevron-forward" size={18} />
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Thumbnail({ uri }: { uri: string | null }) {
  if (uri) {
    return <Image source={{ uri }} style={styles.thumbnail} />;
  }
  return (
    <View style={styles.thumbnailPlaceholder}>
      <Ionicons color="#94A3B8" name="image-outline" size={24} />
    </View>
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
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
    gap: 18,
    padding: 20,
    paddingBottom: 32,
  },
  createdAt: {
    color: "#64748B",
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  emptyText: {
    color: "#64748B",
    fontSize: 15,
  },
  errorText: {
    color: "#991B1B",
    fontSize: 15,
  },
  failedBadge: {
    backgroundColor: "#FEE2E2",
    color: "#991B1B",
  },
  header: {
    paddingTop: 8,
  },
  list: {
    gap: 12,
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
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },
  row: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  rowHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  rowMain: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  runningBadge: {
    backgroundColor: "#DBEAFE",
    color: "#1D4ED8",
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
    minHeight: 140,
    justifyContent: "center",
    padding: 20,
  },
  statusBadge: {
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  thumbnail: {
    backgroundColor: "#E2E8F0",
    borderRadius: 8,
    height: 72,
    width: 72,
  },
  thumbnailPlaceholder: {
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  title: {
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "800",
  },
  unknownBadge: {
    backgroundColor: "#E2E8F0",
    color: "#475569",
  },
});
