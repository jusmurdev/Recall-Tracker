import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { type RecallCategory, type RecallSeverity } from "@recall/shared";
import { Empty, Input, Loading, Pill, RecallRow, Small, Title } from "@/components/ui";
import { useRecallFeed } from "@/hooks/queries";
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
  const loc = useLocationState();
  const query = useMemo(
    () => ({ q: q.trim() || undefined, category: category === "all" ? undefined : category, severity: severity === "all" ? undefined : severity, state: nearMe ? (loc.state ?? undefined) : undefined }),
    [q, category, severity, nearMe, loc.state],
  );
  const feed = useRecallFeed(query);
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Pill label={nearMe && loc.state ? `Sold in ${loc.state}` : loc.busy ? "Locating…" : "Near me"} icon="location-outline" active={nearMe} onPress={() => void toggleNearMe()} />
              {SEVERITIES.map((s) => (
                <Pill key={s.v} label={s.label} active={severity === s.v} onPress={() => setSeverity(s.v)} />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {CATEGORIES.map((c) => (
                <Pill key={c} label={c === "all" ? "All" : `${CATEGORY_EMOJI[c]} ${CATEGORY_FRIENDLY[c]}`} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={feed.isLoading ? <Loading /> : <Empty icon="search-outline" title="Nothing here" body="Try a different word or widen the filters." />}
        renderItem={({ item }) => <RecallRow recall={item} onPress={() => router.push(`/recall/${item.id}`)} />}
        ListFooterComponent={feed.isFetchingNextPage ? <Loading /> : null}
      />
    </SafeAreaView>
  );
}
