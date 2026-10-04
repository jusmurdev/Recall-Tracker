import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { DietHit } from "@recall/shared";
import { Button, Card, Small, Subtitle } from "@/components/ui";
import { DIET_KIND_LABEL } from "@/lib/diet";
import { colors, radius } from "@/lib/theme";

/**
 * "Heads up for your diet": words on a label or receipt line that matter for the user's profile,
 * shown whether or not anything is recalled. Honest by design: a heads-up is about words.
 */
export function DietHeadsUp({ hits, compact }: { hits: DietHit[]; compact?: boolean }) {
  if (!hits.length) return null;
  const serious = hits.some((h) => h.kind === "undeclared" || h.kind === "mention");
  if (compact) {
    return (
      <View style={styles.tags}>
        {hits.map((h) => (
          <View key={`${h.profile}-${h.term}`} style={[styles.tag, h.kind === "ambiguous" && styles.tagSoft]} accessibilityLabel={`${h.label}: ${DIET_KIND_LABEL[h.kind]} ${h.phrase}`}>
            <Ionicons name="nutrition-outline" size={12} color={h.kind === "ambiguous" ? colors.muted : colors.high} />
            <Text style={[styles.tagText, h.kind === "ambiguous" && { color: colors.muted }]} numberOfLines={1}>
              {h.label}: {h.kind === "ambiguous" ? "might contain" : "mentions"} {h.phrase.toLowerCase()}
            </Text>
          </View>
        ))}
      </View>
    );
  }
  return (
    <Card tone={serious ? "high" : "soft"}>
      <View style={styles.row}>
        <Ionicons name="nutrition-outline" size={24} color={serious ? colors.high : colors.muted} />
        <View style={{ flex: 1 }}>
          <Subtitle>Heads up for your diet</Subtitle>
          <Small>Not a recall. These words on the label matter for the profile you set.</Small>
        </View>
      </View>
      {hits.map((h) => (
        <View key={`${h.profile}-${h.term}`} style={styles.hit}>
          <Text style={styles.hitTitle}>
            {h.label} · {DIET_KIND_LABEL[h.kind].toLowerCase()}
          </Text>
          <Text style={styles.hitBody}>{h.explanation}</Text>
        </View>
      ))}
      <Button title="About diet alerts" variant="ghost" icon="help-circle-outline" onPress={() => router.push("/diet-info")} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  hit: { gap: 2, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.06)" },
  hitTitle: { color: colors.text, fontWeight: "700", fontSize: 15 },
  hitBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.highSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, maxWidth: "100%" },
  tagSoft: { backgroundColor: colors.unknownSoft },
  tagText: { color: colors.high, fontSize: 12, fontWeight: "600" },
});
