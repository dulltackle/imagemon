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
import { Badge } from "../../../src/ui/Badge";
import { MediaFrame } from "../../../src/ui/MediaFrame";
import { ScreenScrollView } from "../../../src/ui/ScreenCanvas";
import {
  SCROLL_PRESS_FEEDBACK_DELAY_MS,
} from "../../../src/ui/scroll-press-feedback";
import { Surface } from "../../../src/ui/Surface";
import { SymbolIcon, Text, useCSSVariable, View } from "../../../src/tw";

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
  const actionColor = useCSSVariable("--app-action");
  const mutedColor = useCSSVariable("--app-ink-muted");
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
        latestRefreshSignalsRef.current.attentionSnapshot === attentionSnapshot;

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
    <ScreenScrollView variant="tool">
      {isLoading ? (
        <Surface variant="feedback">
          <View className="min-h-[108px] items-center justify-center">
            <ActivityIndicator color={actionColor} />
          </View>
        </Surface>
      ) : error ? (
        <Surface tone="danger" variant="feedback">
          <View className="min-h-[108px] items-center justify-center">
            <Text
              className="text-center text-[15px] leading-[21px] text-app-danger"
            >
              {error}
            </Text>
          </View>
        </Surface>
      ) : items.length === 0 ? (
        <Surface variant="feedback">
          <View className="min-h-[108px] items-center justify-center">
            <Text
              className="text-center text-[15px] leading-[21px] text-app-ink-muted"
            >
              暂无任务历史
            </Text>
          </View>
        </Surface>
      ) : (
        <View className="gap-3">
          {items.map((item) => {
            const attention = attentionSnapshot.imageTasks.get(item.history.id);
            return (
              <Surface
                accessibilityLabel={getHistoryListItemAccessibilityLabel(
                  item,
                  attention?.kind ?? null,
                )}
                key={item.history.id}
                onPress={() =>
                  router.push(
                    `/history/${encodeURIComponent(item.history.id)}` as never,
                  )
                }
                pressFeedbackDelayMs={SCROLL_PRESS_FEEDBACK_DELAY_MS}
                variant="interactive"
              >
                <View className="flex-row items-center gap-3 p-3">
                  <Thumbnail uri={item.imageUri} />
                  <View className="min-w-0 flex-1 gap-[5px]">
                    <View className="flex-row items-center gap-2">
                      <Text
                        className="flex-1 text-[13px] font-bold leading-[18px] tabular-nums text-app-ink-muted"
                      >
                        {formatLocalDateTime(item.history.createdAt)}
                      </Text>
                      {attention ? (
                        <AttentionBadge kind={attention.kind} />
                      ) : null}
                      <StatusBadge status={item.history.status} />
                    </View>
                    <Text
                      className="text-[15px] font-bold leading-[21px] text-app-ink"
                      numberOfLines={2}
                    >
                      {getImageTaskSnapshotSummary(item.history.snapshot)}
                    </Text>
                    <Text
                      className="text-[13px] leading-[18px] text-app-ink-muted"
                    >
                      {item.history.snapshot.imageSpec.size}
                    </Text>
                  </View>
                  <SymbolIcon
                    className="h-[18px] w-[18px]"
                    name="chevron-right"
                    tintColor={mutedColor}
                  />
                </View>
              </Surface>
            );
          })}
        </View>
      )}
    </ScreenScrollView>
  );
}

function getHistoryListItemAccessibilityLabel(
  item: HistoryListItem,
  attentionKind: BusinessCallAttentionKind | null,
): string {
  const attentionLabel = attentionKind
    ? `，${getImageTaskAttentionLabel(attentionKind)}`
    : "";
  return `查看任务历史：${getImageTaskSnapshotSummary(item.history.snapshot)}，${statusLabel(item.history.status)}${attentionLabel}，${formatLocalDateTime(item.history.createdAt)}`;
}

function AttentionBadge({ kind }: { kind: BusinessCallAttentionKind }) {
  return (
    <Badge variant={attentionBadgeVariant(kind)}>
      {getImageTaskAttentionLabel(kind)}
    </Badge>
  );
}

function attentionBadgeVariant(
  kind: BusinessCallAttentionKind,
): "success" | "warning" | "danger" {
  switch (kind) {
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "uncertain":
      return "warning";
  }
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
    <Badge variant={statusBadgeVariant(status)}>{statusLabel(status)}</Badge>
  );
}

function statusBadgeVariant(
  status: ImageTaskStatus,
): "success" | "brand" | "warning" | "danger" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "running":
      return "brand";
    case "unknown":
      return "warning";
  }
}
