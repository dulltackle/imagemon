import type {
  ImageResult,
  ImageTaskHistory,
  ImageTaskRepository,
  PromptdexImageTaskSnapshot,
} from "../image-tasks";
import type {
  MergedPromptdexCatalogService,
  MergedPromptdexEntryListItem,
  PromptdexCatalogEntrySourceType,
} from "./index";

export type PromptdexHomeEntryKey =
  `${PromptdexCatalogEntrySourceType}:${string}`;

export interface PromptdexHomeEntryIdentity {
  sourceType: PromptdexCatalogEntrySourceType;
  name: string;
}

export interface PromptdexHomeEntryImage {
  imageResult: ImageResult;
  taskHistory: ImageTaskHistory;
}

export interface PromptdexHomeGeneratedEntry {
  entry: MergedPromptdexEntryListItem;
  representativeImage: PromptdexHomeEntryImage;
  /**
   * 当前条目全部完成图片所关联的任务历史 id，按最新图片出现顺序去重。
   *
   * 首页用它聚合业务调用提示，不能只检查代表图对应的任务，否则同一条目
   * 之前任务的待查看状态会被遗漏。
   */
  taskHistoryIds: string[];
}

export interface PromptdexHomeOtherImage {
  imageResult: ImageResult;
  taskHistory: ImageTaskHistory | null;
}

export interface PromptdexHomeResult {
  generatedEntries: PromptdexHomeGeneratedEntry[];
  ungeneratedEntries: MergedPromptdexEntryListItem[];
  otherImages: PromptdexHomeOtherImage[];
}

export interface PromptdexHomeService {
  getHome(): Promise<PromptdexHomeResult>;
  listEntryImages(
    entry: PromptdexHomeEntryIdentity,
  ): Promise<PromptdexHomeEntryImage[]>;
}

interface CreatePromptdexHomeServiceOptions {
  promptdexCatalogService: MergedPromptdexCatalogService;
  imageTaskRepository: Pick<
    ImageTaskRepository,
    "listHistories" | "listImageResults"
  >;
}

interface ClassifiedImageResult {
  imageResult: ImageResult;
  taskHistory: ImageTaskHistory | null;
  matchedEntryKey: PromptdexHomeEntryKey | null;
}

export function createPromptdexHomeService({
  promptdexCatalogService,
  imageTaskRepository,
}: CreatePromptdexHomeServiceOptions): PromptdexHomeService {
  return {
    async getHome() {
      const [entries, imageResults, historyById] = await Promise.all([
        promptdexCatalogService.list(),
        imageTaskRepository.listImageResults(),
        loadTaskHistoryById(imageTaskRepository),
      ]);
      const entryByKey = new Map(
        entries.map((entry) => [getPromptdexHomeEntryKey(entry), entry]),
      );

      const classifiedImages = imageResults.map(
        (imageResult): ClassifiedImageResult => {
          const taskHistory = resolveTaskHistory(
            historyById,
            imageResult.taskHistoryId,
          );
          const completedEntryKey = getCompletedPromptdexEntryKey(taskHistory);
          const matchedEntryKey =
            completedEntryKey && entryByKey.has(completedEntryKey)
              ? completedEntryKey
              : null;
          return { imageResult, taskHistory, matchedEntryKey };
        },
      );

      const imagesByEntryKey = groupImagesByEntryKey(classifiedImages);
      const generatedEntries = [...imagesByEntryKey.entries()]
        .map(([entryKey, images]) => {
          const entry = entryByKey.get(entryKey);
          if (!entry) {
            return null;
          }
          return {
            entry,
            representativeImage: images[0],
            taskHistoryIds: getUniqueTaskHistoryIds(images),
          };
        })
        .filter((entry): entry is PromptdexHomeGeneratedEntry => entry !== null)
        .sort(compareGeneratedEntryDescending);
      const generatedEntryKeys = new Set(
        generatedEntries.map((generatedEntry) =>
          getPromptdexHomeEntryKey(generatedEntry.entry),
        ),
      );
      const matchedImageIds = new Set(
        [...imagesByEntryKey.values()].flatMap((images) =>
          images.map(({ imageResult }) => imageResult.id),
        ),
      );

      return {
        generatedEntries,
        ungeneratedEntries: entries.filter(
          (entry) => !generatedEntryKeys.has(getPromptdexHomeEntryKey(entry)),
        ),
        otherImages: classifiedImages
          .filter(
            ({ imageResult, taskHistory }) =>
              !matchedImageIds.has(imageResult.id) &&
              isVisibleOtherImage(taskHistory),
          )
          .map(({ imageResult, taskHistory }) => ({ imageResult, taskHistory }))
          .sort(compareOtherImageDescending),
      };
    },

    async listEntryImages(entry) {
      const [imageResults, historyById] = await Promise.all([
        imageTaskRepository.listImageResults(),
        loadTaskHistoryById(imageTaskRepository),
      ]);
      const entryKey = getPromptdexHomeEntryKey(entry);

      return imageResults
        .map((imageResult) => {
          const taskHistory = resolveTaskHistory(
            historyById,
            imageResult.taskHistoryId,
          );
          if (
            !taskHistory ||
            getCompletedPromptdexEntryKey(taskHistory) !== entryKey
          ) {
            return null;
          }
          return { imageResult, taskHistory };
        })
        .filter((image): image is PromptdexHomeEntryImage => image !== null)
        .sort(compareEntryImageDescending);
    },
  };
}

function getUniqueTaskHistoryIds(
  images: readonly PromptdexHomeEntryImage[],
): string[] {
  return [...new Set(images.map(({ taskHistory }) => taskHistory.id))];
}

/**
 * 其他图片是可查看的图片资产入口。任务已经失败、状态未知或仍在运行时，
 * 即使仓储里暂时存在图片记录，也只能从历史入口处理，不能提前暴露为图片。
 * 与任务历史失联的独立图片仍然是有效资产，因此继续展示。
 */
function isVisibleOtherImage(taskHistory: ImageTaskHistory | null): boolean {
  return taskHistory === null || taskHistory.status === "completed";
}

export function getPromptdexHomeEntryKey(
  entry: PromptdexHomeEntryIdentity,
): PromptdexHomeEntryKey {
  return `${entry.sourceType}:${entry.name}`;
}

async function loadTaskHistoryById(
  imageTaskRepository: Pick<ImageTaskRepository, "listHistories">,
): Promise<Map<string, ImageTaskHistory>> {
  const histories = await imageTaskRepository.listHistories();
  return new Map(histories.map((history) => [history.id, history]));
}

function resolveTaskHistory(
  historyById: Map<string, ImageTaskHistory>,
  taskHistoryId: string | null,
): ImageTaskHistory | null {
  if (!taskHistoryId) {
    return null;
  }
  return historyById.get(taskHistoryId) ?? null;
}

function getCompletedPromptdexEntryKey(
  taskHistory: ImageTaskHistory | null,
): PromptdexHomeEntryKey | null {
  if (
    !taskHistory ||
    taskHistory.status !== "completed" ||
    taskHistory.snapshot.source !== "promptdex"
  ) {
    return null;
  }

  return getPromptdexImageTaskEntryKey(taskHistory.snapshot);
}

function getPromptdexImageTaskEntryKey(
  snapshot: PromptdexImageTaskSnapshot,
): PromptdexHomeEntryKey {
  return `${snapshot.promptdexEntry.sourceType}:${snapshot.promptdexEntry.name}`;
}

function groupImagesByEntryKey(
  classifiedImages: ClassifiedImageResult[],
): Map<PromptdexHomeEntryKey, PromptdexHomeEntryImage[]> {
  const imagesByEntryKey = new Map<
    PromptdexHomeEntryKey,
    PromptdexHomeEntryImage[]
  >();

  for (const { imageResult, taskHistory, matchedEntryKey } of classifiedImages) {
    if (!matchedEntryKey || !taskHistory) {
      continue;
    }
    const images = imagesByEntryKey.get(matchedEntryKey) ?? [];
    images.push({ imageResult, taskHistory });
    imagesByEntryKey.set(matchedEntryKey, images);
  }

  for (const images of imagesByEntryKey.values()) {
    images.sort(compareEntryImageDescending);
  }
  return imagesByEntryKey;
}

function compareGeneratedEntryDescending(
  left: PromptdexHomeGeneratedEntry,
  right: PromptdexHomeGeneratedEntry,
): number {
  return compareEntryImageDescending(
    left.representativeImage,
    right.representativeImage,
  );
}

function compareEntryImageDescending(
  left: PromptdexHomeEntryImage,
  right: PromptdexHomeEntryImage,
): number {
  return compareImageResultDescending(left.imageResult, right.imageResult);
}

function compareOtherImageDescending(
  left: PromptdexHomeOtherImage,
  right: PromptdexHomeOtherImage,
): number {
  return compareImageResultDescending(left.imageResult, right.imageResult);
}

export function compareImageResultDescending(
  left: ImageResult,
  right: ImageResult,
): number {
  const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
  return createdAtOrder === 0
    ? right.id.localeCompare(left.id)
    : createdAtOrder;
}
