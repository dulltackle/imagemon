import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import {
  useAppSettings,
  useModelConfigurationRepository,
} from "../../../src/app-state";
import type { ModelConfiguration } from "../../../src/model-configurations";
import {
  Pressable,
  ScrollView,
  SymbolIcon,
  Text,
  useCSSVariable,
  View,
} from "../../../src/tw";

export default function SettingsScreen() {
  const router = useRouter();
  const settings = useAppSettings();
  const repository = useModelConfigurationRepository();
  const accentColor = useCSSVariable("--sf-blue");
  const mutedColor = useCSSVariable("--sf-text-2");
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
    <ScrollView
      className="flex-1 bg-sf-bg-2"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-[18px] px-5 pb-8 pt-5"
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/model-configurations")}
        className="min-h-[72px] flex-row items-center gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 px-3.5 active:opacity-75"
      >
        <View className="h-10 w-10 items-center justify-center rounded-lg bg-sf-fill">
          <SymbolIcon
            className="h-[22px] w-[22px]"
            name="server.rack"
            tintColor={accentColor}
          />
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-base font-bold leading-[22px] text-sf-text" selectable>
            模型配置
          </Text>
          <Text
            className="text-[13px] leading-[18px] text-sf-text-2"
            selectable
          >
            图片默认：{defaultImageConfiguration?.modelName ?? "未设置"} ·
            文本默认：
            {defaultTextConfiguration?.modelName ?? "未设置"}
          </Text>
        </View>
        <SymbolIcon
          className="h-5 w-5"
          name="chevron.right"
          tintColor={mutedColor}
        />
      </Pressable>
    </ScrollView>
  );
}
