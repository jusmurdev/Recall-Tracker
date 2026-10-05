import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ReceiptItem, ReceiptScanResponse } from "@recall/shared";
import { Card, PremiumTag, RecallRow, Small, Subtitle } from "@/components/ui";
import { DietHeadsUp } from "@/components/DietHeadsUp";
import { plainReason } from "@/lib/friendly";
import { useMe } from "@/hooks/queries";
import { colors, radius } from "@/lib/theme";

const STATUS: Record<ReceiptItem["status"], { icon: React.ComponentProps<typeof Ionicons>["name"]; color: string; label: string }> = {
  recalled: { icon: "alert-circle", color: colors.critical, label: "Recalled" },
  possible: { icon: "help-circle", color: colors.high, label: "Maybe" },
  clear: { icon: "checkmark-circle", color: colors.success, label: "Fine" },
};

/** Line-by-line receipt verdict: flagged items first, each tappable to the recall. */
export function ReceiptResults({ result }: { result: ReceiptScanResponse }) {
  const premium = useMe().data?.tier === "premium";
  const items = [...result.items].sort((a, b) => rank(a.status) - rank(b.status));
  const flagged = result.items.filter((i) => i.status !== "clear");
  // Only what is really being watched: generic lines ("bananas") are never added.
  const watchedCount = result.items.filter((i) => i.watchItemId).length;
  return (
    <>
      <Card tone={flagged.some((i) => i.status === "recalled") ? "critical" : flagged.length ? "high" : "success"}>
        <View style={styles.heroRow}>
          <Ionicons name={flagged.length ? "alert-circle" : "checkmark-circle"} size={32} color={flagged.length ? colors.critical : colors.success} />
          <View style={{ flex: 1 }}>
            <Subtitle>{flagged.length ? `${flagged.length} of ${result.items.length} items need a look` : `All ${result.items.length} items look fine`}</Subtitle>
            <Small>
              {result.store ? `${result.store}` : "Receipt"}
              {result.purchasedAt ? ` · ${result.purchasedAt}` : ""}
              {watchedCount ? ` · watching ${watchedCount === result.items.length ? (watchedCount === 1 ? "it" : `all ${watchedCount}`) : `${watchedCount} of ${result.items.length}`}` : ""}
              {result.decodedByAi ? " · decoded with AI" : ""}
            </Small>
          </View>
        </View>
        {result.skippedLines > 0 && result.items.length === 0 ? <Small>We couldn't find any products on this receipt. Try a clearer photo or type the lines in.</Small> : null}
      </Card>
      {items.map((item, idx) => {
        const s = STATUS[item.status];
        const top = item.matches[0];
        return (
          <Pressable key={`${item.raw}-${idx}`} accessibilityRole="button" accessibilityLabel={`${s.label}: ${item.product}`} disabled={!top} onPress={() => top && router.push(`/recall/${top.recall.id}`)} style={[styles.row, item.status !== "clear" && { borderColor: s.color }]}>
            <Ionicons name={s.icon} size={22} color={s.color} />
            <View style={{ flex: 1 }}>
              <Text style={styles.product}>{titleCase(item.product)}</Text>
              <Text style={styles.raw} numberOfLines={1}>
                {item.raw}
              </Text>
              {top && item.status !== "clear" ? (
                <Text style={[styles.why, { color: s.color }]} numberOfLines={2}>
                  {plainReason(top.recall.reason, top.recall.summary)} · tap for what to do
                </Text>
              ) : null}
              {item.dietFlags?.length ? <DietHeadsUp hits={item.dietFlags} compact /> : null}
            </View>
            {top && item.status !== "clear" ? <Ionicons name="chevron-forward" size={18} color={colors.border} /> : null}
          </Pressable>
        );
      })}
      {!premium && !result.decodedByAi && result.items.some((i) => i.terms.every((t) => t.length <= 4)) ? (
        <View style={styles.tip}>
          <PremiumTag />
          <Small style={{ flex: 1 }}>Some lines were hard to decode. Premium reads the photo with AI for a cleaner result.</Small>
        </View>
      ) : null}
      {flagged.length > 0 && flagged[0]?.matches[0] ? (
        <>
          <Subtitle>The recall{flagged.length > 1 ? "s" : ""}</Subtitle>
          {dedupe(flagged.flatMap((i) => i.matches.slice(0, 1))).map((m) => (
            <RecallRow key={m.recall.id} recall={m.recall} onPress={() => router.push(`/recall/${m.recall.id}`)} />
          ))}
        </>
      ) : null}
    </>
  );
}

function rank(s: ReceiptItem["status"]): number {
  return s === "recalled" ? 0 : s === "possible" ? 1 : 2;
}
function dedupe<T extends { recall: { id: string } }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.recall.id) ? false : (seen.add(x.recall.id), true)));
}
function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  product: { color: colors.text, fontWeight: "700", fontSize: 15 },
  raw: { color: colors.muted, fontSize: 12 },
  why: { fontSize: 13, marginTop: 2 },
  tip: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: colors.premiumSoft, borderRadius: radius.md },
});
