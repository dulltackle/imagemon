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
    "getHistory" | "listImageResults"
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
      const [entries, imageResults] = await Promise.all([
        promptdexCatalogService.list(),
        imageTaskRepository.listImageResults(),
      ]);
      const entryByKey = new Map(
        entries.map((entry) => [getPromptdexHomeEntryKey(entry), entry]),
      );
      const historyPromises = new Map<
        string,
        Promise<ImageTaskHistory | null>
      >();

      const classifiedImages = await Promise.all(
        imageResults.map(async (imageResult): Promise<ClassifiedImageResult> => {
          const taskHistory = await getTaskHistory(
            imageTaskRepository,
            historyPromises,
            imageResult.taskHistoryId,
          );
          const completedEntryKey = getCompletedPromptdexEntryKey(taskHistory);
          const matchedEntryKey =
            completedEntryKey && entryByKey.has(completedEntryKey)
              ? completedEntryKey
              : null;
          return { imageResult, taskHistory, matchedEntryKey };
        }),
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
          .filter(({ imageResult }) => !matchedImageIds.has(imageResult.id))
          .map(({ imageResult, taskHistory }) => ({ imageResult, taskHistory }))
          .sort(compareOtherImageDescending),
      };
    },

    async listEntryImages(entry) {
      const imageResults = await imageTaskRepository.listImageResults();
      const historyPromises = new Map<
        string,
        Promise<ImageTaskHistory | null>
      >();
      const entryKey = getPromptdexHomeEntryKey(entry);
      const images = await Promise.all(
        imageResults.map(async (imageResult) => {
          const taskHistory = await getTaskHistory(
            imageTaskRepository,
            historyPromises,
            imageResult.taskHistoryId,
          );
          if (
            !taskHistory ||
            getCompletedPromptdexEntryKey(taskHistory) !== entryKey
          ) {
            return null;
          }
          return { imageResult, taskHistory };
        }),
      );

      return images
        .filter((image): image is PromptdexHomeEntryImage => image !== null)
        .sort(compareEntryImageDescending);
    },
  };
}

export function getPromptdexHomeEntryKey(
  entry: PromptdexHomeEntryIdentity,
): PromptdexHomeEntryKey {
  return `${entry.sourceType}:${entry.name}`;
}

function getTaskHistory(
  imageTaskRepository: Pick<ImageTaskRepository, "getHistory">,
  historyPromises: Map<string, Promise<ImageTaskHistory | null>>,
  taskHistoryId: string | null,
): Promise<ImageTaskHistory | null> {
  if (!taskHistoryId) {
    return Promise.resolve(null);
  }
  let promise = historyPromises.get(taskHistoryId);
  if (!promise) {
    promise = imageTaskRepository.getHistory(taskHistoryId);
    historyPromises.set(taskHistoryId, promise);
  }
  return promise;
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

function compareImageResultDescending(
  left: ImageResult,
  right: ImageResult,
): number {
  const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
  return createdAtOrder === 0
    ? right.id.localeCompare(left.id)
    : createdAtOrder;
}
