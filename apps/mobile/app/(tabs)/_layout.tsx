import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { useAlerts } from "@/hooks/queries";
import { colors } from "@/lib/theme";

export default function TabsLayout() {
  const alerts = useAlerts();
  const unread = alerts.data?.unread ?? 0;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="browse" options={{ title: "Browse", tabBarIcon: ({ color, size }) => <Ionicons name="search-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="scan" options={{ title: "Scan", tabBarIcon: ({ color, size }) => <Ionicons name="scan-outline" color={color} size={size + 2} /> }} />
      <Tabs.Screen
        name="alerts"
        options={{
          title: "Alerts",
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.critical, fontSize: 10 },
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen name="settings" options={{ title: "You", tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="watchlist" options={{ href: null }} />
    </Tabs>
  );
}
