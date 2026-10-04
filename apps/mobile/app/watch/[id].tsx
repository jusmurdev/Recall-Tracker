import { Stack, router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Alert as RNAlert, Linking, ScrollView, Text } from "react-native";
import { Body, Button, Card, Loading, PremiumTag, RecallRow, Screen, Subtitle, Title } from "@/components/ui";
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
          {item.categories.length ? <Body muted>Categories: {item.categories.join(", ")}</Body> : null}
          <Body muted>Added {new Date(item.createdAt).toLocaleDateString()}{item.importedFrom ? ` · imported from ${item.importedFrom}` : ""}</Body>
        </Card>

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
                <Button title="Re-run research" variant="ghost" onPress={() => void api.refreshRestaurant(id).then(() => research.refetch())} />
              </>
            ) : (
              <Body muted>Researching this restaurant's suppliers and reviews. This usually takes a minute or two.</Body>
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
