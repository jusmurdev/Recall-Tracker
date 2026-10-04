import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Alert as RNAlert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { WatchItem } from "@recall/shared";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActionTile, Empty, Loading, PremiumTag, Screen, Small, Title } from "@/components/ui";
import { useDeleteWatchItem, useMe, useWatchlist } from "@/hooks/queries";
import { CATEGORY_FRIENDLY } from "@/lib/friendly";
import { colors, radius, spacing } from "@/lib/theme";

const KIND: Record<WatchItem["kind"], { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string }> = {
  product: { icon: "pricetag", label: "Brand or product" },
  upc: { icon: "barcode", label: "Barcode" },
  scan: { icon: "scan", label: "Scanned label" },
  restaurant: { icon: "restaurant", label: "Restaurant" },
  category: { icon: "layers", label: "Category" },
};

export default function WatchlistScreen() {
  const list = useWatchlist();
  const me = useMe();
  const del = useDeleteWatchItem();
  const items = list.data?.items ?? [];
  const premium = me.data?.tier === "premium";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(w) => w.id}
        contentContainerStyle={{ padding: spacing(2), gap: spacing(1.5), paddingBottom: spacing(6) }}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={colors.accent} />}
        ListHeaderComponent={
          <View style={{ gap: spacing(1.5) }}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="chevron-back" size={20} color={colors.accent} />
              <Text style={{ color: colors.accent, fontWeight: "700" }}>Home</Text>
            </Pressable>
            <Title>Things you watch</Title>
            <Small>We check every new recall against these and tell you if there's a match.</Small>
            <View style={{ flexDirection: "row", gap: spacing(1.5) }}>
              <ActionTile icon="add-circle" title="Add a brand" subtitle="Or a product you buy" onPress={() => router.push("/watch/new")} />
              <ActionTile icon="layers" title="Follow a category" subtitle="e.g. all baby food" onPress={() => router.push("/watch/subscribe")} tone="soft" />
            </View>
            <Pressable onPress={() => router.push(premium ? "/watch/restaurant" : "/premium")} accessibilityRole="button" style={styles.restaurantCta}>
              <Ionicons name="restaurant" size={20} color={colors.premium} />
              <Text style={styles.restaurantText}>Track a restaurant's health grade</Text>
              <PremiumTag />
            </Pressable>
          </View>
        }
        ListEmptyComponent={list.isLoading ? <Loading /> : <Empty icon="eye-outline" title="Nothing yet" body="Start with the staples: the peanut butter, the baby formula, the dog food." />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/watch/${item.id}`)} style={styles.row} accessibilityRole="button" accessibilityLabel={item.label}>
            <View style={[styles.icon, { backgroundColor: item.kind === "restaurant" ? colors.premiumSoft : colors.accentSoft }]}>
              <Ionicons name={KIND[item.kind].icon} size={20} color={item.kind === "restaurant" ? colors.premium : colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {item.kind === "category"
                  ? item.categories.map((c) => CATEGORY_FRIENDLY[c]).join(", ")
                  : item.kind === "restaurant"
                    ? item.researchUpdatedAt ? "Watching suppliers & health grade" : "Looking into suppliers…"
                    : KIND[item.kind].label}
              </Text>
            </View>
            <Pressable
              hitSlop={10}
              accessibilityLabel={`Stop watching ${item.label}`}
              onPress={() =>
                RNAlert.alert("Stop watching?", item.label, [
                  { text: "Keep", style: "cancel" },
                  { text: "Stop", style: "destructive", onPress: () => del.mutate(item.id) },
                ])
              }
            >
              <Ionicons name="close-circle-outline" size={22} color={colors.muted} />
            </Pressable>
          </Pressable>
        )}
      />
    </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing(1.75), backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  label: { color: colors.text, fontWeight: "700", fontSize: 16 },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  restaurantCta: { flexDirection: "row", alignItems: "center", gap: 10, padding: spacing(1.75), borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  restaurantText: { color: colors.text, flex: 1, fontWeight: "600" },
});
