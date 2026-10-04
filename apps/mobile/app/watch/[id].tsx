import { Stack, router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Alert as RNAlert, Linking, ScrollView, Text, View } from "react-native";
import { Body, Button, Card, GradeBadge, Loading, PremiumTag, RecallRow, Screen, Subtitle, Title, gradeColor } from "@/components/ui";
import { useDeleteWatchItem, useMe, useRestaurant, useWatchlist } from "@/hooks/queries";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { colors, spacing } from "@/lib/theme";

export default function WatchItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const list = useWatchlist();
  const me = useMe();
  const del = useDeleteWatchItem();
  const item = list.data?.items.find((w) => w.id === id);
  const isRestaurant = item?.kind === "restaurant";
  const research = useRestaurant(id, isRestaurant && me.data?.tier === "premium");
  const matches = useQuery({ queryKey: ["watch-matches", id], queryFn: () => api.watchMatches(id), enabled: !!item && !isRestaurant });

  if (!item) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const remove = () =>
    RNAlert.alert("Stop watching?", item.label, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => del.mutate(id, { onSuccess: () => router.back() }) },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: item.label }} />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Title>{item.label}</Title>
        <Card>
          <Subtitle>Matching on</Subtitle>
          {item.upc ? <Body>Barcode {item.upc}</Body> : null}
          {item.terms.length ? <Body>{item.terms.join(" · ")}</Body> : null}
          {item.context ? <Body muted>Context: {item.context}</Body> : null}
          {item.restaurant?.latitude != null && item.restaurant.longitude != null ? (
            <Body muted>
              Pinned location · arrival alerts {`(${item.restaurant.latitude.toFixed(3)}, ${item.restaurant.longitude.toFixed(3)})`}
            </Body>
          ) : item.kind === "restaurant" ? (
            <Body muted>No location pinned, so arrival alerts are off for this restaurant.</Body>
          ) : null}
          {item.categories.length ? <Body muted>Categories: {item.categories.join(", ")}</Body> : null}
          <Body muted>Added {new Date(item.createdAt).toLocaleDateString()}{item.importedFrom ? ` · imported from ${item.importedFrom}` : ""}</Body>
        </Card>

        {isRestaurant && research.data ? (
          <Card style={research.data.grade?.level ? { borderColor: gradeColor[research.data.grade.level] } : undefined}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Subtitle>Health inspection grade</Subtitle>
              <GradeBadge grade={research.data.grade} />
            </View>
            {research.data.grade?.lastInspectedAt ? (
              <Body muted>
                Last inspected {new Date(research.data.grade.lastInspectedAt).toLocaleDateString()} · source {research.data.grade.source?.replace(/_/g, " ")}
                {research.data.grade.checkedAt ? ` · checked ${new Date(research.data.grade.checkedAt).toLocaleDateString()}` : ""}
              </Body>
            ) : research.data.gradeCoverage === "none" || research.data.gradeError ? (
              <Body muted>{research.data.gradeError ?? "No official inspection data for this area yet; research may still surface a grade."}</Body>
            ) : (
              <Body muted>Checking the health department's records…</Body>
            )}
            {research.data.inspections.length ? (
              <View style={{ gap: 8 }}>
                <Subtitle>History</Subtitle>
                {research.data.inspections.slice(0, 5).map((i) => (
                  <View key={i.id} style={{ gap: 2 }}>
                    <Text style={{ color: colors.text, fontWeight: "600" }}>
                      {new Date(i.inspectedAt).toLocaleDateString()} · {i.grade ?? (i.score != null ? `${i.score} pts` : "ungraded")}
                      {i.inspectionType ? ` · ${i.inspectionType}` : ""}
                    </Text>
                    {i.violations.filter((v) => v.critical).slice(0, 3).map((v, idx) => (
                      <Text key={idx} style={{ color: colors.high, fontSize: 12 }} numberOfLines={2}>
                        ⚠ {v.description}
                      </Text>
                    ))}
                    {i.violations.length > 3 || i.violations.some((v) => !v.critical) ? (
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {i.violations.length} violation{i.violations.length === 1 ? "" : "s"} ({i.violations.filter((v) => v.critical).length} critical)
                      </Text>
                    ) : null}
                    {i.sourceUrl ? (
                      <Text style={{ color: colors.accent, fontSize: 12 }} onPress={() => void Linking.openURL(i.sourceUrl!)}>
                        View official record ↗
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
            <Button title="Re-check grade" variant="ghost" onPress={() => void api.refreshGrade(id).then(() => research.refetch())} />
            {research.data.updates.length ? (
              <View style={{ gap: 4 }}>
                <Subtitle>Updates</Subtitle>
                {research.data.updates.slice(0, 5).map((u) => (
                  <Text key={u.id} style={{ color: colors.text, fontSize: 13 }}>
                    {new Date(u.createdAt).toLocaleDateString()} · {u.title}
                  </Text>
                ))}
              </View>
            ) : null}
          </Card>
        ) : null}

        {isRestaurant ? (
          <Card>
            <PremiumTag />
            <Subtitle>Supplier research</Subtitle>
            {research.data?.status === "ready" ? (
              <>
                <Body>{research.data.summary}</Body>
                {research.data.supplierTerms.length ? <Body muted>Suppliers & brands watched: {research.data.supplierTerms.join(", ")}</Body> : null}
                {research.data.riskSignals.length ? (
                  <>
                    <Subtitle>Food-safety signals</Subtitle>
                    {research.data.riskSignals.map((s, i) => (
                      <Text key={i} style={{ color: colors.high }} onPress={s.sourceUrl ? () => void Linking.openURL(s.sourceUrl!) : undefined}>
                        • {s.signal}
                        {s.sourceUrl ? " ↗" : ""}
                      </Text>
                    ))}
                  </>
                ) : (
                  <Body muted>No food-safety complaints or inspection problems found.</Body>
                )}
                {research.data.sources.length ? <Body muted>{research.data.sources.length} sources · researched {new Date(research.data.researchedAt!).toLocaleDateString()}</Body> : null}
                {research.data.shared ? (
                  <Body muted>
                    Shared research: {research.data.shared.trackedBy} {research.data.shared.trackedBy === 1 ? "person tracks" : "people track"} this restaurant · researched{" "}
                    {research.data.shared.researchCount}× · reused {research.data.shared.cacheHits}×
                  </Body>
                ) : null}
                {research.data.shared?.canRefresh ? (
                  <Button title="Re-run research" variant="ghost" onPress={() => void api.refreshRestaurant(id).then(() => research.refetch())} />
                ) : (
                  <Body muted style={{ fontSize: 12 }}>Research is refreshed automatically once it is a week old.</Body>
                )}
              </>
            ) : research.data?.status === "failed" ? (
              <>
                <Body style={{ color: colors.critical }}>Research failed{research.data.error ? `: ${research.data.error}` : "."}</Body>
                <Button title="Try again" variant="ghost" onPress={() => void api.refreshRestaurant(id).then(() => research.refetch())} />
              </>
            ) : (
              <Body muted>Researching this restaurant's suppliers and reviews. This usually takes a minute or two and is shared with everyone else who tracks it.</Body>
            )}
          </Card>
        ) : null}

        <Subtitle>{isRestaurant ? "Recalls affecting suppliers" : "Recalls in the last year"}</Subtitle>
        {(isRestaurant ? (research.data?.matchedRecalls ?? []) : (matches.data?.matches ?? [])).map((m) => (
          <RecallRow key={m.recall.id} recall={m.recall} onPress={() => router.push(`/recall/${m.recall.id}`)} footer={<Text style={{ color: colors.accent, fontSize: 12 }}>{m.explanation}</Text>} />
        ))}
        {!isRestaurant && matches.data && !matches.data.matches.length ? <Body muted>Nothing matches yet. You'll be notified the moment something does.</Body> : null}

        <Button title="Stop watching" variant="danger" onPress={remove} />
      </ScrollView>
    </Screen>
  );
}
