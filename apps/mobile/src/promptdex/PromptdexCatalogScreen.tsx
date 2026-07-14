import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, type GestureResponderEvent } from "react-native";

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
  cn,
  Pressable,
  ScrollView,
  SymbolIcon,
  Text,
  useCSSVariable,
  View,
} from "../tw";
import { MediaFrame } from "../ui/MediaFrame";

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
  const runtime = useReadyAppRuntime();
  const modelCallLock = useModelCallLock();
  const attentionSnapshot = useBusinessCallAttentionSnapshot();
  const accentColor = useCSSVariable("--sf-blue");
  const dangerColor = useCSSVariable("--sf-red");
  const mutedColor = useCSSVariable("--sf-text-2");
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

  return (
    <ScrollView
      className="flex-1 bg-sf-bg-2"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-[18px] p-5 pb-8"
    >
      {state.status === "ready" ? (
        <PromptdexRefinementEntry
          active={
            modelCallLock.activeCall?.type === "templateRefinement" &&
            modelCallLock.activeCall.ownerKey ===
            TEMPLATE_REFINEMENT_MODEL_CALL_OWNER_KEY
          }
          attentionKind={attentionSnapshot.templateRefinement?.kind ?? null}
          draftStatus={state.refinementDraftStatus}
          onPress={() => router.push("/promptdex/refine" as never)}
        />
      ) : null}

      {state.status === "loading" ? (
        <View className="items-center gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-[18px]">
          <ActivityIndicator color={accentColor} />
          <Text
            className="text-center text-sm leading-5 text-sf-text-2"
            selectable
          >
            正在加载图鉴。
          </Text>
        </View>
      ) : null}

      {state.status === "failed" ? (
        <View className="flex-row items-start gap-2.5 rounded-lg border border-sf-red bg-sf-bg-3 p-3.5">
          <SymbolIcon
            className="h-5 w-5"
            name="warning"
            tintColor={dangerColor}
          />
          <Text className="flex-1 text-sm leading-5 text-sf-text" selectable>
            {state.message}
          </Text>
        </View>
      ) : null}

      {state.status === "ready" && !hasCatalogEntries ? (
        <View className="items-center gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-[18px]">
          <SymbolIcon
            className="h-6 w-6"
            name="empty-tray"
            tintColor={mutedColor}
          />
          <Text
            className="text-center text-sm leading-5 text-sf-text-2"
            selectable
          >
            没有可用的图鉴条目。
          </Text>
        </View>
      ) : null}

      {state.status === "ready" && hasCatalogEntries ? (
        <>
          <GeneratedEntriesSection
            activeImageEntryOwnerKey={getActiveImageEntryOwnerKey(
              modelCallLock.activeCall,
            )}
            attentionSnapshot={attentionSnapshot}
            entries={state.home.generatedEntries}
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
    </ScrollView>
  );
}

function GeneratedEntriesSection({
  activeImageEntryOwnerKey,
  attentionSnapshot,
  entries,
  onOpenEntry,
  onOpenImage,
}: {
  activeImageEntryOwnerKey: string | null;
  attentionSnapshot: BusinessCallAttentionSnapshot;
  entries: HydratedPromptdexHomeGeneratedEntry[];
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
}: {
  item: HydratedPromptdexHomeGeneratedEntry;
  onOpenEntry(): void;
  onOpenImage(): void;
  status: CatalogEntryStatus | null;
}) {
  const { entry, representativeImage } = item;
  const iconColor = useCSSVariable("--sf-text");
  const mutedColor = useCSSVariable("--sf-text-2");

  function handleImagePress(event: GestureResponderEvent) {
    event.stopPropagation();
    onOpenImage();
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpenEntry}
      className="overflow-hidden rounded-lg border border-sf-separator bg-sf-bg-3"
    >
      <View className="relative">
        <MediaFrame
          accessibilityLabel={`${entry.name}的代表图`}
          placeholderLabel="图片文件不可用"
          uri={representativeImage.imageUri}
          variant="card"
        />
        <Pressable
          accessibilityLabel="打开代表图详情"
          accessibilityRole="button"
          onPress={handleImagePress}
          className="absolute right-2.5 top-2.5 h-11 w-11 items-center justify-center rounded-lg border border-sf-separator bg-sf-bg/90 active:opacity-75"
        >
          <SymbolIcon
            className="h-[18px] w-[18px]"
            name="photo"
            tintColor={iconColor}
          />
        </Pressable>
      </View>
      <View className="gap-2.5 p-3.5">
        <EntryTitleBlock entry={entry} />
        {status ? <CatalogStatusBadge label={status} /> : null}
        <Text
          className="text-sm leading-5 text-sf-text-2"
          numberOfLines={2}
          selectable
        >
          {entry.description}
        </Text>
        <View className="flex-row items-center justify-between gap-2.5">
          <Text
            className="text-[13px] font-bold leading-[18px] tabular-nums text-sf-text-2"
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
    </Pressable>
  );
}

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
          <Pressable
            accessibilityRole="button"
            key={getPromptdexHomeEntryKey(entry)}
            onPress={() => onOpenEntry(entry)}
            className="flex-row items-center gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-3.5 active:opacity-75"
          >
            <View className="min-w-0 flex-1 gap-1.5">
              <EntryTitleBlock entry={entry} />
              <Text
                className="text-sm leading-5 text-sf-text-2"
                numberOfLines={2}
                selectable
              >
                {entry.description}
              </Text>
              <Text
                className="text-[13px] font-bold leading-[18px] text-sf-text-2"
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
          </Pressable>
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
  const mutedColor = useCSSVariable("--sf-text-2");

  return (
    <View className="gap-2.5">
      <SectionTitle>其他图片</SectionTitle>
      {items.length === 0 ? (
        <View className="items-center gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-[18px]">
          <SymbolIcon
            className="h-6 w-6"
            name="photos"
            tintColor={mutedColor}
          />
          <Text
            className="text-center text-sm leading-5 text-sf-text-2"
            selectable
          >
            暂无图片结果。
          </Text>
        </View>
      ) : (
        <View className="gap-2.5">
          {items.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.imageResult.id}
              onPress={() => onOpenImage(item.imageResult)}
              className="flex-row items-center gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-2.5"
            >
              <MediaFrame
                accessibilityLabel="其他生成图片缩略图"
                placeholderLabel="图片不可用"
                thumbnailSize={72}
                uri={item.imageUri}
                variant="thumbnail"
              />
              <View className="min-w-0 flex-1 gap-1.5">
                <Text
                  className="text-[15px] font-extrabold leading-[21px] text-sf-text"
                  numberOfLines={1}
                  selectable
                >
                  {item.taskHistory
                    ? getImageTaskSnapshotSummary(item.taskHistory.snapshot)
                    : "关联任务不可用"}
                </Text>
                <Text
                  className="text-[13px] font-bold leading-[18px] text-sf-text-2"
                  selectable
                >
                  {formatImageSpec(item.imageResult)}
                </Text>
                <Text
                  className="text-[13px] font-bold leading-[18px] tabular-nums text-sf-text-2"
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
            </Pressable>
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
  onPress,
}: {
  active: boolean;
  attentionKind: BusinessCallAttentionKind | null;
  draftStatus: TemplateRefinementDraftStatus | null;
  onPress: () => void;
}) {
  const presentation = getTemplateRefinementEntryPresentation(
    active,
    attentionKind,
    draftStatus,
  );
  const accentColor = useCSSVariable("--sf-blue");
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-lg border border-sf-blue/35 bg-sf-bg-3 p-3.5 active:opacity-75"
    >
      <View className="h-10 w-10 items-center justify-center rounded-lg bg-sf-fill">
        <SymbolIcon
          className="h-[22px] w-[22px]"
          name={presentation.icon}
          tintColor={accentColor}
        />
      </View>
      <View className="min-w-0 flex-1 gap-1.5">
        <Text className="text-base font-extrabold leading-[22px] text-sf-text" selectable>
          {presentation.title}
        </Text>
        <Text className="text-sm leading-5 text-sf-text-2" selectable>
          {presentation.description}
        </Text>
      </View>
      <CatalogStatusBadge label={presentation.status} />
    </Pressable>
  );
}

function CatalogStatusBadge({ label }: { label: string }) {
  return (
    <View className="shrink-0 self-start rounded-lg bg-sf-fill px-2 py-0.5">
      <Text
        className={cn(
          "text-xs font-extrabold leading-4",
          label === "待处理"
            ? "text-sf-red"
            : label === "进行中"
              ? "text-sf-blue"
              : "text-sf-green",
        )}
        selectable
      >
        {label}
      </Text>
    </View>
  );
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
        className="min-w-0 text-base font-extrabold leading-[22px] text-sf-text"
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
    <View
      className="min-h-[22px] shrink-0 items-center justify-center rounded-lg bg-sf-fill px-2"
    >
      <Text
        className={cn(
          "text-xs font-bold leading-4",
          entry.sourceType === "personal" ? "text-sf-blue" : "text-sf-text-2",
        )}
        selectable
      >
        {entry.sourceLabel}
      </Text>
    </View>
  );
}

function TaskTypeBadge({ taskType }: { taskType: "generate" | "edit" }) {
  return (
    <View
      className="min-h-[22px] shrink-0 items-center justify-center rounded-lg bg-sf-fill px-2"
    >
      <Text
        className={cn(
          "text-xs font-bold leading-4",
          taskType === "generate" ? "text-sf-green" : "text-sf-text-2",
        )}
        selectable
      >
        {taskType === "generate" ? "生成" : "编辑"}
      </Text>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text className="text-lg font-extrabold leading-6 text-sf-text" selectable>
      {children}
    </Text>
  );
}

function ChevronIcon() {
  const mutedColor = useCSSVariable("--sf-text-2");
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
