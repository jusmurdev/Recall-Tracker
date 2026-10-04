import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { type RecallCategory, type RecallSeverity } from "@recall/shared";
import { Button, Empty, Input, Loading, OfflineNotice, Pill, RecallRow, Small, Title } from "@/components/ui";
import { ApiError } from "@/api/client";
import { useMe, useRecallFeed } from "@/hooks/queries";
import { hasDiet } from "@/lib/diet";
import { useLocationState } from "@/hooks/useLocationState";
import { CATEGORY_EMOJI, CATEGORY_FRIENDLY } from "@/lib/friendly";
import { colors, spacing } from "@/lib/theme";

const CATEGORIES: Array<RecallCategory | "all"> = ["all", "food", "meat_poultry", "veterinary", "dietary_supplement", "cosmetic", "drug", "consumer_product", "medical_device"];
const SEVERITIES: Array<{ v: RecallSeverity | "all"; label: string }> = [
  { v: "all", label: "Any" },
  { v: "critical", label: "Serious" },
  { v: "high", label: "Moderate" },
  { v: "low", label: "Minor" },
];

export default function BrowseScreen() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<RecallCategory | "all">("all");
  const [severity, setSeverity] = useState<RecallSeverity | "all">("all");
  const [nearMe, setNearMe] = useState(false);
  const [forDiet, setForDiet] = useState(false);
  const me = useMe();
  const dietConfigured = hasDiet(me.data?.diet);
  const loc = useLocationState();
  const query = useMemo(
    () => ({ q: q.trim() || undefined, category: category === "all" ? undefined : category, severity: severity === "all" ? undefined : severity, state: nearMe ? (loc.state ?? undefined) : undefined, diet: forDiet || undefined }),
    [q, category, severity, nearMe, loc.state, forDiet],
  );
  const feed = useRecallFeed(query);
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const offline = feed.isError && (feed.error instanceof ApiError ? feed.error.offline : true);
  const toggleNearMe = async () => {
    if (nearMe) return setNearMe(false);
    const p = loc.place ?? (await loc.refresh({ ask: true }));
    if (p?.state) setNearMe(true);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: spacing(2), gap: spacing(1.5), paddingBottom: spacing(6) }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} tintColor={colors.accent} />}
        onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && void feed.fetchNextPage()}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={
          <View style={{ gap: spacing(1.5) }}>
            <View>
              <Title>Browse recalls</Title>
              <Small>Everything from the FDA, USDA and CPSC, in plain English.</Small>
            </View>
            <Input placeholder="Search a brand, product or ingredient" value={q} onChangeText={setQ} autoCorrect={false} returnKeyType="search" />
            {offline && items.length ? <OfflineNotice stale onRetry={() => void feed.refetch()} /> : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pillRow}>
              <Pill label={nearMe && loc.state ? `Sold in ${loc.state}` : loc.busy ? "Locating…" : "Near me"} icon="location-outline" active={nearMe} onPress={() => void toggleNearMe()} />
              <Pill label="For my diet" icon="nutrition-outline" active={forDiet} onPress={() => (dietConfigured ? setForDiet((v) => !v) : router.push("/settings"))} />
              {SEVERITIES.map((s) => (
                <Pill key={s.v} label={s.label} active={severity === s.v} onPress={() => setSeverity(s.v)} />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pillRow}>
              {CATEGORIES.map((c) => (
                <Pill key={c} label={c === "all" ? "All" : `${CATEGORY_EMOJI[c]} ${CATEGORY_FRIENDLY[c]}`} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          feed.isLoading ? <Loading />
          : forDiet ? (
            <View style={{ gap: spacing(1.5) }}>
              <Empty icon="nutrition-outline" title="Nothing matches your diet right now" body="No current recall mentions the allergens or ingredients in your profile. We keep checking as new recalls come in." />
              <Button title="Edit my diet profile" variant="secondary" icon="person-circle-outline" onPress={() => router.push("/settings")} />
            </View>
          )
          : offline ? (
            <View style={{ gap: spacing(1.5) }}>
              <Empty icon="cloud-offline-outline" title="Can't reach the server" body="Check your connection and try again. Recalls you've already seen stay available offline." />
              <Button title="Try again" variant="secondary" icon="refresh" onPress={() => void feed.refetch()} />
            </View>
          )
          : <Empty icon="search-outline" title="Nothing here" body="Try a different word or widen the filters." />
        }
        renderItem={({ item }) => <RecallRow recall={item} note={forDiet ? item.dietHit?.explanation : undefined} onPress={() => router.push(`/recall/${item.id}`)} />}
        ListFooterComponent={feed.isFetchingNextPage ? <Loading /> : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Room on the right so the last chip is never clipped, and a fixed row height so chips do not
  // get squeezed when the keyboard is open.
  pillRow: { paddingRight: spacing(2), alignItems: "center", minHeight: 48 },
});
