export type ImageResultAlbumSaveAvailability =
  | { status: "ready" }
  | { status: "unsupported" }
  | { status: "missingFile" };

export type ImageResultAlbumSaveFailureReason =
  | "permissionDenied"
  | "unsupported"
  | "missingFile"
  | "writeFailed";

export type ImageResultAlbumSaveResult =
  | { status: "saved" }
  | { status: "failed"; reason: ImageResultAlbumSaveFailureReason };

export interface ImageResultAlbumSaver {
  getAvailability(imageUri: string | null): Promise<ImageResultAlbumSaveAvailability>;
  save(imageUri: string | null): Promise<ImageResultAlbumSaveResult>;
}

export interface ImageResultAlbumFileInfo {
  exists: boolean;
}

export interface CreateExpoImageResultAlbumSaverOptions {
  platformOS: string;
  getFileInfo?: (uri: string) => Promise<ImageResultAlbumFileInfo>;
  requestWritePermission?: () => Promise<boolean>;
  saveToLibrary?: (uri: string) => Promise<void>;
}

export interface MemoryImageResultAlbumSaver extends ImageResultAlbumSaver {
  readonly savedUris: string[];
  readonly existingUris: Set<string>;
}

export interface CreateMemoryImageResultAlbumSaverOptions {
  supported?: boolean;
  existingUris?: Iterable<string>;
  permissionGranted?: boolean;
  failSave?: boolean;
}

export function createExpoImageResultAlbumSaver({
  platformOS,
  getFileInfo = getExpoFileInfo,
  requestWritePermission = requestExpoMediaLibraryWritePermission,
  saveToLibrary = saveToExpoMediaLibrary,
}: CreateExpoImageResultAlbumSaverOptions): ImageResultAlbumSaver {
  const supported = isSystemAlbumSaveSupported(platformOS);

  async function getAvailability(
    imageUri: string | null,
  ): Promise<ImageResultAlbumSaveAvailability> {
    if (!supported) {
      return { status: "unsupported" };
    }
    return (await canReadImageFile(imageUri, getFileInfo))
      ? { status: "ready" }
      : { status: "missingFile" };
  }

  return {
    getAvailability,
    async save(imageUri) {
      const availability = await getAvailability(imageUri);
      if (availability.status === "unsupported") {
        return failed("unsupported");
      }
      if (availability.status === "missingFile") {
        return failed("missingFile");
      }

      let permissionGranted = false;
      try {
        permissionGranted = await requestWritePermission();
      } catch {
        return failed("writeFailed");
      }
      if (!permissionGranted) {
        return failed("permissionDenied");
      }

      const uri = imageUri?.trim() ?? "";
      try {
        await saveToLibrary(uri);
        return { status: "saved" };
      } catch {
        return failed("writeFailed");
      }
    },
  };
}

export function createMemoryImageResultAlbumSaver({
  supported = false,
  existingUris = [],
  permissionGranted = true,
  failSave = false,
}: CreateMemoryImageResultAlbumSaverOptions = {}): MemoryImageResultAlbumSaver {
  const savedUris: string[] = [];
  const existingUriSet = new Set(existingUris);

  async function getAvailability(
    imageUri: string | null,
  ): Promise<ImageResultAlbumSaveAvailability> {
    const uri = imageUri?.trim() ?? "";
    if (!supported) {
      return { status: "unsupported" };
    }
    return uri && existingUriSet.has(uri)
      ? { status: "ready" }
      : { status: "missingFile" };
  }

  return {
    existingUris: existingUriSet,
    savedUris,
    getAvailability,
    async save(imageUri) {
      const availability = await getAvailability(imageUri);
      if (availability.status === "unsupported") {
        return failed("unsupported");
      }
      if (availability.status === "missingFile") {
        return failed("missingFile");
      }
      if (!permissionGranted) {
        return failed("permissionDenied");
      }
      if (failSave) {
        return failed("writeFailed");
      }
      savedUris.push(imageUri?.trim() ?? "");
      return { status: "saved" };
    },
  };
}

export function getImageResultAlbumSaveFailureMessage(
  reason: ImageResultAlbumSaveFailureReason,
): string {
  switch (reason) {
    case "permissionDenied":
      return "未获得相册写入权限，无法保存。";
    case "unsupported":
      return "当前平台不支持保存到系统相册。";
    case "missingFile":
      return "图片文件缺失，无法保存到系统相册。";
    case "writeFailed":
      return "保存到系统相册失败，请稍后重试。";
  }
}

export function getImageResultAlbumSaveAvailabilityMessage(
  availability: Exclude<ImageResultAlbumSaveAvailability, { status: "ready" }>,
): string {
  switch (availability.status) {
    case "unsupported":
      return getImageResultAlbumSaveFailureMessage("unsupported");
    case "missingFile":
      return getImageResultAlbumSaveFailureMessage("missingFile");
  }
}

export function getImageResultAlbumSaveSuccessMessage(): string {
  return "已保存到系统相册。";
}

function failed(
  reason: ImageResultAlbumSaveFailureReason,
): ImageResultAlbumSaveResult {
  return { status: "failed", reason };
}

function isSystemAlbumSaveSupported(platformOS: string): boolean {
  return platformOS === "ios" || platformOS === "android";
}

async function canReadImageFile(
  imageUri: string | null,
  getFileInfo: (uri: string) => Promise<ImageResultAlbumFileInfo>,
): Promise<boolean> {
  const uri = imageUri?.trim();
  if (!uri) {
    return false;
  }

  try {
    const info = await getFileInfo(uri);
    return info.exists;
  } catch {
    return false;
  }
}

async function getExpoFileInfo(uri: string): Promise<ImageResultAlbumFileInfo> {
  const { File } = await import("expo-file-system");
  const info = new File(uri).info();
  return { exists: info.exists };
}

async function requestExpoMediaLibraryWritePermission(): Promise<boolean> {
  const { requestPermissionsAsync } = await import("expo-media-library");
  const response = await requestPermissionsAsync(true, []);
  return response.granted;
}

async function saveToExpoMediaLibrary(uri: string): Promise<void> {
  const { saveToLibraryAsync } = await import("expo-media-library");
  await saveToLibraryAsync(uri);
}
