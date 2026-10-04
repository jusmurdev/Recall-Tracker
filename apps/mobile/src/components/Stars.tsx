import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";
import type { SafetyRating } from "@recall/shared";
import { colors } from "@/lib/theme";

const levelColor: Record<SafetyRating["level"], string> = { good: colors.success, ok: colors.high, poor: colors.critical, unknown: colors.unknown };

/** 1–5 stars in half steps, coloured by level. "No rating" when there's nothing to rate on. */
export function Stars({ rating, size = 16, showNumber = true }: { rating: SafetyRating; size?: number; showNumber?: boolean }) {
  if (rating.stars == null) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }} accessibilityLabel="No safety rating yet">
        <Ionicons name="help-circle-outline" size={size} color={colors.muted} />
        <Text style={{ color: colors.muted, fontSize: size * 0.8 }}>No rating yet</Text>
      </View>
    );
  }
  const color = levelColor[rating.level];
  const icons: Array<React.ComponentProps<typeof Ionicons>["name"]> = [];
  for (let i = 1; i <= 5; i += 1) icons.push(rating.stars >= i ? "star" : rating.stars >= i - 0.5 ? "star-half" : "star-outline");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }} accessibilityLabel={`Safety rating ${rating.stars} out of 5`}>
      {icons.map((name, i) => (
        <Ionicons key={i} name={name} size={size} color={color} />
      ))}
      {showNumber ? <Text style={{ color, fontWeight: "700", fontSize: size * 0.85, marginLeft: 4 }}>{rating.stars.toFixed(1)}</Text> : null}
    </View>
  );
}
