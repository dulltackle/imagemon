import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppSettings } from "../../src/app-state";

export default function SettingsScreen() {
  const router = useRouter();
  const settings = useAppSettings();

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>设置</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/model-configurations")}
        style={({ pressed }) => [styles.rowButton, pressed && styles.pressed]}
      >
        <View style={styles.rowIcon}>
          <Ionicons color="#0F766E" name="server-outline" size={22} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>模型配置</Text>
          <Text style={styles.rowSubtitle}>
            图片默认：{settings.defaultImageModelConfigurationId ? "已设置" : "未设置"} · 文本默认：
            {settings.defaultTextModelConfigurationId ? "已设置" : "未设置"}
          </Text>
        </View>
        <Ionicons color="#64748B" name="chevron-forward" size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  pressed: {
    opacity: 0.78,
  },
  rowButton: {
    alignItems: "center",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 20,
    minHeight: 72,
    paddingHorizontal: 14,
  },
  rowIcon: {
    alignItems: "center",
    backgroundColor: "#CCFBF1",
    borderRadius: 8,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  rowSubtitle: {
    color: "#64748B",
    fontSize: 13,
    lineHeight: 18,
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "700",
  },
  screen: {
    backgroundColor: "#F8FAFC",
    flex: 1,
    gap: 18,
  },
  title: {
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "800",
  },
});
