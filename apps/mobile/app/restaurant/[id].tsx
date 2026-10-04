import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Stars } from "@/components/Stars";
import { Body, Button, Card, Collapsible, Heading, Loading, PremiumTag, RecallRow, Screen, Small, Subtitle, Title, gradeColor } from "@/components/ui";
import { useCreateWatchItem, useMe } from "@/hooks/queries";
import { useBottomPad } from "@/hooks/useBottomPad";
import { gradeFriendly } from "@/lib/friendly";
import { colors, spacing } from "@/lib/theme";

/** Public page for any restaurant on the map: grade, rating, inspections, recall exposure. */
export default function PublicRestaurant() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ["restaurant-public", id], queryFn: () => api.restaurantPublic(id) });
  const me = useMe();
  const create = useCreateWatchItem();
  if (!q.data) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  const r = q.data;
  const g = gradeFriendly(r.grade);
  const tone = r.rating.level === "good" ? "success" : r.rating.level === "ok" ? "high" : r.rating.level === "poor" ? "critical" : "soft";
  const premium = me.data?.tier === "premium";
  const bottomPad = useBottomPad();
  const track = () =>
    premium
      ? create.mutate({ kind: "restaurant", label: r.name, terms: [], categories: [], restaurant: { profileId: r.profileId, name: r.name } }, { onSuccess: (res) => router.replace(`/watch/${res.item.id}`) })
      : router.push("/premium");

  return (
    <Screen>
      <Stack.Screen options={{ title: "" }} />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: bottomPad }}>
        <View style={{ gap: 6 }}>
          <Title>{r.name}</Title>
          <Small>{[r.address, r.city, r.state].filter(Boolean).join(", ")}</Small>
          <Stars rating={r.rating} size={20} />
          <Small>{r.rating.reason}</Small>
        </View>

        <Card tone={tone}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 24, fontWeight: "800", color: gradeColor[g.level] }}>{r.grade.grade?.slice(0, 2) ?? (r.grade.score ?? "?")}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Heading>{g.title}</Heading>
              <Small>{g.body}</Small>
            </View>
          </View>
          {r.grade.lastInspectedAt ? <Small>Last inspected {new Date(r.grade.lastInspectedAt).toLocaleDateString()} by the local health department.</Small> : null}
          {r.inspections.length ? (
            <Collapsible title="Inspection history">
              <View style={{ gap: 10 }}>
                {r.inspections.slice(0, 5).map((i) => (
                  <View key={i.id} style={{ gap: 2 }}>
                    <Body style={{ fontWeight: "700", fontSize: 15 }}>
                      {new Date(i.inspectedAt).toLocaleDateString()} · {i.grade ?? (i.score != null ? `${i.score} pts` : "ungraded")}
                    </Body>
                    {i.violations.filter((v) => v.critical).slice(0, 2).map((v, idx) => (
                      <Small key={idx} style={{ color: colors.high }}>⚠ {v.description}</Small>
                    ))}
                    {i.sourceUrl ? (
                      <Text style={{ color: colors.accent, fontSize: 13 }} onPress={() => void Linking.openURL(i.sourceUrl!)}>
                        Official record ↗
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </Collapsible>
          ) : null}
        </Card>

        {r.matchedRecalls.length ? (
          <>
            <Subtitle>Recalls touching this kitchen</Subtitle>
            {r.matchedRecalls.map((m) => (
              <RecallRow key={m.recall.id} recall={m.recall} onPress={() => router.push(`/recall/${m.recall.id}`)} />
            ))}
          </>
        ) : null}

        {r.watchItemId ? (
          <Button title="You're tracking this · open" icon="eye" onPress={() => router.push(`/watch/${r.watchItemId}`)} />
        ) : (
          <Card tone="premium">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="restaurant" size={22} color={colors.premium} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>Track this place</Body>
                <Small>{r.researched ? "Supplier research is ready. " : "We'll find who supplies the kitchen. "}Get told when a supplier is recalled or the grade drops, and a nudge when you arrive.</Small>
              </View>
              {!premium ? <PremiumTag /> : null}
            </View>
            <Button title={premium ? "Track it" : "See Premium"} variant="premium" icon={premium ? "add" : "sparkles"} loading={create.isPending} onPress={track} />
          </Card>
        )}
        <Small style={{ textAlign: "center" }}>{r.trackedBy ? `${r.trackedBy} ${r.trackedBy === 1 ? "person tracks" : "people track"} this place.` : "Be the first to track this place."}</Small>
      </ScrollView>
    </Screen>
  );
}
