import { router } from "expo-router";
import React from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Button, Empty, Loading, RecallRow, Small, Title } from "@/components/ui";
import { useAlerts } from "@/hooks/queries";
import { whyAlert } from "@/lib/friendly";
import { colors, spacing } from "@/lib/theme";

export default function AlertsScreen() {
  const alerts = useAlerts();
  const qc = useQueryClient();
  const items = [...(alerts.data?.items ?? [])].sort((a, b) => Number(!!a.resolvedAt) - Number(!!b.resolvedAt));
  const unread = alerts.data?.unread ?? 0;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: spacing(2), gap: spacing(1.5), paddingBottom: spacing(6) }}
        refreshControl={<RefreshControl refreshing={alerts.isRefetching} onRefresh={() => void alerts.refetch()} tintColor={colors.accent} />}
        ListHeaderComponent={
          <View style={{ gap: spacing(1.5) }}>
            <View>
              <Title>Alerts</Title>
              <Small>{unread ? `${unread} new. Tap one to see what to do.` : items.length ? "Nothing new. These are the ones you've seen." : "Recalls that match what you watch show up here."}</Small>
            </View>
            {unread > 0 ? (
              <Button
                title="Mark all as seen"
                variant="ghost"
                onPress={async () => {
                  await api.markAllRead();
                  void qc.invalidateQueries({ queryKey: ["alerts"] });
                }}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={alerts.isLoading ? <Loading /> : <Empty icon="notifications-off-outline" title="No alerts yet" body="When something you watch gets recalled, you'll hear about it here and on your lock screen." />}
        renderItem={({ item }) => (
          <View style={{ opacity: item.resolvedAt ? 0.55 : 1 }}>
            <RecallRow recall={item.recall} note={item.resolvedAt ? "✓ Handled" : whyAlert(item)} onPress={() => router.push(`/alert/${item.id}`)} />
          </View>
        )}
      />
    </SafeAreaView>
  );
}
