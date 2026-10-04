import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect } from "react";
import { Alert as RNAlert, ScrollView, View } from "react-native";
import { Body, Button, Card, Loading, RecallRow, Screen, Subtitle } from "@/components/ui";
import { useAlert, useAlertAction, useMarkRead } from "@/hooks/queries";
import { colors, spacing } from "@/lib/theme";

const ACTION_LABEL: Record<string, string> = {
  discarded: "Threw it away",
  returned: "Returned it",
  contacted: "Contacted the company",
  checked_not_affected: "Checked codes — not affected",
};

export default function AlertDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAlert(id);
  const markRead = useMarkRead();
  const actions = useAlertAction();
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
        {a.recall.codeInfo ? (
          <Card style={{ borderColor: colors.high }}>
            <Subtitle>Check your package</Subtitle>
            <Body>{a.recall.codeInfo}</Body>
          </Card>
        ) : null}
        {a.recall.remedy ? (
          <Card style={{ borderColor: colors.accent }}>
            <Subtitle>What to do</Subtitle>
            <Body>{a.recall.remedy}</Body>
          </Card>
        ) : null}
        <Button title="Open full recall" onPress={() => router.push(`/recall/${a.recall.id}`)} />

        <Card>
          <Subtitle>Your status</Subtitle>
          {a.resolvedAt ? (
            <Body>✓ {ACTION_LABEL[a.resolvedAction ?? ""] ?? "Handled"} · {new Date(a.resolvedAt).toLocaleDateString()}</Body>
          ) : a.dismissedAt ? (
            <>
              <Body muted>Dismissed ({a.dismissReason === "false_match" ? "wrong match" : a.dismissReason === "dont_have" ? "don't have it" : "not interested"}).</Body>
              <Button title="Undo dismiss" variant="ghost" onPress={() => actions.undismiss.mutate(id)} />
            </>
          ) : (
            <>
              <Body muted>Tell us what you did so this stops nagging you (and helps us tune matching).</Body>
              <View style={{ gap: 8 }}>
                <Button
                  title="I handled it"
                  onPress={() =>
                    RNAlert.alert("What did you do?", undefined, [
                      { text: "Threw it away", onPress: () => actions.resolve.mutate({ id, action: "discarded" }) },
                      { text: "Returned it", onPress: () => actions.resolve.mutate({ id, action: "returned" }) },
                      { text: "Contacted the company", onPress: () => actions.resolve.mutate({ id, action: "contacted" }) },
                      { text: "Checked codes — not affected", onPress: () => actions.resolve.mutate({ id, action: "checked_not_affected" }) },
                      { text: "Cancel", style: "cancel" },
                    ])
                  }
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button title="I don't have this" variant="ghost" style={{ flex: 1 }} onPress={() => actions.dismiss.mutate({ id, reason: "dont_have" })} />
                  <Button title="Wrong match" variant="ghost" style={{ flex: 1 }} onPress={() => actions.dismiss.mutate({ id, reason: "false_match" })} />
                </View>
              </View>
            </>
          )}
        </Card>
        {a.watchItemId ? <Button title="Manage watched item" variant="ghost" onPress={() => router.push(`/watch/${a.watchItemId}`)} /> : null}
      </ScrollView>
    </Screen>
  );
}
