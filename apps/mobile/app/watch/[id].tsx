import { Stack, router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Alert as RNAlert, Linking, ScrollView, Text, View } from "react-native";
import { Body, Button, Card, Collapsible, GradeBadge, Heading, Loading, PremiumTag, RecallRow, Screen, Small, Subtitle, Title, gradeColor } from "@/components/ui";
import { gradeFriendly, whyAlert } from "@/lib/friendly";
import { useDeleteWatchItem, useMe, useRestaurant, useWatchlist } from "@/hooks/queries";
import { useBottomPad } from "@/hooks/useBottomPad";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { colors, spacing } from "@/lib/theme";

export default function WatchItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const list = useWatchlist();
  const me = useMe();
  const del = useDeleteWatchItem();
  const bottomPad = useBottomPad();
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
      <Stack.Screen options={{ title: "" }} />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: bottomPad }}>
        <Title>{item.label}</Title>
        {!isRestaurant ? (
          <Card>
            <Subtitle>We're watching for</Subtitle>
            {item.upc ? <Body>Barcode {item.upc}</Body> : null}
            {item.terms.length ? <Body>{item.terms.join(" · ")}</Body> : null}
            {item.context ? <Small>Your note: {item.context}</Small> : null}
          </Card>
        ) : null}

        {isRestaurant && research.data ? (
          (() => {
            const g = gradeFriendly(research.data.grade);
            const tone = g.level === "good" ? "success" : g.level === "ok" ? "high" : g.level === "poor" ? "critical" : "soft";
            return (
              <Card tone={tone}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 24, fontWeight: "800", color: gradeColor[g.level] }}>{research.data.grade?.grade?.slice(0, 2) ?? (research.data.grade?.score ?? "?")}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Heading>{g.title}</Heading>
                    <Small>{g.body}</Small>
                  </View>
                </View>
                {research.data.grade?.lastInspectedAt ? <Small>Last inspected {new Date(research.data.grade.lastInspectedAt).toLocaleDateString()} by the local health department.</Small> : research.data.gradeError ? <Small>{research.data.gradeError}</Small> : null}
                {research.data.inspections.length ? (
                  <Collapsible title="Inspection history">
                    <View style={{ gap: 10 }}>
                      {research.data.inspections.slice(0, 5).map((i) => (
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
                      <Button title="Re-check grade" variant="ghost" onPress={() => void api.refreshGrade(id).then(() => research.refetch())} />
                    </View>
                  </Collapsible>
                ) : null}
              </Card>
            );
          })()
        ) : null}

        {isRestaurant ? (
          <Card>
            <Subtitle>Who supplies the kitchen</Subtitle>
            {research.data?.status === "ready" ? (
              <>
                <Body>{research.data.summary}</Body>
                {research.data.supplierTerms.length ? <Small>We watch recalls for: {research.data.supplierTerms.join(", ")}</Small> : null}
                {research.data.riskSignals.length ? (
                  <>
                    <Subtitle>Things people have flagged</Subtitle>
                    {research.data.riskSignals.map((s, i) => (
                      <Text key={i} style={{ color: colors.high }} onPress={s.sourceUrl ? () => void Linking.openURL(s.sourceUrl!) : undefined}>
                        • {s.signal}
                        {s.sourceUrl ? " ↗" : ""}
                      </Text>
                    ))}
                  </>
                ) : (
                  <Small>No food-safety complaints found in reviews or inspections.</Small>
                )}
                {research.data.shared ? <Small>{research.data.shared.trackedBy} {research.data.shared.trackedBy === 1 ? "person tracks" : "people track"} this place · checked {new Date(research.data.researchedAt!).toLocaleDateString()}</Small> : null}
                {research.data.shared?.canRefresh ? (
                  <Button title="Re-run research" variant="ghost" onPress={() => void api.refreshRestaurant(id).then(() => research.refetch())} />
                ) : (
                  <Small>We refresh this automatically.</Small>
                )}
              </>
            ) : research.data?.status === "failed" ? (
              <>
                <Body style={{ color: colors.critical }}>Research failed{research.data.error ? `: ${research.data.error}` : "."}</Body>
                <Button title="Try again" variant="ghost" onPress={() => void api.refreshRestaurant(id).then(() => research.refetch())} />
              </>
            ) : (
              <Small>Looking into who supplies this kitchen. Usually a minute or two.</Small>
            )}
          </Card>
        ) : null}

        <Subtitle>{isRestaurant ? "Recalls touching this restaurant" : "Related recalls"}</Subtitle>
        {(isRestaurant ? (research.data?.matchedRecalls ?? []) : (matches.data?.matches ?? [])).map((m) => (
          <RecallRow key={m.recall.id} recall={m.recall} note={whyAlert({ reason: m.reason, watchItemLabel: item.label })} onPress={() => router.push(`/recall/${m.recall.id}`)} />
        ))}
        {!isRestaurant && matches.data && !matches.data.matches.length ? <Small>Nothing so far. You'll hear the moment something matches.</Small> : null}
        {isRestaurant && research.data && !research.data.matchedRecalls.length ? <Small>No supplier recalls right now.</Small> : null}

        <Button title="Stop watching" variant="ghost" onPress={remove} />
      </ScrollView>
    </Screen>
  );
}
