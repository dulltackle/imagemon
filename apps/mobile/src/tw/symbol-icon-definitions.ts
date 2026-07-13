import type Ionicons from "@expo/vector-icons/Ionicons";
import type { SFSymbol } from "expo-symbols";
import type { ComponentProps } from "react";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export interface AppIconDefinition {
  ios: SFSymbol;
  fallback: IoniconName;
}

export interface TabIconDefinition {
  ios: {
    default: SFSymbol;
    selected: SFSymbol;
  };
  fallback: IoniconName;
}

export const APP_ICON_DEFINITIONS = {
  refresh: { ios: "arrow.clockwise", fallback: "refresh-outline" },
  next: { ios: "arrow.right", fallback: "arrow-forward-outline" },
  expand: {
    ios: "arrow.up.left.and.arrow.down.right",
    fallback: "expand-outline",
  },
  "connection-test": { ios: "bolt", fallback: "flash-outline" },
  confirm: { ios: "checkmark", fallback: "checkmark-outline" },
  success: {
    ios: "checkmark.circle",
    fallback: "checkmark-circle-outline",
  },
  "checkbox-checked": {
    ios: "checkmark.square",
    fallback: "checkbox-outline",
  },
  "checkbox-empty": { ios: "square", fallback: "square-outline" },
  "chevron-down": { ios: "chevron.down", fallback: "chevron-down" },
  "chevron-right": { ios: "chevron.right", fallback: "chevron-forward" },
  "chevron-up": { ios: "chevron.up", fallback: "chevron-up" },
  copy: { ios: "doc.on.doc", fallback: "copy-outline" },
  document: { ios: "doc.text", fallback: "document-text-outline" },
  warning: {
    ios: "exclamationmark.triangle",
    fallback: "warning-outline",
  },
  skip: { ios: "forward.end", fallback: "play-skip-forward-outline" },
  settings: { ios: "gearshape", fallback: "settings-outline" },
  pending: { ios: "hourglass", fallback: "hourglass-outline" },
  information: {
    ios: "info.circle",
    fallback: "information-circle-outline",
  },
  locked: { ios: "lock", fallback: "lock-closed-outline" },
  edit: { ios: "pencil", fallback: "create-outline" },
  photo: { ios: "photo", fallback: "image-outline" },
  photos: { ios: "photo.on.rectangle", fallback: "images-outline" },
  server: { ios: "server.rack", fallback: "server-outline" },
  sparkles: { ios: "sparkles", fallback: "sparkles-outline" },
  download: {
    ios: "square.and.arrow.down",
    fallback: "download-outline",
  },
  save: { ios: "square.and.arrow.down", fallback: "save-outline" },
  favorite: { ios: "star", fallback: "star-outline" },
  "text-model": {
    ios: "text.bubble",
    fallback: "chatbubble-ellipses-outline",
  },
  delete: { ios: "trash", fallback: "trash-outline" },
  "empty-tray": { ios: "tray", fallback: "file-tray-outline" },
  "magic-wand": { ios: "wand.and.stars", fallback: "color-wand-outline" },
  close: { ios: "xmark", fallback: "close" },
} as const satisfies Record<string, AppIconDefinition>;

export type AppIconName = keyof typeof APP_ICON_DEFINITIONS;

export const TAB_ICON_DEFINITIONS = {
  catalog: {
    ios: {
      default: "square.grid.2x2",
      selected: "square.grid.2x2.fill",
    },
    fallback: "grid-outline",
  },
  history: {
    ios: { default: "clock", selected: "clock.fill" },
    fallback: "time-outline",
  },
  settings: {
    ios: { default: "gearshape", selected: "gearshape.fill" },
    fallback: "settings-outline",
  },
} as const satisfies Record<string, TabIconDefinition>;

export type TabIconName = keyof typeof TAB_ICON_DEFINITIONS;

export const DEFAULT_APP_ICON_DEFINITION = {
  ios: "questionmark.circle",
  fallback: "help-circle-outline",
} as const satisfies AppIconDefinition;

const warnedUnknownIconNames = new Set<string>();

function warnAboutUnknownIconName(name: unknown) {
  if (typeof __DEV__ === "undefined" || !__DEV__) {
    return;
  }

  const warningKey = String(name);
  if (warnedUnknownIconNames.has(warningKey)) {
    return;
  }

  warnedUnknownIconNames.add(warningKey);
  console.warn(
    `[SymbolIcon] 未找到语义图标映射：${warningKey}，已使用缺省图标。`,
  );
}

export function getAppIconDefinition(
  name: string,
): AppIconDefinition {
  if (Object.prototype.hasOwnProperty.call(APP_ICON_DEFINITIONS, name)) {
    return APP_ICON_DEFINITIONS[name as AppIconName];
  }

  warnAboutUnknownIconName(name);
  return DEFAULT_APP_ICON_DEFINITION;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function resolveSymbolIconSize(
  explicitSize: number | undefined,
  width: unknown,
  height: unknown,
): number {
  if (isFiniteNumber(explicitSize) && explicitSize > 0) {
    return explicitSize;
  }
  if (isFiniteNumber(width) && width > 0) {
    return width;
  }
  if (isFiniteNumber(height) && height > 0) {
    return height;
  }
  return 24;
}
