import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createExpoImageResultFileStorage,
  createMemoryImageResultFileStorage,
  createMemoryImageTaskInternalAttachmentStorage,
} from "./file-storage";

const expoFileSystemMock = vi.hoisted(() => ({
  constructedUris: [] as string[],
  deletedUris: [] as string[],
  existingUris: new Set<string>(),
}));

vi.mock("expo-file-system", () => ({
  Paths: {
    document: "file:///document",
  },
  File: class MockFile {
    readonly uri: string;

    constructor(baseUri: string, ...segments: string[]) {
      this.uri = [baseUri.replace(/\/$/, ""), ...segments].join("/");
      expoFileSystemMock.constructedUris.push(this.uri);
    }

    get exists(): boolean {
      return expoFileSystemMock.existingUris.has(this.uri);
    }

    delete(): void {
      expoFileSystemMock.deletedUris.push(this.uri);
      expoFileSystemMock.existingUris.delete(this.uri);
    }
  },
}));

describe("ImageResultFileStorage", () => {
  beforeEach(() => {
    expoFileSystemMock.constructedUris.length = 0;
    expoFileSystemMock.deletedUris.length = 0;
    expoFileSystemMock.existingUris.clear();
  });

  it("Expo 存储只删除图片结果目录中的现有文件且缺失时幂等成功", async () => {
    const storage = createExpoImageResultFileStorage();
    const filePath = "image-results/image-result-1.png";
    const fileUri = "file:///document/image-results/image-result-1.png";
    expoFileSystemMock.existingUris.add(fileUri);

    await storage.deleteFile(filePath);

    expect(expoFileSystemMock.deletedUris).toEqual([fileUri]);
    expect(expoFileSystemMock.existingUris.has(fileUri)).toBe(false);

    await expect(storage.deleteFile(filePath)).resolves.toBeUndefined();
    expect(expoFileSystemMock.deletedUris).toEqual([fileUri]);
  });

  it("内存存储同步删除 files Map 且缺失时幂等成功", async () => {
    const storage = createMemoryImageResultFileStorage();
    const { filePath } = await storage.saveImageResultFile({
      imageResultId: "image-result-1",
      format: "png",
      base64: "image-content",
    });

    expect(storage.files.has(filePath)).toBe(true);

    await storage.deleteFile(filePath);

    expect(storage.files.has(filePath)).toBe(false);
    await expect(storage.deleteFile(filePath)).resolves.toBeUndefined();
  });

  it.each([
    "file:///document/image-results/image-result-1.png",
    "/document/image-results/image-result-1.png",
    "other/image-result-1.png",
    "image-results/../image-result-1.png",
    "image-results/nested/image-result-1.png",
  ])("Expo 存储拒绝不安全的删除路径：%s", async (filePath) => {
    const storage = createExpoImageResultFileStorage();

    await expect(storage.deleteFile(filePath)).rejects.toThrow(
      "图片结果路径无效",
    );
    expect(expoFileSystemMock.constructedUris).toEqual([]);
  });

  it.each([
    "file:///document/image-results/image-result-1.png",
    "/document/image-results/image-result-1.png",
    "other/image-result-1.png",
    "image-results/../image-result-1.png",
    "image-results/nested/image-result-1.png",
  ])("内存存储拒绝不安全的删除路径：%s", async (filePath) => {
    const storage = createMemoryImageResultFileStorage();

    await expect(storage.deleteFile(filePath)).rejects.toThrow(
      "图片结果路径无效",
    );
  });
});

describe("ImageTaskInternalAttachmentStorage", () => {
  it("复制编辑输入附件到任务历史内部路径并创建上传文件", async () => {
    const storage = createMemoryImageTaskInternalAttachmentStorage();

    const attachment = await storage.copyTaskInputAttachment({
      historyId: "history-1",
      role: "image",
      sourceUri: "file:///input.PNG",
      mimeType: "image/png",
      originalFileName: "Portrait.JPEG",
      width: 1200,
      height: 800,
      byteSize: 123456,
    });

    expect(attachment).toEqual({
      role: "image",
      filePath: "task-history-attachments/history-1/image.jpg",
      mimeType: "image/png",
      originalFileName: "Portrait.JPEG",
      width: 1200,
      height: 800,
      byteSize: 123456,
    });
    await expect(storage.resolveAttachmentUri(attachment.filePath)).resolves.toBe(
      "memory:///task-history-attachments/history-1/image.jpg",
    );
    await expect(
      storage.createUploadFile(attachment.filePath, attachment),
    ).resolves.toEqual({
      uri: "memory:///task-history-attachments/history-1/image.jpg",
      name: "image.jpg",
      type: "image/png",
    });
  });

  it("无法从文件名判断扩展名时按 MIME 推断", async () => {
    const storage = createMemoryImageTaskInternalAttachmentStorage();

    const attachment = await storage.copyTaskInputAttachment({
      historyId: "history-1",
      role: "mask",
      sourceUri: "file:///input",
      mimeType: "image/webp",
      originalFileName: null,
    });

    expect(attachment.filePath).toBe(
      "task-history-attachments/history-1/mask.webp",
    );
  });

  it("拒绝不安全路径片段和不支持的附件类型", async () => {
    const storage = createMemoryImageTaskInternalAttachmentStorage();

    await expect(
      storage.copyTaskInputAttachment({
        historyId: "../history-1",
        role: "image",
        sourceUri: "file:///input.png",
        mimeType: "image/png",
        originalFileName: "input.png",
      }),
    ).rejects.toThrow("内部文件路径片段无效");

    await expect(
      storage.copyTaskInputAttachment({
        historyId: "history-1",
        role: "image",
        sourceUri: "file:///input.txt",
        mimeType: "application/octet-stream",
        originalFileName: "input.txt",
      }),
    ).rejects.toThrow("编辑输入附件类型不受支持");
  });

  it("拒绝无效附件路径并能清理已复制附件", async () => {
    const storage = createMemoryImageTaskInternalAttachmentStorage();
    const attachment = await storage.copyTaskInputAttachment({
      historyId: "history-1",
      role: "image",
      sourceUri: "file:///input.png",
      mimeType: "image/png",
      originalFileName: "input.png",
    });

    await expect(
      storage.resolveAttachmentUri("task-history-attachments/history-1/cover.png"),
    ).rejects.toThrow("编辑输入附件路径无效");

    await storage.deleteAttachment(attachment.filePath);
    await expect(storage.resolveAttachmentUri(attachment.filePath)).rejects.toThrow(
      "编辑输入附件文件缺失",
    );
  });
});
