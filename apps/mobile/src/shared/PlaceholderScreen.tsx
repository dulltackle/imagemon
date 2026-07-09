import { Text, View } from "@/tw";

interface PlaceholderScreenProps {
  title: string;
}

export function PlaceholderScreen({ title }: PlaceholderScreenProps) {
  return (
    <View className="flex-1 items-center justify-center bg-slate-50 p-6">
      <Text className="text-3xl font-bold leading-10 text-slate-900">
        {title}
      </Text>
    </View>
  );
}
