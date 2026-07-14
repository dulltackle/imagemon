import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, useWindowDimensions } from "react-native";

import { useReadyAppRuntime } from "../app-state";
import {
  hasSucceededImageTaskAttention,
  useBusinessCallAttentionSnapshot,
  type BusinessCallAttentionKind,
  type BusinessCallAttentionSnapshot,
} from "../business-call-attentions";
import { formatLocalDateTime } from "../formatters/date-time";
import {
  getImageTaskSnapshotSummary,
  type ImageResult,
  type ImageResultFileStorage,
} from "../image-tasks";
import {
  getPromptdexEntryModelCallOwnerKey,
  TEMPLATE_REFINEMENT_MODEL_CALL_OWNER_KEY,
  type ActiveModelCall,
  type ModelCallType,
  useModelCallLock,
} from "../model-calls";
import {
  type MergedPromptdexEntryListItem,
  type TemplateRefinementDraftStatus,
} from "./index";
import {
  beginPromptdexCatalogRefresh,
  failPromptdexCatalogRefresh,
  getPromptdexCatalogRefreshFailureMessage,
} from "./catalog-refresh-state";
import {
  createPromptdexHomeService,
  getPromptdexHomeEntryKey,
  type PromptdexHomeEntryImage,
  type PromptdexHomeGeneratedEntry,
  type PromptdexHomeOtherImage,
} from "./home";
import { getTemplateRefinementEntryPresentation } from "./refinement-entry-presentation";
import {
  Pressable,
  SymbolIcon,
  Text,
  useCSSVariable,
  View,
} from "../tw";
import { Badge, type BadgeVariant } from "../ui/Badge";
import { MediaFrame } from "../ui/MediaFrame";
import { ScreenScrollView } from "../ui/ScreenCanvas";
import { SectionTitle } from "../ui/SectionTitle";
import { Surface } from "../ui/Surface";
import { WatercolorBackdrop } from "../ui/WatercolorBackdrop";

interface HydratedPromptdexHomeEntryImage extends PromptdexHomeEntryImage {
  imageUri: string | null;
}

interface HydratedPromptdexHomeGeneratedEntry extends Omit<
  PromptdexHomeGeneratedEntry,
  "representativeImage"
> {
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

type CatalogEntryStatus = "进行中" | "待查看";

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
  const { width: windowWidth } = useWindowDimensions();
  const runtime = useReadyAppRuntime();
  const modelCallLock = useModelCallLock();
  const attentionSnapshot = useBusinessCallAttentionSnapshot();
  const actionColor = useCSSVariable("--app-action");
  const dangerColor = useCSSVariable("--app-danger");
  const mutedColor = useCSSVariable("--app-ink-muted");
  const [state, setState] = useState<CatalogState>({ status: "loading" });
  const stateRef = useRef<CatalogState>(state);
  const activeBusinessCallId = isCatalogBusinessCallType(
    modelCallLock.activeCall?.type,
  )
    ? modelCallLock.activeCall?.id
    : null;
  const activeBusinessCallIdRef = useRef(activeBusinessCallId);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    activeBusinessCallIdRef.current = activeBusinessCallId;
  }, [activeBusinessCallId]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const expectedBusinessCallId = activeBusinessCallId;

      async function loadCatalog() {
        setState((current) => beginPromptdexCatalogRefresh(current));
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
          if (
            !cancelled &&
            activeBusinessCallIdRef.current === expectedBusinessCallId
          ) {
            setState({
              status: "ready",
              home: hydratedHome,
              refinementDraftStatus: refinementDraft?.status ?? null,
            });
          }
        } catch (error) {
          if (
            !cancelled &&
            activeBusinessCallIdRef.current === expectedBusinessCallId
          ) {
            const message = getPromptdexCatalogRefreshFailureMessage(error);
            if (stateRef.current.status === "ready") {
              console.warn("[promptdex-home] 后台刷新失败", error);
            }
            setState((current) => failPromptdexCatalogRefresh(current, message));
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
      activeBusinessCallId,
    ]),
  );

  const home = state.status === "ready" ? state.home : null;
  const hasCatalogEntries =
    home !== null &&
    (home.generatedEntries.length > 0 || home.ungeneratedEntries.length > 0);
  const hasAnyImages =
    home !== null &&
    (home.generatedEntries.length > 0 || home.otherImages.length > 0);
  const isCompletelyEmpty =
    home !== null &&
    home.generatedEntries.length === 0 &&
    home.ungeneratedEntries.length === 0 &&
    home.otherImages.length === 0;

  return (
    <ScreenScrollView variant="brand">
      {state.status === "ready" ? (
        <PromptdexRefinementEntry
          active={
            modelCallLock.activeCall?.type === "templateRefinement" &&
            modelCallLock.activeCall.ownerKey ===
            TEMPLATE_REFINEMENT_MODEL_CALL_OWNER_KEY
          }
          attentionKind={attentionSnapshot.templateRefinement?.kind ?? null}
          draftStatus={state.refinementDraftStatus}
          includeWarmAccent={!isCompletelyEmpty}
          onPress={() => router.push("/promptdex/refine" as never)}
        />
      ) : null}

      {state.status === "loading" ? (
        <Surface variant="feedback">
          <View className="items-center gap-2.5">
            <ActivityIndicator color={actionColor} />
            <Text
              className="text-center text-sm leading-5 text-app-ink-muted"
              selectable
            >
              正在加载图鉴。
            </Text>
          </View>
        </Surface>
      ) : null}

      {state.status === "failed" ? (
        <Surface tone="danger" variant="feedback">
          <View className="flex-row items-start gap-2.5">
            <SymbolIcon
              className="h-5 w-5"
              name="warning"
              tintColor={dangerColor}
            />
            <Text className="flex-1 text-sm leading-5 text-app-ink" selectable>
              {state.message}
            </Text>
          </View>
        </Surface>
      ) : null}

      {state.status === "ready" && !hasCatalogEntries ? (
        <Surface variant="feedback">
          <View className="items-center gap-2.5">
            {isCompletelyEmpty ? (
              <View
                className={
                  windowWidth >= 700
                    ? "relative h-[180px] w-[180px]"
                    : "relative h-40 w-40"
                }
              >
                <WatercolorBackdrop variant="emptyState" />
              </View>
            ) : (
              <SymbolIcon
                className="h-6 w-6"
                name="empty-tray"
                tintColor={mutedColor}
              />
            )}
            <Text
              className="text-center text-sm leading-5 text-app-ink-muted"
              selectable
            >
              没有可用的图鉴条目。
            </Text>
          </View>
        </Surface>
      ) : null}

      {state.status === "ready" && hasCatalogEntries ? (
        <>
          <GeneratedEntriesSection
            activeImageEntryOwnerKey={getActiveImageEntryOwnerKey(
              modelCallLock.activeCall,
            )}
            attentionSnapshot={attentionSnapshot}
            entries={state.home.generatedEntries}
            useHorizontalCards={windowWidth >= 700}
            onOpenEntry={(entry) =>
              router.push(
                `/promptdex/${encodeURIComponent(entry.name)}` as never,
              )
            }
            onOpenImage={(imageResult) =>
              router.push(
                `/images/${encodeURIComponent(imageResult.id)}` as never,
              )
            }
          />
          <UngeneratedEntriesSection
            activeImageEntryOwnerKey={getActiveImageEntryOwnerKey(
              modelCallLock.activeCall,
            )}
            entries={state.home.ungeneratedEntries}
            onOpenEntry={(entry) =>
              router.push(
                `/promptdex/${encodeURIComponent(entry.name)}` as never,
              )
            }
          />
        </>
      ) : null}

      {state.status === "ready" &&
      (state.home.otherImages.length > 0 ||
        (hasCatalogEntries && !hasAnyImages)) ? (
        <OtherImagesSection
          attentionSnapshot={attentionSnapshot}
          items={state.home.otherImages}
          onOpenImage={(imageResult) =>
            router.push(
              `/images/${encodeURIComponent(imageResult.id)}` as never,
            )
          }
        />
      ) : null}
    </ScreenScrollView>
  );
}

function GeneratedEntriesSection({
  activeImageEntryOwnerKey,
  attentionSnapshot,
  entries,
  useHorizontalCards,
  onOpenEntry,
  onOpenImage,
}: {
  activeImageEntryOwnerKey: string | null;
  attentionSnapshot: BusinessCallAttentionSnapshot;
  entries: HydratedPromptdexHomeGeneratedEntry[];
  useHorizontalCards: boolean;
  onOpenEntry(entry: MergedPromptdexEntryListItem): void;
  onOpenImage(imageResult: ImageResult): void;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <View className="gap-2.5">
      <SectionTitle>已生成图鉴条目</SectionTitle>
      <View className="gap-3">
        {entries.map((item) => (
          <GeneratedEntryCard
            status={getEntryAttentionStatus(
              item,
              attentionSnapshot,
              activeImageEntryOwnerKey,
            )}
            item={item}
            key={getPromptdexHomeEntryKey(item.entry)}
            onOpenEntry={() => onOpenEntry(item.entry)}
            onOpenImage={() =>
              onOpenImage(item.representativeImage.imageResult)
            }
            useHorizontalLayout={useHorizontalCards}
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
  status,
  useHorizontalLayout,
}: {
  item: HydratedPromptdexHomeGeneratedEntry;
  onOpenEntry(): void;
  onOpenImage(): void;
  status: CatalogEntryStatus | null;
  useHorizontalLayout: boolean;
}) {
  const { entry, representativeImage } = item;
  const iconColor = useCSSVariable("--app-ink");
  const mutedColor = useCSSVariable("--app-ink-muted");
  const imageActionPosition = useHorizontalLayout
    ? {
        left:
          GENERATED_CARD_PADDING +
          GENERATED_CARD_HORIZONTAL_IMAGE_WIDTH -
          GENERATED_CARD_IMAGE_ACTION_INSET -
          GENERATED_CARD_IMAGE_ACTION_SIZE,
        top: GENERATED_CARD_PADDING + GENERATED_CARD_IMAGE_ACTION_INSET,
      }
    : {
        right: GENERATED_CARD_PADDING + GENERATED_CARD_IMAGE_ACTION_INSET,
        top: GENERATED_CARD_PADDING + GENERATED_CARD_IMAGE_ACTION_INSET,
      };

  return (
    <View className="relative">
      <Surface
        accessibilityLabel={`打开图鉴条目 ${entry.name}`}
        onPress={onOpenEntry}
        variant="interactive"
      >
        <View
          className={
            useHorizontalLayout
              ? "relative flex-row items-stretch gap-4 p-4"
              : "relative gap-3 p-4"
          }
        >
          <View
            className={
              useHorizontalLayout
                ? "relative w-[280px] shrink-0"
                : "relative w-full"
            }
          >
            <MediaFrame
              accessibilityLabel={`${entry.name}的代表图`}
              placeholderLabel="图片文件不可用"
              uri={representativeImage.imageUri}
              variant="card"
            />
          </View>
          <View className="min-w-0 flex-1 gap-2.5">
            <EntryTitleBlock entry={entry} />
            {status ? (
              <View className="self-start">
                <CatalogStatusBadge label={status} />
              </View>
            ) : null}
            <Text
              className="text-sm leading-5 text-app-ink-muted"
              numberOfLines={2}
              selectable
            >
              {entry.description}
            </Text>
            <View className="mt-auto flex-row items-center justify-between gap-2.5">
              <Text
                className="text-[13px] font-bold leading-[18px] tabular-nums text-app-ink-muted"
                selectable
              >
                {formatLocalDateTime(representativeImage.imageResult.createdAt)}
              </Text>
              <SymbolIcon
                className="h-[18px] w-[18px]"
                name="chevron-right"
                tintColor={mutedColor}
              />
            </View>
          </View>
        </View>
      </Surface>
      <Pressable
        accessibilityLabel="打开代表图详情"
        accessibilityRole="button"
        className="absolute z-10 h-11 w-11 items-center justify-center rounded-[14px] border border-app-stroke bg-app-surface-raised active:bg-app-action-soft"
        onPress={onOpenImage}
        style={imageActionPosition}
      >
        <SymbolIcon
          className="h-[18px] w-[18px]"
          name="photo"
          tintColor={iconColor}
        />
      </Pressable>
    </View>
  );
}

const GENERATED_CARD_PADDING = 16;
const GENERATED_CARD_HORIZONTAL_IMAGE_WIDTH = 280;
const GENERATED_CARD_IMAGE_ACTION_INSET = 10;
const GENERATED_CARD_IMAGE_ACTION_SIZE = 44;

function UngeneratedEntriesSection({
  activeImageEntryOwnerKey,
  entries,
  onOpenEntry,
}: {
  activeImageEntryOwnerKey: string | null;
  entries: MergedPromptdexEntryListItem[];
  onOpenEntry(entry: MergedPromptdexEntryListItem): void;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <View className="gap-2.5">
      <SectionTitle>未生成图鉴条目</SectionTitle>
      <View className="gap-3">
        {entries.map((entry) => (
          <Surface
            accessibilityLabel={`打开图鉴条目 ${entry.name}`}
            key={getPromptdexHomeEntryKey(entry)}
            onPress={() => onOpenEntry(entry)}
            variant="interactive"
          >
            <View className="flex-row items-center gap-3 p-3.5">
              <View className="min-w-0 flex-1 gap-1.5">
                <EntryTitleBlock entry={entry} />
                <Text
                  className="text-sm leading-5 text-app-ink-muted"
                  numberOfLines={2}
                  selectable
                >
                  {entry.description}
                </Text>
                <Text
                  className="text-[13px] font-bold leading-[18px] text-app-ink-muted"
                  selectable
                >
                  {entry.executionState === "executable"
                    ? "可执行"
                    : "蒙版编辑后续支持"}
                </Text>
              </View>
              {activeImageEntryOwnerKey ===
              getPromptdexEntryModelCallOwnerKey(entry.name) ? (
                <CatalogStatusBadge label="进行中" />
              ) : null}
              <ChevronIcon />
            </View>
          </Surface>
        ))}
      </View>
    </View>
  );
}

function OtherImagesSection({
  attentionSnapshot,
  items,
  onOpenImage,
}: {
  attentionSnapshot: BusinessCallAttentionSnapshot;
  items: HydratedPromptdexHomeOtherImage[];
  onOpenImage(imageResult: ImageResult): void;
}) {
  const mutedColor = useCSSVariable("--app-ink-muted");

  return (
    <View className="gap-2.5">
      <SectionTitle>其他图片</SectionTitle>
      {items.length === 0 ? (
        <Surface variant="feedback">
          <View className="items-center gap-2.5">
            <SymbolIcon
              className="h-6 w-6"
              name="photos"
              tintColor={mutedColor}
            />
            <Text
              className="text-center text-sm leading-5 text-app-ink-muted"
              selectable
            >
              暂无图片结果。
            </Text>
          </View>
        </Surface>
      ) : (
        <View className="gap-2.5">
          {items.map((item) => (
            <Surface
              accessibilityLabel="打开其他图片"
              key={item.imageResult.id}
              onPress={() => onOpenImage(item.imageResult)}
              variant="interactive"
            >
              <View className="flex-row items-center gap-3 p-2.5">
                <MediaFrame
                  accessibilityLabel="其他生成图片缩略图"
                  placeholderLabel="图片不可用"
                  thumbnailSize={72}
                  uri={item.imageUri}
                  variant="thumbnail"
                />
                <View className="min-w-0 flex-1 gap-1.5">
                  <Text
                    className="text-[15px] font-bold leading-[21px] text-app-ink"
                    numberOfLines={1}
                    selectable
                  >
                    {item.taskHistory
                      ? getImageTaskSnapshotSummary(item.taskHistory.snapshot)
                      : "关联任务不可用"}
                  </Text>
                  <Text
                    className="text-[13px] font-bold leading-[18px] text-app-ink-muted"
                    selectable
                  >
                    {formatImageSpec(item.imageResult)}
                  </Text>
                  <Text
                    className="text-[13px] font-bold leading-[18px] tabular-nums text-app-ink-muted"
                    selectable
                  >
                    {formatLocalDateTime(item.imageResult.createdAt)}
                  </Text>
                </View>
                {item.taskHistory &&
                hasSucceededImageTaskAttention(attentionSnapshot, [
                  item.taskHistory.id,
                ]) ? (
                  <CatalogStatusBadge label="待查看" />
                ) : null}
                <ChevronIcon />
              </View>
            </Surface>
          ))}
        </View>
      )}
    </View>
  );
}

function PromptdexRefinementEntry({
  active,
  attentionKind,
  draftStatus,
  includeWarmAccent,
  onPress,
}: {
  active: boolean;
  attentionKind: BusinessCallAttentionKind | null;
  draftStatus: TemplateRefinementDraftStatus | null;
  includeWarmAccent: boolean;
  onPress: () => void;
}) {
  const presentation = getTemplateRefinementEntryPresentation(
    active,
    attentionKind,
    draftStatus,
  );
  const showWatercolor =
    !active &&
    attentionKind === null &&
    (draftStatus === null || draftStatus === "editing_input");
  const actionColor = useCSSVariable("--app-action");
  return (
    <Surface
      accessibilityLabel={`${presentation.title}。${presentation.description}${presentation.status}`}
      onPress={onPress}
      variant="brand"
    >
      {showWatercolor ? (
        <WatercolorBackdrop variant="catalogCool" />
      ) : null}
      {showWatercolor && includeWarmAccent ? (
        <WatercolorBackdrop variant="catalogWarm" />
      ) : null}
      <View className="relative z-10 flex-row items-center gap-3">
        <View className="h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-app-action-soft">
          <SymbolIcon
            className="h-6 w-6"
            name={presentation.icon}
            tintColor={actionColor}
          />
        </View>
        <View className="min-w-0 flex-1 gap-1.5">
          <Text
            className="text-base font-bold leading-[22px] text-app-ink"
            selectable
          >
            {presentation.title}
          </Text>
          <Text className="text-sm leading-5 text-app-ink-muted" selectable>
            {presentation.description}
          </Text>
        </View>
        <View className="shrink-0 items-end gap-2">
          <CatalogStatusBadge label={presentation.status} />
          <ChevronIcon />
        </View>
      </View>
    </Surface>
  );
}

function CatalogStatusBadge({ label }: { label: string }) {
  return <Badge variant={getStatusBadgeVariant(label)}>{label}</Badge>;
}

function getStatusBadgeVariant(label: string): BadgeVariant {
  switch (label) {
    case "待处理":
      return "danger";
    case "待查看":
    case "待审阅":
    case "待确认":
      return "warning";
    case "进行中":
    case "编辑中":
    case "新建":
      return "brand";
    default:
      return "success";
  }
}

function getEntryAttentionStatus(
  item: PromptdexHomeGeneratedEntry,
  attentionSnapshot: BusinessCallAttentionSnapshot,
  activeImageEntryOwnerKey: string | null,
): CatalogEntryStatus | null {
  if (
    activeImageEntryOwnerKey ===
    getPromptdexEntryModelCallOwnerKey(item.entry.name)
  ) {
    return "进行中";
  }
  return hasSucceededImageTaskAttention(
    attentionSnapshot,
    item.taskHistoryIds,
  )
    ? "待查看"
    : null;
}

function isCatalogBusinessCallType(
  type: ModelCallType | undefined,
): boolean {
  return (
    type === "imageGeneration" ||
    type === "imageEdit" ||
    type === "templateRefinement"
  );
}

function getActiveImageEntryOwnerKey(
  activeCall: ActiveModelCall | null,
): string | null {
  return activeCall?.type === "imageGeneration" ||
    activeCall?.type === "imageEdit"
    ? activeCall.ownerKey
    : null;
}

function EntryTitleBlock({ entry }: { entry: MergedPromptdexEntryListItem }) {
  return (
    <View className="gap-2">
      <Text
        className="min-w-0 text-base font-bold leading-[22px] text-app-ink"
        numberOfLines={1}
        selectable
      >
        {entry.name}
      </Text>
      <View className="flex-row flex-wrap items-center gap-2">
        <SourceBadge entry={entry} />
        <TaskTypeBadge taskType={entry.taskType} />
      </View>
    </View>
  );
}

function SourceBadge({ entry }: { entry: MergedPromptdexEntryListItem }) {
  return (
    <Badge variant={entry.sourceType === "personal" ? "brand" : "neutral"}>
      {entry.sourceLabel}
    </Badge>
  );
}

function TaskTypeBadge({ taskType }: { taskType: "generate" | "edit" }) {
  return (
    <Badge variant={taskType === "generate" ? "success" : "neutral"}>
      {taskType === "generate" ? "生成" : "编辑"}
    </Badge>
  );
}

function ChevronIcon() {
  const mutedColor = useCSSVariable("--app-ink-muted");
  return (
    <SymbolIcon
      className="h-[18px] w-[18px]"
      name="chevron-right"
      tintColor={mutedColor}
    />
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
