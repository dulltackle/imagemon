import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";

import { useReadyAppRuntime } from "../app-state";
import {
  getImageTaskSnapshotSummary,
  type ImageResult,
  type ImageResultFileStorage,
} from "../image-tasks";
import { useModelCallLock } from "../model-calls";
import {
  type MergedPromptdexEntryListItem,
  type TemplateRefinementDraftStatus,
} from "./index";
import {
  createPromptdexHomeService,
  getPromptdexHomeEntryKey,
  type PromptdexHomeEntryImage,
  type PromptdexHomeGeneratedEntry,
  type PromptdexHomeOtherImage,
} from "./home";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

interface HydratedPromptdexHomeEntryImage extends PromptdexHomeEntryImage {
  imageUri: string | null;
}

interface HydratedPromptdexHomeGeneratedEntry
  extends Omit<PromptdexHomeGeneratedEntry, "representativeImage"> {
  representativeImage: HydratedPromptdexHomeEntryImage;
}

interface HydratedPromptdexHomeOtherImage extends PromptdexHomeOtherImage {
  imageUri: string | null;
}

interface HydratedPromptdexHome {
  generatedEntries: HydratedPromptdexHomeGeneratedEntry[];
  ungeneratedEntries: MergedPromptdexEntryListItem[];
  otherImages: HydratedPromptdexHomeOtherImage[];
}

type CatalogState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      home: HydratedPromptdexHome;
      refinementDraftStatus: TemplateRefinementDraftStatus | null;
    };

export function PromptdexCatalogScreen() {
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const modelCallLock = useModelCallLock();
  const [state, setState] = useState<CatalogState>({ status: "loading" });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function loadCatalog() {
        setState({ status: "loading" });
        try {
          const homeService = createPromptdexHomeService({
            promptdexCatalogService: runtime.promptdexCatalogService,
            imageTaskRepository: runtime.imageTaskRepository,
          });
          const [home, refinementDraft] = await Promise.all([
            homeService.getHome(),
            runtime.templateRefinementDraftRepository.get(),
          ]);
          const hydratedHome = await hydratePromptdexHomeImages(
            runtime.imageFileStorage,
            home,
          );
          if (!cancelled) {
            setState({
              status: "ready",
              home: hydratedHome,
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
    }, [
      runtime.imageFileStorage,
      runtime.imageTaskRepository,
      runtime.promptdexCatalogService,
      runtime.templateRefinementDraftRepository,
    ]),
  );

  const home = state.status === "ready" ? state.home : null;
  const hasCatalogEntries =
    home !== null &&
    (home.generatedEntries.length > 0 || home.ungeneratedEntries.length > 0);
  const hasAnyImages =
    home !== null &&
    (home.generatedEntries.length > 0 || home.otherImages.length > 0);

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

      {state.status === "ready" && !hasCatalogEntries ? (
        <View style={styles.stateBox}>
          <Ionicons color="#64748B" name="file-tray-outline" size={24} />
          <Text style={styles.stateText}>没有可用的图鉴条目。</Text>
        </View>
      ) : null}

      {state.status === "ready" && hasCatalogEntries ? (
        <>
          <GeneratedEntriesSection
            entries={state.home.generatedEntries}
            onOpenEntry={(entry) =>
              router.push(`/promptdex/${encodeURIComponent(entry.name)}` as never)
            }
            onOpenImage={(imageResult) =>
              router.push(`/images/${encodeURIComponent(imageResult.id)}` as never)
            }
          />
          <UngeneratedEntriesSection
            entries={state.home.ungeneratedEntries}
            onOpenEntry={(entry) =>
              router.push(`/promptdex/${encodeURIComponent(entry.name)}` as never)
            }
          />
        </>
      ) : null}

      {state.status === "ready" &&
      (state.home.otherImages.length > 0 ||
        (hasCatalogEntries && !hasAnyImages)) ? (
        <OtherImagesSection
          items={state.home.otherImages}
          onOpenImage={(imageResult) =>
            router.push(`/images/${encodeURIComponent(imageResult.id)}` as never)
          }
        />
      ) : null}
    </ScrollView>
  );
}

function GeneratedEntriesSection({
  entries,
  onOpenEntry,
  onOpenImage,
}: {
  entries: HydratedPromptdexHomeGeneratedEntry[];
  onOpenEntry(entry: MergedPromptdexEntryListItem): void;
  onOpenImage(imageResult: ImageResult): void;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>已生成图鉴条目</Text>
      <View style={styles.generatedList}>
        {entries.map((item) => (
          <GeneratedEntryCard
            item={item}
            key={getPromptdexHomeEntryKey(item.entry)}
            onOpenEntry={() => onOpenEntry(item.entry)}
            onOpenImage={() => onOpenImage(item.representativeImage.imageResult)}
          />
        ))}
      </View>
    </View>
  );
}

function GeneratedEntryCard({
  item,
  onOpenEntry,
  onOpenImage,
}: {
  item: HydratedPromptdexHomeGeneratedEntry;
  onOpenEntry(): void;
  onOpenImage(): void;
}) {
  const { entry, representativeImage } = item;

  function handleImagePress(event: GestureResponderEvent) {
    event.stopPropagation();
    onOpenImage();
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpenEntry}
      style={({ pressed }) => [
        styles.generatedCard,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.generatedPreviewFrame}>
        {representativeImage.imageUri ? (
          <Image
            resizeMode="cover"
            source={{ uri: representativeImage.imageUri }}
            style={styles.generatedPreview}
          />
        ) : (
          <ImagePlaceholder label="图片文件不可用" />
        )}
        <Pressable
          accessibilityLabel="打开代表图详情"
          accessibilityRole="button"
          onPress={handleImagePress}
          style={({ pressed }) => [
            styles.imageDetailButton,
            pressed && styles.imageDetailButtonPressed,
          ]}
        >
          <Ionicons color="#0F172A" name="image-outline" size={18} />
        </Pressable>
      </View>
      <View style={styles.generatedBody}>
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
        <View style={styles.generatedMetaRow}>
          <Text style={styles.entryMeta}>
            {formatDateTime(representativeImage.imageResult.createdAt)}
          </Text>
          <Ionicons color="#94A3B8" name="chevron-forward" size={18} />
        </View>
      </View>
    </Pressable>
  );
}

function UngeneratedEntriesSection({
  entries,
  onOpenEntry,
}: {
  entries: MergedPromptdexEntryListItem[];
  onOpenEntry(entry: MergedPromptdexEntryListItem): void;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>未生成图鉴条目</Text>
      <View style={styles.list}>
        {entries.map((entry) => (
          <Pressable
            accessibilityRole="button"
            key={getPromptdexHomeEntryKey(entry)}
            onPress={() => onOpenEntry(entry)}
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
    </View>
  );
}

function OtherImagesSection({
  items,
  onOpenImage,
}: {
  items: HydratedPromptdexHomeOtherImage[];
  onOpenImage(imageResult: ImageResult): void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>其他图片</Text>
      {items.length === 0 ? (
        <View style={styles.stateBox}>
          <Ionicons color="#64748B" name="images-outline" size={24} />
          <Text style={styles.stateText}>暂无图片结果。</Text>
        </View>
      ) : (
        <View style={styles.otherImageList}>
          {items.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.imageResult.id}
              onPress={() => onOpenImage(item.imageResult)}
              style={({ pressed }) => [
                styles.otherImageRow,
                pressed && styles.pressed,
              ]}
            >
              {item.imageUri ? (
                <Image
                  resizeMode="cover"
                  source={{ uri: item.imageUri }}
                  style={styles.otherImageThumbnail}
                />
              ) : (
                <View style={styles.otherImagePlaceholder}>
                  <Ionicons color="#94A3B8" name="image-outline" size={22} />
                </View>
              )}
              <View style={styles.entryMain}>
                <Text numberOfLines={1} style={styles.otherImageTitle}>
                  {item.taskHistory
                    ? getImageTaskSnapshotSummary(item.taskHistory.snapshot)
                    : "关联任务不可用"}
                </Text>
                <Text style={styles.entryMeta}>
                  {formatImageSpec(item.imageResult)}
                </Text>
                <Text style={styles.entryMeta}>
                  {formatDateTime(item.imageResult.createdAt)}
                </Text>
              </View>
              <Ionicons color="#94A3B8" name="chevron-forward" size={18} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
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
): {
  icon: IoniconName;
  title: string;
  description: string;
  status: string;
} {
  if (active) {
    return {
      icon: "hourglass-outline",
      title: "模板提炼",
      description: "已有提炼调用正在进行。",
      status: "进行中",
    };
  }

  switch (draftStatus) {
    case "ready_for_review":
      return {
        icon: "document-text-outline",
        title: "模板提炼",
        description: "有一份提炼方案等待确认写入。",
        status: "待审阅",
      };
    case "failed":
      return {
        icon: "alert-circle-outline",
        title: "模板提炼",
        description: "上次提炼失败，可修改输入后重新生成。",
        status: "待处理",
      };
    case "editing_input":
      return {
        icon: "create-outline",
        title: "模板提炼",
        description: "继续编辑未完成的提炼输入。",
        status: "编辑中",
      };
    case null:
      return {
        icon: "sparkles-outline",
        title: "模板提炼",
        description: "从外部完整提示词生成个人图鉴条目。",
        status: "新建",
      };
    default:
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
    <Text
      style={[
        styles.badge,
        taskType === "generate" ? styles.generateBadge : styles.editBadge,
      ]}
    >
      {taskType === "generate" ? "生成" : "编辑"}
    </Text>
  );
}

function ImagePlaceholder({ label }: { label: string }) {
  return (
    <View style={styles.generatedPreviewPlaceholder}>
      <Ionicons color="#94A3B8" name="image-outline" size={30} />
      <Text style={styles.placeholderText}>{label}</Text>
    </View>
  );
}

async function hydratePromptdexHomeImages(
  fileStorage: ImageResultFileStorage,
  home: {
    generatedEntries: PromptdexHomeGeneratedEntry[];
    ungeneratedEntries: MergedPromptdexEntryListItem[];
    otherImages: PromptdexHomeOtherImage[];
  },
): Promise<HydratedPromptdexHome> {
  const [generatedEntries, otherImages] = await Promise.all([
    Promise.all(
      home.generatedEntries.map(async (item) => ({
        ...item,
        representativeImage: await hydrateEntryImage(
          fileStorage,
          item.representativeImage,
        ),
      })),
    ),
    Promise.all(
      home.otherImages.map(async (item) => ({
        ...item,
        imageUri: await resolveImageUri(fileStorage, item.imageResult),
      })),
    ),
  ]);

  return {
    generatedEntries,
    ungeneratedEntries: home.ungeneratedEntries,
    otherImages,
  };
}

async function hydrateEntryImage(
  fileStorage: ImageResultFileStorage,
  image: PromptdexHomeEntryImage,
): Promise<HydratedPromptdexHomeEntryImage> {
  return {
    ...image,
    imageUri: await resolveImageUri(fileStorage, image.imageResult),
  };
}

async function resolveImageUri(
  fileStorage: ImageResultFileStorage,
  imageResult: ImageResult,
): Promise<string | null> {
  return fileStorage.resolveFileUri(imageResult.filePath).catch((error) => {
    console.warn(
      `[promptdex-home] 无法解析图片文件 ${imageResult.filePath}`,
      error,
    );
    return null;
  });
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
  badge: {
    borderRadius: 8,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  builtInSourceBadge: {
    backgroundColor: "#F1F5F9",
    color: "#475569",
  },
  content: {
    gap: 18,
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
    gap: 6,
    minWidth: 0,
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
    minWidth: 0,
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
    flexWrap: "wrap",
    gap: 8,
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
  generatedBody: {
    gap: 10,
    padding: 14,
  },
  generatedCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D1FAE5",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  generatedList: {
    gap: 12,
  },
  generatedMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  generatedPreview: {
    height: "100%",
    width: "100%",
  },
  generatedPreviewFrame: {
    aspectRatio: 16 / 9,
    backgroundColor: "#E2E8F0",
    position: "relative",
    width: "100%",
  },
  generatedPreviewPlaceholder: {
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    flex: 1,
    gap: 8,
    justifyContent: "center",
    padding: 12,
  },
  header: {
    gap: 6,
    paddingTop: 8,
  },
  imageDetailButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderColor: "rgba(15, 23, 42, 0.12)",
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    position: "absolute",
    right: 10,
    top: 10,
    width: 38,
  },
  imageDetailButtonPressed: {
    opacity: 0.76,
  },
  list: {
    gap: 12,
  },
  otherImageList: {
    gap: 10,
  },
  otherImagePlaceholder: {
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  otherImageRow: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 10,
  },
  otherImageThumbnail: {
    backgroundColor: "#E2E8F0",
    borderRadius: 8,
    height: 72,
    width: 72,
  },
  otherImageTitle: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "800",
  },
  personalSourceBadge: {
    backgroundColor: "#EEF2FF",
    color: "#4338CA",
  },
  placeholderText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  pressed: {
    opacity: 0.72,
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
  screen: {
    backgroundColor: "#F8FAFC",
    flex: 1,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
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
