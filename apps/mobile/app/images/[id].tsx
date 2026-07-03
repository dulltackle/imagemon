import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
import type { ImageResult, ImageTaskHistory } from "../../src/image-tasks";

type ImageDetailState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error" }
  | {
      status: "ready";
      imageResult: ImageResult;
      imageUri: string | null;
      history: ImageTaskHistory | null;
    };

export default function ImageDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const runtime = useReadyAppRuntime();
  const [state, setState] = useState<ImageDetailState>({ status: "loading" });
  const id = typeof params.id === "string" ? params.id : null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!id) {
        setState({ status: "missing" });
        return;
      }

      try {
        const imageResult = await runtime.imageTaskRepository.getImageResult(id);
        if (!imageResult) {
          if (!cancelled) {
            setState({ status: "missing" });
          }
          return;
        }

        const [imageUri, history] = await Promise.all([
          runtime.imageFileStorage
            .resolveFileUri(imageResult.filePath)
            .catch(() => null),
          imageResult.taskHistoryId
            ? runtime.imageTaskRepository.getHistory(imageResult.taskHistoryId)
            : Promise.resolve(null),
        ]);

        if (!cancelled) {
          setState({ status: "ready", imageResult, imageUri, history });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [id, runtime.imageFileStorage, runtime.imageTaskRepository]);

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
        <Text style={styles.stateTitle}>图片结果不存在</Text>
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.stateScreen}>
        <Text style={styles.stateTitle}>加载失败，请返回重试</Text>
      </View>
    );
  }

  const { history, imageResult, imageUri } = state;
  const aspectRatio =
    imageResult.width && imageResult.height
      ? imageResult.width / imageResult.height
      : 1;

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
        <Text style={styles.title}>图片详情</Text>
      </View>

      {imageUri ? (
        <Image
          resizeMode="contain"
          source={{ uri: imageUri }}
          style={[styles.preview, { aspectRatio }]}
        />
      ) : (
        <View style={styles.previewPlaceholder}>
          <Ionicons color="#94A3B8" name="image-outline" size={40} />
          <Text style={styles.metaText}>图片文件不可用</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>基础规格</Text>
        <KeyValue label="创建时间" value={formatDateTime(imageResult.createdAt)} />
        <KeyValue label="格式" value={imageResult.format.toUpperCase()} />
        <KeyValue label="尺寸" value={formatImageSize(imageResult)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>关联历史</Text>
        {history ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push(`/history/${encodeURIComponent(history.id)}` as never)
            }
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          >
            <View style={styles.linkMain}>
              <Text numberOfLines={2} style={styles.linkTitle}>
                {history.snapshot.prompt}
              </Text>
              <Text style={styles.metaText}>{formatDateTime(history.createdAt)}</Text>
            </View>
            <Ionicons color="#94A3B8" name="chevron-forward" size={18} />
          </Pressable>
        ) : (
          <Text style={styles.metaText}>未找到关联任务历史。</Text>
        )}
      </View>
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

function formatImageSize(imageResult: ImageResult): string {
  return imageResult.width && imageResult.height
    ? `${imageResult.width}x${imageResult.height}`
    : "尺寸未知";
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
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 32,
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
  linkMain: {
    flex: 1,
    gap: 4,
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
    lineHeight: 21,
  },
  metaText: {
    color: "#64748B",
    fontSize: 13,
  },
  pressed: {
    opacity: 0.78,
  },
  preview: {
    alignSelf: "center",
    backgroundColor: "#E2E8F0",
    borderRadius: 8,
    maxHeight: 520,
    width: "100%",
  },
  previewPlaceholder: {
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    minHeight: 260,
    justifyContent: "center",
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
  title: {
    color: "#0F172A",
    flex: 1,
    fontSize: 24,
    fontWeight: "800",
  },
  valueText: {
    color: "#0F172A",
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});
