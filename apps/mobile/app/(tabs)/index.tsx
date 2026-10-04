import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActionTile, Body, Card, Heading, Loading, PremiumTag, RecallRow, Small, Title } from "@/components/ui";
import { useAlerts, useMe, useRecallFeed, useReceipts, useRestaurantUpdates, useWatchlist } from "@/hooks/queries";
import { useLocationState } from "@/hooks/useLocationState";
import { whyAlert } from "@/lib/friendly";
import { colors, radius, spacing } from "@/lib/theme";

/**
 * Home leads with the one thing people want to know: am I okay? Then the two things they
 * came to do (check something, add something). Browsing all recalls lives on its own tab.
 */
export default function HomeScreen() {
  const me = useMe();
  const alerts = useAlerts();
  const list = useWatchlist();
  const updates = useRestaurantUpdates(me.data?.tier === "premium");
  const loc = useLocationState();
  const feed = useRecallFeed({ state: loc.state ?? undefined, severity: "critical" });
  const receipts = useReceipts();
  const lastReceipt = receipts.data?.items[0];

  const open = (alerts.data?.items ?? []).filter((a) => !a.resolvedAt && !a.dismissedAt);
  const unread = open.filter((a) => !a.readAt);
  const watching = list.data?.items.length ?? 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const latest = feed.data?.pages[0]?.items.slice(0, 3) ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: spacing(4) }} refreshControl={<RefreshControl refreshing={alerts.isRefetching} onRefresh={() => void Promise.all([alerts.refetch(), list.refetch(), feed.refetch()])} tintColor={colors.accent} />}>
        <View>
          <Small>{greeting}</Small>
          <Title>Recall Tracker</Title>
        </View>

        {alerts.isLoading ? (
          <Loading />
        ) : open.length ? (
          <Card tone={open.some((a) => a.recall.severity === "critical") ? "critical" : "high"}>
            <View style={styles.heroRow}>
              <Ionicons name="alert-circle" size={28} color={open.some((a) => a.recall.severity === "critical") ? colors.critical : colors.high} />
              <View style={{ flex: 1 }}>
                <Heading>
                  {open.length === 1 ? "1 thing needs a look" : `${open.length} things need a look`}
                </Heading>
                <Small>{unread.length ? `${unread.length} new since you last checked.` : "You've seen these. Tap to deal with them."}</Small>
              </View>
            </View>
            {open.slice(0, 2).map((a) => (
              <RecallRow key={a.id} recall={a.recall} note={whyAlert(a)} onPress={() => router.push(`/alert/${a.id}`)} />
            ))}
            {open.length > 2 ? (
              <Pressable onPress={() => router.push("/alerts")} accessibilityRole="button">
                <Text style={styles.link}>See all {open.length} →</Text>
              </Pressable>
            ) : null}
          </Card>
        ) : (
          <Card tone="success">
            <View style={styles.heroRow}>
              <Ionicons name="checkmark-circle" size={30} color={colors.success} />
              <View style={{ flex: 1 }}>
                <Heading>You're all clear</Heading>
                <Small>
                  {watching ? `Nothing you watch has been recalled. We're keeping an eye on ${watching} item${watching === 1 ? "" : "s"}.` : "Add a few things you buy and we'll watch them for you."}
                </Small>
              </View>
            </View>
          </Card>
        )}

        {updates.data?.unread ? (
          <Pressable onPress={() => router.push("/restaurant-updates")} accessibilityRole="button">
            <Card tone="premium">
              <View style={styles.heroRow}>
                <Ionicons name="restaurant" size={22} color={colors.premium} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "700" }}>{updates.data.items[0]?.title}</Body>
                  <Small>{updates.data.unread > 1 ? `and ${updates.data.unread - 1} more restaurant update${updates.data.unread > 2 ? "s" : ""}` : "Tap for details"}</Small>
                </View>
              </View>
            </Card>
          </Pressable>
        ) : null}

        <View style={{ flexDirection: "row", gap: spacing(1.5) }}>
          <ActionTile icon="scan" title="Check a product" subtitle="Scan a barcode or label" onPress={() => router.push("/scan")} />
          <ActionTile icon="receipt" title="Check a receipt" subtitle="Every item, in one snap" onPress={() => router.push("/scan")} tone="soft" />
        </View>
        {lastReceipt ? (
          <Pressable onPress={() => router.push(`/receipt/${lastReceipt.id}`)} accessibilityRole="button">
            <Card tone={lastReceipt.flaggedCount ? "high" : "soft"}>
              <View style={styles.heroRow}>
                <Ionicons name="receipt-outline" size={20} color={lastReceipt.flaggedCount ? colors.high : colors.muted} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "700" }}>
                    Last receipt{lastReceipt.store ? ` · ${lastReceipt.store}` : ""}: {lastReceipt.flaggedCount ? `${lastReceipt.flaggedCount} item${lastReceipt.flaggedCount > 1 ? "s" : ""} flagged` : "all clear"}
                  </Body>
                  <Small>{lastReceipt.itemCount} items · tap to re-check against today's recalls</Small>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </View>
            </Card>
          </Pressable>
        ) : null}

        <Pressable onPress={() => router.push("/watchlist")} accessibilityRole="button">
          <Card>
            <View style={styles.heroRow}>
              <View style={[styles.iconBubble, { backgroundColor: colors.accentSoft }]}>
                <Ionicons name="eye" size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>{watching ? `Watching ${watching} item${watching === 1 ? "" : "s"}` : "Not watching anything yet"}</Body>
                <Small>{watching ? "Brands, barcodes, restaurants and categories" : "Start with the staples in your fridge"}</Small>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </View>
          </Card>
        </Pressable>

        <View style={{ gap: spacing(1) }}>
          <View style={styles.sectionRow}>
            <Heading>Serious recalls {loc.state ? `near ${loc.state}` : "right now"}</Heading>
            <Pressable onPress={() => router.push("/browse")} accessibilityRole="button">
              <Text style={styles.link}>Browse all</Text>
            </Pressable>
          </View>
          {latest.length ? latest.map((r) => <RecallRow key={r.id} recall={r} onPress={() => router.push(`/recall/${r.id}`)} />) : feed.isLoading ? <Loading /> : <Small>No serious recalls this week. Nice.</Small>}
        </View>

        {me.data?.tier !== "premium" ? (
          <Pressable onPress={() => router.push("/premium")} accessibilityRole="button">
            <Card tone="premium">
              <View style={styles.heroRow}>
                <Ionicons name="sparkles" size={22} color={colors.premium} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "700" }}>Eat out with confidence</Body>
                  <Small>Track restaurants' health grades and suppliers, and import what you buy.</Small>
                </View>
                <PremiumTag />
              </View>
            </Card>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBubble: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  link: { color: colors.accent, fontWeight: "700", fontSize: 14 },
});
