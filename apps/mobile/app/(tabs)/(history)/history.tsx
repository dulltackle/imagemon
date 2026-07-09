import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator } from "react-native";

import { useReadyAppRuntime } from "../../../src/app-state";
import {
  getImageTaskSnapshotSummary,
  type ImageResult,
  type ImageTaskHistory,
  type ImageTaskStatus,
} from "../../../src/image-tasks";
import {
  cn,
  Image,
  Pressable,
  ScrollView,
  SymbolIcon,
  Text,
  useCSSVariable,
  View,
} from "../../../src/tw";

interface HistoryListItem {
  history: ImageTaskHistory;
  imageResult: ImageResult | null;
  imageUri: string | null;
}

export default function HistoryScreen() {
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const accentColor = useCSSVariable("--sf-blue");
  const mutedColor = useCSSVariable("--sf-text-2");
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
                  ? ((
                      await runtime.imageTaskRepository.listImageResultsForTaskHistory(
                        history.id,
                      )
                    )[0] ?? null)
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
    <ScrollView
      className="flex-1 bg-sf-bg-2"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-[18px] p-5 pb-8"
    >
      {isLoading ? (
        <View className="min-h-[140px] items-center justify-center rounded-lg border border-sf-separator bg-sf-bg-3 p-5">
          <ActivityIndicator color={accentColor} />
        </View>
      ) : error ? (
        <View className="min-h-[140px] items-center justify-center rounded-lg border border-sf-separator bg-sf-bg-3 p-5">
          <Text className="text-[15px] text-sf-red" selectable>
            {error}
          </Text>
        </View>
      ) : items.length === 0 ? (
        <View className="min-h-[140px] items-center justify-center rounded-lg border border-sf-separator bg-sf-bg-3 p-5">
          <Text className="text-[15px] text-sf-text-2" selectable>
            暂无任务历史
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {items.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.history.id}
              onPress={() =>
                router.push(
                  `/history/${encodeURIComponent(item.history.id)}` as never,
                )
              }
              className="flex-row items-center gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-3 shadow-sm active:opacity-75"
            >
              <Thumbnail accentColor={accentColor} uri={item.imageUri} />
              <View className="min-w-0 flex-1 gap-[5px]">
                <View className="flex-row items-center gap-2">
                  <Text
                    className="flex-1 text-[13px] font-bold tabular-nums text-sf-text-2"
                    selectable
                  >
                    {formatDateTime(item.history.createdAt)}
                  </Text>
                  <Text
                    className={cn(
                      "overflow-hidden rounded-full px-2 py-[3px] text-xs font-extrabold",
                      statusClassName(item.history.status),
                    )}
                    selectable
                  >
                    {statusLabel(item.history.status)}
                  </Text>
                </View>
                <Text
                  className="text-[15px] font-bold leading-[21px] text-sf-text"
                  numberOfLines={2}
                  selectable
                >
                  {getImageTaskSnapshotSummary(item.history.snapshot)}
                </Text>
                <Text className="text-[13px] text-sf-text-2" selectable>
                  {item.history.snapshot.imageSpec.size}
                </Text>
              </View>
              <SymbolIcon
                className="h-[18px] w-[18px]"
                name="chevron.right"
                tintColor={mutedColor}
              />
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Thumbnail({
  accentColor,
  uri,
}: {
  accentColor: string;
  uri: string | null;
}) {
  if (uri) {
    return (
      <Image
        className="h-[72px] w-[72px] rounded-lg bg-sf-fill object-cover"
        source={{ uri }}
      />
    );
  }
  return (
    <View className="h-[72px] w-[72px] items-center justify-center rounded-lg border border-sf-separator bg-sf-fill">
      <SymbolIcon className="h-6 w-6" name="photo" tintColor={accentColor} />
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

function statusClassName(status: ImageTaskStatus) {
  switch (status) {
    case "completed":
      return "bg-sf-fill text-sf-green";
    case "failed":
      return "bg-sf-fill text-sf-red";
    case "running":
      return "bg-sf-fill text-sf-blue";
    case "unknown":
      return "bg-sf-fill text-sf-text-2";
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
