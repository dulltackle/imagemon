import { useRouter } from "expo-router";
import { useState } from "react";

import {
  useAppSettings,
  useModelConfigurationRepository,
  useReplaceAppSettings,
} from "../src/app-state";
import {
  APPLICATION_DEFAULT_IMAGE_SPEC,
  getImageTaskSizeLabel,
} from "../src/image-tasks/default-spec";
import {
  IMAGE_TASK_AVAILABLE_SIZES,
  type ImageTaskSize,
} from "../src/image-tasks/types";
import { Pressable, ScrollView, Text, View, cn } from "../src/tw";

const FIXED_DIMENSIONS = [
  { label: "质量", value: "自动（当前版本固定）" },
  { label: "格式", value: "PNG（当前版本固定）" },
  { label: "数量", value: "1 张（当前版本固定）" },
];

export default function DefaultImageSpecScreen() {
  const router = useRouter();
  const settings = useAppSettings();
  const repository = useModelConfigurationRepository();
  const replaceSettings = useReplaceAppSettings();
  const [size, setSize] = useState<ImageTaskSize>(
    settings.defaultImageSpec.size,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setIsSaving(true);
    setError(null);
    try {
      const nextSettings = await repository.updateDefaultImageSpec({
        ...APPLICATION_DEFAULT_IMAGE_SPEC,
        size,
      });
      replaceSettings(nextSettings);
      router.back();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存失败，请重试。",
      );
      setIsSaving(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-sf-bg-2"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-[18px] px-5 pb-8 pt-5"
    >
      <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <Text
          className="text-base font-bold leading-[22px] text-sf-text"
          selectable
        >
          尺寸
        </Text>
        <View className="flex-row gap-2">
          {IMAGE_TASK_AVAILABLE_SIZES.map((option) => {
            const selected = option === size;
            return (
              <Pressable
                accessibilityRole="button"
                key={option}
                onPress={() => setSize(option)}
                className={cn(
                  "min-h-16 flex-1 items-center justify-center gap-1 rounded-lg border border-sf-separator px-2 py-2.5 active:opacity-75",
                  selected && "border-sf-blue bg-sf-fill",
                )}
              >
                <Text
                  className={cn(
                    "text-sm font-extrabold leading-5",
                    selected ? "text-sf-blue" : "text-sf-text",
                  )}
                  selectable
                >
                  {getImageTaskSizeLabel(option)}
                </Text>
                <Text
                  className={cn(
                    "text-xs font-bold leading-4",
                    selected ? "text-sf-blue" : "text-sf-text-2",
                  )}
                  selectable
                >
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text className="text-[13px] leading-[18px] text-sf-text-2" selectable>
          新任务表单会预填这里的尺寸，执行前仍可按次修改，且不会写回默认。
        </Text>
      </View>

      <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <Text
          className="text-base font-bold leading-[22px] text-sf-text"
          selectable
        >
          其他维度
        </Text>
        {FIXED_DIMENSIONS.map((dimension) => (
          <View
            className="flex-row items-center justify-between gap-3"
            key={dimension.label}
          >
            <Text
              className="text-[15px] leading-[22px] text-sf-text"
              selectable
            >
              {dimension.label}
            </Text>
            <Text
              className="text-[15px] leading-[22px] text-sf-text-2"
              selectable
            >
              {dimension.value}
            </Text>
          </View>
        ))}
      </View>

      {error ? (
        <View className="rounded-lg border border-sf-red bg-sf-bg-3 p-3.5">
          <Text className="text-[13px] leading-[18px] text-sf-red" selectable>
            {error}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={isSaving}
        onPress={() => void save()}
        className={cn(
          "min-h-12 items-center justify-center rounded-lg bg-sf-blue px-4 active:opacity-75",
          isSaving && "opacity-50",
        )}
      >
        <Text
          className="text-base font-bold leading-[22px] text-white"
          selectable
        >
          {isSaving ? "正在保存…" : "保存"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
