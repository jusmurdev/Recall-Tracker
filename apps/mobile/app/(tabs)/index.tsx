import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { CATEGORY_LABEL, type RecallCategory, type RecallSeverity } from "@recall/shared";
import { Empty, Input, Loading, Pill, RecallRow, Screen } from "@/components/ui";
import { useRecallFeed, useStats } from "@/hooks/queries";
import { useLocationState } from "@/hooks/useLocationState";
import { colors, spacing } from "@/lib/theme";

const CATEGORIES: Array<RecallCategory | "all"> = ["all", "food", "meat_poultry", "dietary_supplement", "veterinary", "cosmetic", "drug", "medical_device", "consumer_product"];
const SEVERITIES: Array<RecallSeverity | "all"> = ["all", "critical", "high", "low"];

export default function RecallsScreen() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<RecallCategory | "all">("all");
  const [severity, setSeverity] = useState<RecallSeverity | "all">("all");
  const [nearMe, setNearMe] = useState(false);
  const loc = useLocationState();
  const stateFilter = nearMe ? (loc.state ?? undefined) : undefined;
  const query = useMemo(
    () => ({ q: q.trim() || undefined, category: category === "all" ? undefined : category, severity: severity === "all" ? undefined : severity, state: stateFilter }),
    [q, category, severity, stateFilter],
  );
  const toggleNearMe = async () => {
    if (nearMe) return setNearMe(false);
    const p = loc.place ?? (await loc.refresh({ ask: true }));
    if (p?.state) setNearMe(true);
  };
  const feed = useRecallFeed(query);
  const stats = useStats();
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: spacing(2), gap: spacing(1.5), paddingBottom: spacing(6) }}
        refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} tintColor={colors.accent} />}
        onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && void feed.fetchNextPage()}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={
          <View style={{ gap: spacing(1.5) }}>
            {stats.data ? (
              <View style={styles.statsRow}>
                <Stat label="Last 7 days" value={stats.data.last7Days} />
                <Stat label="Critical" value={stats.data.severityLast7Days.critical ?? 0} color={colors.critical} />
                <Stat label="Sources" value={stats.data.sources.filter((s) => s.healthy).length + "/" + stats.data.sources.length} />
              </View>
            ) : null}
            <Input placeholder="Search recalls (brand, product, allergen…)" value={q} onChangeText={setQ} autoCorrect={false} returnKeyType="search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {CATEGORIES.map((c) => (
                <Pill key={c} label={c === "all" ? "All" : CATEGORY_LABEL[c]} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Pill label={nearMe && loc.state ? `Sold in ${loc.state}` : loc.busy ? "Locating…" : "Near me"} active={nearMe} onPress={() => void toggleNearMe()} />
              {SEVERITIES.map((s) => (
                <Pill key={s} label={s === "all" ? "Any severity" : s[0]!.toUpperCase() + s.slice(1)} active={severity === s} onPress={() => setSeverity(s)} />
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={feed.isLoading ? <Loading /> : <Empty title="No recalls match" body={feed.error ? String(feed.error) : "Try a broader search or category."} />}
        renderItem={({ item }) => <RecallRow recall={item} onPress={() => router.push(`/recall/${item.id}`)} />}
        ListFooterComponent={feed.isFetchingNextPage ? <Loading /> : null}
      />
    </Screen>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statsRow: { flexDirection: "row", gap: spacing(1) },
  stat: { flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: spacing(1.5), borderWidth: 1, borderColor: colors.border },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 12 },
});
