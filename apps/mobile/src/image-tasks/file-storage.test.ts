import { describe, expect, it } from "vitest";

import { createMemoryImageTaskInternalAttachmentStorage } from "./file-storage";

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
