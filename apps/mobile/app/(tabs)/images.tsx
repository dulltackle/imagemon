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
} from "../../src/image-tasks";

interface ImageListItem {
  imageResult: ImageResult;
  history: ImageTaskHistory | null;
  imageUri: string | null;
}

export default function ImagesScreen() {
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const [items, setItems] = useState<ImageListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function load() {
        setIsLoading(true);
        setError(null);
        try {
          const imageResults = await runtime.imageTaskRepository.listImageResults();
          const nextItems = await Promise.all(
            imageResults.map(async (imageResult) => {
              const history = imageResult.taskHistoryId
                ? await runtime.imageTaskRepository.getHistory(imageResult.taskHistoryId)
                : null;
              const imageUri = await runtime.imageFileStorage
                .resolveFileUri(imageResult.filePath)
                .catch(() => null);
              return { imageResult, history, imageUri };
            }),
          );
          if (!cancelled) {
            setItems(nextItems);
          }
        } catch {
          if (!cancelled) {
            setError("加载图片结果失败，请稍后重试。");
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
        <Text style={styles.title}>图片</Text>
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
          <Text style={styles.emptyText}>暂无图片结果</Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {items.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.imageResult.id}
              onPress={() =>
                router.push(
                  `/images/${encodeURIComponent(item.imageResult.id)}` as never,
                )
              }
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              {item.imageUri ? (
                <Image source={{ uri: item.imageUri }} style={styles.thumbnail} />
              ) : (
                <View style={styles.thumbnailPlaceholder}>
                  <Ionicons color="#94A3B8" name="image-outline" size={28} />
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.createdAt}>
                  {formatDateTime(item.imageResult.createdAt)}
                </Text>
                <Text numberOfLines={2} style={styles.promptText}>
                  {item.history
                    ? getImageTaskSnapshotSummary(item.history.snapshot)
                    : "关联任务不可用"}
                </Text>
                <Text style={styles.metaText}>
                  {formatImageSpec(item.imageResult)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
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
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
  },
  cardBody: {
    gap: 5,
    padding: 12,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 32,
  },
  createdAt: {
    color: "#64748B",
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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  header: {
    paddingTop: 8,
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
  thumbnail: {
    aspectRatio: 1,
    backgroundColor: "#E2E8F0",
    width: "100%",
  },
  thumbnailPlaceholder: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    width: "100%",
  },
  title: {
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "800",
  },
});
