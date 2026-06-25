import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

type IconName = ComponentProps<typeof Ionicons>["name"];

function tabIcon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={String(color)} size={size} />;
  };
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#0F766E",
        tabBarInactiveTintColor: "#64748B",
        tabBarStyle: {
          borderTopColor: "#E2E8F0",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "图鉴",
          tabBarIcon: tabIcon("albums-outline"),
        }}
      />
      <Tabs.Screen
        name="images"
        options={{
          title: "图片",
          tabBarIcon: tabIcon("image-outline"),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "历史",
          tabBarIcon: tabIcon("time-outline"),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "设置",
          tabBarIcon: tabIcon("settings-outline"),
        }}
      />
    </Tabs>
  );
}
