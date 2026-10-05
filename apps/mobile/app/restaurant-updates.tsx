import { router } from "expo-router";
import React, { useEffect } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Empty, Loading, Screen } from "@/components/ui";
import { useMe, useRestaurantUpdates } from "@/hooks/queries";
import { useBottomPad } from "@/hooks/useBottomPad";
import { colors, spacing } from "@/lib/theme";

/** Grade changes, closures and research refreshes for the restaurants you track. */
export default function RestaurantUpdates() {
  const me = useMe();
  const updates = useRestaurantUpdates(me.data?.tier === "premium");
  const qc = useQueryClient();
  const bottomPad = useBottomPad();
  useEffect(() => {
    if (updates.data?.unread) void api.restaurantUpdatesReadAll().then(() => qc.invalidateQueries({ queryKey: ["restaurant-updates"] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updates.data?.unread]);
  return (
    <Screen edges={["bottom"]}>
      <FlatList
        data={updates.data?.items ?? []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: spacing(2), gap: spacing(1.5), paddingBottom: bottomPad }}
        ListEmptyComponent={updates.isLoading ? <Loading /> : <Empty title="No restaurant updates" body="You'll see health-grade changes and closures for restaurants you track here." />}
        renderItem={({ item }) => {
          const dir = (item.data as { direction?: string } | null)?.direction;
          return (
            <Pressable onPress={() => item.watchItemId && router.push(`/watch/${item.watchItemId}`)} style={[styles.row, { borderColor: dir === "worse" ? colors.critical : dir === "better" ? colors.accent : colors.border }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.body}>{item.body}</Text>
                <Text style={styles.meta}>{new Date(item.createdAt).toLocaleString()}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { padding: spacing(2), backgroundColor: colors.card, borderRadius: 14, borderWidth: 1 },
  title: { color: colors.text, fontWeight: "700" },
  body: { color: colors.text, fontSize: 13, opacity: 0.85 },
  meta: { color: colors.muted, fontSize: 12 },
});
