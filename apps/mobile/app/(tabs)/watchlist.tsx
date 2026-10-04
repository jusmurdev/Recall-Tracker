import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Alert as RNAlert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { WatchItem } from "@recall/shared";
import { Button, Empty, Loading, PremiumTag, Screen } from "@/components/ui";
import { useDeleteWatchItem, useMe, useWatchlist } from "@/hooks/queries";
import { colors, spacing } from "@/lib/theme";

const KIND_ICON: Record<WatchItem["kind"], React.ComponentProps<typeof Ionicons>["name"]> = {
  product: "pricetag-outline",
  upc: "barcode-outline",
  scan: "scan-outline",
  restaurant: "restaurant-outline",
  category: "layers-outline",
};

export default function WatchlistScreen() {
  const list = useWatchlist();
  const me = useMe();
  const del = useDeleteWatchItem();
  const items = list.data?.items ?? [];
  const premium = me.data?.tier === "premium";

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(w) => w.id}
        contentContainerStyle={{ padding: spacing(2), gap: spacing(1.5) }}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={colors.accent} />}
        ListHeaderComponent={
          <View style={{ gap: spacing(1) }}>
            <Button title="Watch a product, brand or barcode" onPress={() => router.push("/watch/new")} />
            <Button title="Subscribe to a whole category" variant="ghost" onPress={() => router.push("/watch/subscribe")} />
            <Pressable onPress={() => router.push(premium ? "/watch/restaurant" : "/premium")} style={styles.restaurantCta}>
              <Ionicons name="restaurant-outline" size={20} color={colors.premium} />
              <Text style={styles.restaurantText}>Track a restaurant's suppliers</Text>
              <PremiumTag />
            </Pressable>
          </View>
        }
        ListEmptyComponent={list.isLoading ? <Loading /> : <Empty title="Nothing watched yet" body="Add the brands you buy, scan labels in your pantry, or import your grocery history (Premium)." />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/watch/${item.id}`)} style={styles.row}>
            <Ionicons name={KIND_ICON[item.kind]} size={22} color={item.kind === "restaurant" ? colors.premium : colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {item.kind === "category" ? `${item.categories.join(", ").replace(/_/g, " ")}${item.minSeverity && item.minSeverity !== "unknown" ? ` · ${item.minSeverity}+` : ""}` : item.upc ? `UPC ${item.upc}` : item.terms.join(" · ")}
                {item.importedFrom ? ` · from ${item.importedFrom}` : ""}
              </Text>
              {item.kind === "restaurant" ? (
                <Text style={styles.meta}>{item.researchUpdatedAt ? "Supplier research ready" : "Researching suppliers…"}</Text>
              ) : null}
            </View>
            <Pressable
              hitSlop={10}
              onPress={() =>
                RNAlert.alert("Stop watching?", item.label, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => del.mutate(item.id) },
                ])
              }
            >
              <Ionicons name="trash-outline" size={20} color={colors.muted} />
            </Pressable>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing(2), backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  label: { color: colors.text, fontWeight: "700", fontSize: 15 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  restaurantCta: { flexDirection: "row", alignItems: "center", gap: 10, padding: spacing(1.5), borderRadius: 12, borderWidth: 1, borderColor: colors.premium, backgroundColor: colors.card },
  restaurantText: { color: colors.text, flex: 1, fontWeight: "600" },
});
