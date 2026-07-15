import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import {
  useAppSettings,
  useModelConfigurationRepository,
} from "../../../src/app-state";
import { getImageTaskSizeLabel } from "../../../src/image-tasks/default-spec";
import type { ModelConfiguration } from "../../../src/model-configurations";
import { SymbolIcon, Text, useCSSVariable, View } from "../../../src/tw";
import { ScreenScrollView } from "../../../src/ui/ScreenCanvas";
import {
  SCROLL_PRESS_FEEDBACK_DELAY_MS,
} from "../../../src/ui/scroll-press-feedback";
import { Surface } from "../../../src/ui/Surface";

export default function SettingsScreen() {
  const router = useRouter();
  const settings = useAppSettings();
  const repository = useModelConfigurationRepository();
  const actionColor = useCSSVariable("--app-action");
  const mutedColor = useCSSVariable("--app-ink-muted");
  const [defaultImageConfiguration, setDefaultImageConfiguration] =
    useState<ModelConfiguration | null>(null);
  const [defaultTextConfiguration, setDefaultTextConfiguration] =
    useState<ModelConfiguration | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDefaultConfigurations() {
      const [image, text] = await Promise.all([
        settings.defaultImageModelConfigurationId
          ? repository.get(settings.defaultImageModelConfigurationId)
          : Promise.resolve(null),
        settings.defaultTextModelConfigurationId
          ? repository.get(settings.defaultTextModelConfigurationId)
          : Promise.resolve(null),
      ]);
      if (!cancelled) {
        setDefaultImageConfiguration(image);
        setDefaultTextConfiguration(text);
      }
    }

    void loadDefaultConfigurations();

    return () => {
      cancelled = true;
    };
  }, [
    repository,
    settings.defaultImageModelConfigurationId,
    settings.defaultTextModelConfigurationId,
  ]);

  return (
    <ScreenScrollView variant="tool">
      <Surface
        accessibilityLabel="打开模型配置"
        onPress={() => router.push("/model-configurations")}
        pressFeedbackDelayMs={SCROLL_PRESS_FEEDBACK_DELAY_MS}
        variant="interactive"
      >
        <View className="min-h-[72px] flex-row items-center gap-3 px-3.5 py-3">
          <View
            className="h-10 w-10 items-center justify-center rounded-[14px] bg-app-action-soft"
            style={{ borderCurve: "continuous" }}
          >
            <SymbolIcon
              className="h-[22px] w-[22px]"
              name="server"
              tintColor={actionColor}
            />
          </View>
          <View className="flex-1 gap-1">
            <Text
              className="text-base font-bold leading-[22px] text-app-ink"
            >
              模型配置
            </Text>
            <Text
              className="text-[13px] leading-[18px] text-app-ink-muted"
            >
              图片默认：{defaultImageConfiguration?.modelName ?? "未设置"} ·
              文本默认：
              {defaultTextConfiguration?.modelName ?? "未设置"}
            </Text>
          </View>
          <SymbolIcon
            className="h-5 w-5"
            name="chevron-right"
            tintColor={mutedColor}
          />
        </View>
      </Surface>

      <Surface
        accessibilityLabel="打开应用默认规格"
        onPress={() => router.push("/default-image-spec")}
        pressFeedbackDelayMs={SCROLL_PRESS_FEEDBACK_DELAY_MS}
        variant="interactive"
      >
        <View className="min-h-[72px] flex-row items-center gap-3 px-3.5 py-3">
          <View
            className="h-10 w-10 items-center justify-center rounded-[14px] bg-app-action-soft"
            style={{ borderCurve: "continuous" }}
          >
            <SymbolIcon
              className="h-[22px] w-[22px]"
              name="photo"
              tintColor={actionColor}
            />
          </View>
          <View className="flex-1 gap-1">
            <Text
              className="text-base font-bold leading-[22px] text-app-ink"
            >
              应用默认规格
            </Text>
            <Text
              className="text-[13px] leading-[18px] text-app-ink-muted"
            >
              尺寸：{getImageTaskSizeLabel(settings.defaultImageSpec.size)} ·
              质量：自动
            </Text>
          </View>
          <SymbolIcon
            className="h-5 w-5"
            name="chevron-right"
            tintColor={mutedColor}
          />
        </View>
      </Surface>
    </ScreenScrollView>
  );
}
