import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect } from "react";
import { ScrollView } from "react-native";
import { Body, Button, Card, Loading, RecallRow, Screen, Subtitle } from "@/components/ui";
import { useAlert, useMarkRead } from "@/hooks/queries";
import { spacing } from "@/lib/theme";

export default function AlertDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAlert(id);
  const markRead = useMarkRead();
  useEffect(() => {
    if (q.data && !q.data.readAt) markRead.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.id]);
  if (!q.data) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  const a = q.data;
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Card>
          <Subtitle>Why you got this</Subtitle>
          <Body>{a.explanation}</Body>
          <Body muted>
            {a.watchItemLabel ? `Watching: ${a.watchItemLabel} · ` : ""}Confidence {Math.round(a.score * 100)}% · {new Date(a.createdAt).toLocaleString()}
          </Body>
        </Card>
        <RecallRow recall={a.recall} onPress={() => router.push(`/recall/${a.recall.id}`)} />
        <Button title="Open full recall" onPress={() => router.push(`/recall/${a.recall.id}`)} />
        {a.watchItemId ? <Button title="Manage watched item" variant="ghost" onPress={() => router.push(`/watch/${a.watchItemId}`)} /> : null}
      </ScrollView>
    </Screen>
  );
}
