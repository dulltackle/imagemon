import type {
  ImageResultFileStorage,
  ImageTaskInternalAttachmentStorage,
} from "./file-storage";
import {
  ImageTaskRepositoryError,
  type ImageTaskRepository,
} from "./repository";
import type { ImageResult, ImageTaskHistory, ImageTaskSnapshot } from "./types";

export type DeleteImageTaskHistoryResult = Awaited<
  ReturnType<ImageTaskRepository["deleteHistory"]>
>;

export type ImageTaskDeletionRepository = Pick<
  ImageTaskRepository,
  "getHistory" | "deleteHistory" | "getImageResult" | "deleteImageResult"
>;

export interface ImageTaskDeletionService {
  deleteHistory(id: string): Promise<DeleteImageTaskHistoryResult>;
  deleteImageResult(id: string): Promise<ImageResult>;
}

export interface CreateImageTaskDeletionServiceOptions {
  imageTaskRepository: ImageTaskDeletionRepository;
  imageFileStorage: Pick<ImageResultFileStorage, "deleteFile">;
  imageTaskAttachmentStorage: Pick<
    ImageTaskInternalAttachmentStorage,
    "deleteAttachment"
  >;
}

export function createImageTaskDeletionService({
  imageTaskRepository,
  imageFileStorage,
  imageTaskAttachmentStorage,
}: CreateImageTaskDeletionServiceOptions): ImageTaskDeletionService {
  return {
    async deleteHistory(id) {
      const history = await requireDeletableHistory(imageTaskRepository, id);
      const attachmentPaths = collectInputAttachmentPaths(history.snapshot);

      for (const filePath of attachmentPaths) {
        await imageTaskAttachmentStorage.deleteAttachment(filePath);
      }

      return imageTaskRepository.deleteHistory(id);
    },

    async deleteImageResult(id) {
      const imageResult = await imageTaskRepository.getImageResult(id);
      if (!imageResult) {
        throw new ImageTaskRepositoryError(
          "not_found",
          "图片结果不存在。",
        );
      }

      await imageFileStorage.deleteFile(imageResult.filePath);
      return imageTaskRepository.deleteImageResult(id);
    },
  };
}

async function requireDeletableHistory(
  repository: Pick<ImageTaskDeletionRepository, "getHistory">,
  id: string,
): Promise<ImageTaskHistory> {
  const history = await repository.getHistory(id);
  if (!history) {
    throw new ImageTaskRepositoryError(
      "not_found",
      "图片任务历史不存在。",
    );
  }
  if (history.status === "running") {
    throw new ImageTaskRepositoryError(
      "invalid_state",
      "图片任务进行中，完成后才能删除这条任务历史。",
    );
  }
  return history;
}

function collectInputAttachmentPaths(snapshot: ImageTaskSnapshot): string[] {
  if (snapshot.source !== "promptdex") {
    return [];
  }

  const paths = [
    snapshot.inputAttachments?.image?.filePath,
    snapshot.inputAttachments?.mask?.filePath,
  ];
  return [...new Set(paths.filter((path): path is string => path !== undefined))];
}
