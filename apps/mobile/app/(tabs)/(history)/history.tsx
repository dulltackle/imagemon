import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator } from "react-native";

import { useReadyAppRuntime } from "../../../src/app-state";
import {
  getImageTaskAttentionLabel,
  useBusinessCallAttentionSnapshot,
  type BusinessCallAttentionKind,
} from "../../../src/business-call-attentions";
import { formatLocalDateTime } from "../../../src/formatters/date-time";
import {
  getImageTaskSnapshotSummary,
  type ImageResult,
  type ImageTaskHistory,
  type ImageTaskStatus,
} from "../../../src/image-tasks";
import { useModelCallLock } from "../../../src/model-calls";
import { MediaFrame } from "../../../src/ui/MediaFrame";
import {
  cn,
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
  const attentionSnapshot = useBusinessCallAttentionSnapshot();
  const modelCallLock = useModelCallLock();
  const accentColor = useCSSVariable("--sf-blue");
  const mutedColor = useCSSVariable("--sf-text-2");
  const [items, setItems] = useState<HistoryListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const activeImageCallId =
    modelCallLock.activeCall?.type === "imageGeneration" ||
    modelCallLock.activeCall?.type === "imageEdit"
      ? modelCallLock.activeCall.id
      : null;
  const latestRefreshSignalsRef = useRef({
    activeImageCallId,
    attentionSnapshot,
  });
  latestRefreshSignalsRef.current = {
    activeImageCallId,
    attentionSnapshot,
  };
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const requestId = ++loadRequestIdRef.current;
      const isCurrentRequest = () =>
        !cancelled &&
        loadRequestIdRef.current === requestId &&
        latestRefreshSignalsRef.current.activeImageCallId ===
          activeImageCallId &&
        latestRefreshSignalsRef.current.attentionSnapshot ===
          attentionSnapshot;

      async function load() {
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
          if (isCurrentRequest()) {
            setItems(nextItems);
          }
        } catch {
          if (isCurrentRequest()) {
            setError("加载任务历史失败，请稍后重试。");
          }
        } finally {
          if (isCurrentRequest()) {
            setIsLoading(false);
          }
        }
      }

      void load();

      return () => {
        cancelled = true;
      };
    }, [
      activeImageCallId,
      attentionSnapshot,
      runtime.imageFileStorage,
      runtime.imageTaskRepository,
    ]),
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
          {items.map((item) => {
            const attention = attentionSnapshot.imageTasks.get(
              item.history.id,
            );
            return (
              <Pressable
                accessibilityRole="button"
                key={item.history.id}
                onPress={() =>
                  router.push(
                    `/history/${encodeURIComponent(item.history.id)}` as never,
                  )
                }
                className="flex-row items-center gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-3 shadow-sm"
              >
                <Thumbnail uri={item.imageUri} />
                <View className="min-w-0 flex-1 gap-[5px]">
                  <View className="flex-row items-center gap-2">
                    <Text
                      className="flex-1 text-[13px] font-bold leading-[18px] tabular-nums text-sf-text-2"
                      selectable
                    >
                      {formatLocalDateTime(item.history.createdAt)}
                    </Text>
                    {attention ? (
                      <AttentionBadge kind={attention.kind} />
                    ) : null}
                    <StatusBadge status={item.history.status} />
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
                  name="chevron-right"
                  tintColor={mutedColor}
                />
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function AttentionBadge({ kind }: { kind: BusinessCallAttentionKind }) {
  return (
    <View className="min-h-[22px] shrink-0 items-center justify-center rounded-full bg-sf-fill px-2">
      <Text
        className={cn(
          "text-xs font-extrabold leading-4",
          kind === "succeeded" ? "text-sf-blue" : "text-sf-orange",
        )}
        selectable
      >
        {getImageTaskAttentionLabel(kind)}
      </Text>
    </View>
  );
}

function Thumbnail({ uri }: { uri: string | null }) {
  return (
    <MediaFrame
      accessibilityLabel="任务结果缩略图"
      placeholderLabel="图片不可用"
      thumbnailSize={72}
      uri={uri}
      variant="thumbnail"
    />
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

function StatusBadge({ status }: { status: ImageTaskStatus }) {
  return (
    <View className="min-h-[22px] shrink-0 items-center justify-center rounded-full bg-sf-fill px-2">
      <Text
        className={cn(
          "text-xs font-extrabold leading-4",
          statusTextClassName(status),
        )}
        selectable
      >
        {statusLabel(status)}
      </Text>
    </View>
  );
}

function statusTextClassName(status: ImageTaskStatus) {
  switch (status) {
    case "completed":
      return "text-sf-green";
    case "failed":
      return "text-sf-red";
    case "running":
      return "text-sf-blue";
    case "unknown":
      return "text-sf-text-2";
  }
}
