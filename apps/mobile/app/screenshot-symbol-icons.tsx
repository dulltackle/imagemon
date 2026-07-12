import { Redirect, useLocalSearchParams } from "expo-router";

import { SymbolIcon, Text, View, type AppIconName } from "../src/tw";
import { APP_ICON_DEFINITIONS } from "../src/tw/symbol-icon-definitions";

const SCREENSHOT_MODE_ENABLED =
  process.env.EXPO_PUBLIC_IMAGEMON_SCREENSHOT_MODE === "1";
const ICON_NAMES = Object.keys(APP_ICON_DEFINITIONS) as AppIconName[];
const ICONS_PER_PAGE = 8;
const TOTAL_PAGES = Math.ceil(ICON_NAMES.length / ICONS_PER_PAGE);

export default function ScreenshotSymbolIconsScreen() {
  const { page: rawPage } = useLocalSearchParams<{
    page?: string | string[];
  }>();

  if (!SCREENSHOT_MODE_ENABLED) {
    return <Redirect href="/" />;
  }

  const page = parsePage(rawPage);
  if (page === null) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-sf-bg-2 p-6">
        <Text
          accessibilityLabel="symbol-page:error"
          className="text-xl font-bold text-sf-red"
          selectable
        >
          图标验收页码无效
        </Text>
        <Text className="text-center text-sm text-sf-text-2" selectable>
          页码必须是 1 至 {TOTAL_PAGES} 的单个整数。
        </Text>
      </View>
    );
  }

  const pageIconNames = ICON_NAMES.slice(
    (page - 1) * ICONS_PER_PAGE,
    page * ICONS_PER_PAGE,
  );
  const pageMetadata = `symbol-page:${page}/${TOTAL_PAGES}|${pageIconNames.join(",")}`;

  return (
    <View className="flex-1 gap-4 bg-sf-bg-2 p-4">
      <View
        accessibilityLabel={pageMetadata}
        accessible
        className="min-h-7 items-center justify-center"
      >
        <Text
          className="text-center text-base font-bold leading-6 tabular-nums text-sf-text"
          selectable
        >
          图标验收 {page}/{TOTAL_PAGES}
        </Text>
      </View>

      <View className="flex-1 flex-row flex-wrap content-start justify-between gap-y-3">
        {pageIconNames.map((name) => (
          <View
            className="items-center gap-2 rounded-lg bg-sf-bg-3 p-3"
            key={name}
            style={{ width: "48%" }}
          >
            <View
              accessibilityLabel={`symbol-check:${name}`}
              accessible
              className="h-20 w-20 items-center justify-center bg-white"
            >
              <SymbolIcon name={name} size={40} tintColor="#000000" />
            </View>
            <Text
              className="text-center text-xs font-bold leading-4 text-sf-text"
              selectable
            >
              {name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function parsePage(value: string | string[] | undefined): number | null {
  if (value === undefined) {
    return 1;
  }
  if (Array.isArray(value) || !/^\d+$/.test(value)) {
    return null;
  }
  const page = Number(value);
  return page >= 1 && page <= TOTAL_PAGES ? page : null;
}
