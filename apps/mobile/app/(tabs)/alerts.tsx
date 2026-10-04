import { router } from "expo-router";
import React from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Button, Empty, Loading, RecallRow, Screen } from "@/components/ui";
import { useAlerts } from "@/hooks/queries";
import { api } from "@/api/client";
import { colors, spacing } from "@/lib/theme";
import { useQueryClient } from "@tanstack/react-query";

export default function AlertsScreen() {
  const alerts = useAlerts();
  const qc = useQueryClient();
  const items = alerts.data?.items ?? [];
  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: spacing(2), gap: spacing(1.5) }}
        refreshControl={<RefreshControl refreshing={alerts.isRefetching} onRefresh={() => void alerts.refetch()} tintColor={colors.accent} />}
        ListHeaderComponent={
          (alerts.data?.unread ?? 0) > 0 ? (
            <Button
              title={`Mark all ${alerts.data!.unread} read`}
              variant="ghost"
              onPress={async () => {
                await api.markAllRead();
                void qc.invalidateQueries({ queryKey: ["alerts"] });
              }}
            />
          ) : null
        }
        ListEmptyComponent={
          alerts.isLoading ? <Loading /> : <Empty title="No alerts yet" body="When a recall matches something you watch or scan, it shows up here and as a push notification." />
        }
        renderItem={({ item }) => (
          <View style={{ opacity: item.readAt ? 0.7 : 1 }}>
            <RecallRow
              recall={item.recall}
              onPress={() => router.push(`/alert/${item.id}`)}
              footer={
                <View style={styles.footer}>
                  {!item.readAt ? <View style={styles.dot} /> : null}
                  <Text style={[styles.why, item.resolvedAt && { color: colors.muted }]} numberOfLines={2}>
                    {item.resolvedAt ? "✓ Handled · " : ""}
                    {item.watchItemLabel ? `${item.watchItemLabel} · ` : ""}
                    {item.explanation}
                  </Text>
                </View>
              }
            />
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  why: { color: colors.accent, fontSize: 12, flex: 1 },
});
