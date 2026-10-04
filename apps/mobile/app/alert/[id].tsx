import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect } from "react";
import { Alert as RNAlert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Body, Button, Card, Heading, Loading, Screen, SeverityChip, Small, Subtitle, Title } from "@/components/ui";
import { useAlert, useAlertAction, useMarkRead } from "@/hooks/queries";
import { CATEGORY_EMOJI, SEVERITY, headline, plainReason, whyAlert } from "@/lib/friendly";
import { colors, spacing } from "@/lib/theme";

const ACTION_LABEL: Record<string, string> = {
  discarded: "You threw it away",
  returned: "You returned it",
  contacted: "You contacted the company",
  checked_not_affected: "You checked — yours isn't affected",
};

/** An alert is a recall plus "why you". Lead with the decision: do you have this? */
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
  const r = a.recall;
  const steps = (r.remedy ?? "").split(/(?<=[.!])\s+/).map((s) => s.trim()).filter((s) => s.length > 8).slice(0, 3);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: spacing(5) }}>
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ fontSize: 34 }}>{CATEGORY_EMOJI[r.category]}</Text>
            <SeverityChip severity={r.severity} size="lg" />
          </View>
          <Title>{headline(r)}</Title>
          <View style={styles.why}>
            <Ionicons name="link" size={16} color={colors.accent} />
            <Small style={{ color: colors.accent, flex: 1 }}>{whyAlert(a)}</Small>
          </View>
        </View>

        <Card tone={r.severity === "critical" ? "critical" : r.severity === "high" ? "high" : r.severity === "low" ? "low" : "soft"}>
          <Heading>{plainReason(r.reason, r.summary)}</Heading>
          <Body>{SEVERITY[r.severity].advice}</Body>
        </Card>

        {a.resolvedAt ? (
          <Card tone="success">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="checkmark-circle" size={24} color={colors.success} />
              <Body style={{ fontWeight: "700" }}>{ACTION_LABEL[a.resolvedAction ?? ""] ?? "Handled"}</Body>
            </View>
          </Card>
        ) : a.dismissedAt ? (
          <Card tone="soft">
            <Body muted>You said this doesn't apply to you.</Body>
            <Button title="Undo" variant="ghost" onPress={() => actions.undismiss.mutate(id)} />
          </Card>
        ) : (
          <Card>
            <Subtitle>Do you have this at home?</Subtitle>
            {r.codeInfo ? (
              <>
                <Small>Check the package for:</Small>
                <View style={styles.codeBox}>
                  <Text style={styles.code}>{r.codeInfo}</Text>
                </View>
              </>
            ) : null}
            <View style={{ gap: 12 }}>
              <Button
                title="Yes — I dealt with it"
                icon="checkmark"
                onPress={() =>
                  RNAlert.alert("What did you do?", undefined, [
                    { text: "Threw it away", onPress: () => actions.resolve.mutate({ id, action: "discarded" }) },
                    { text: "Returned it", onPress: () => actions.resolve.mutate({ id, action: "returned" }) },
                    { text: "Contacted the company", onPress: () => actions.resolve.mutate({ id, action: "contacted" }) },
                    { text: "Cancel", style: "cancel" },
                  ])
                }
              />
              <Button title="Checked — mine's not affected" variant="secondary" onPress={() => actions.resolve.mutate({ id, action: "checked_not_affected" })} />
              <Button title="I don't have this" variant="ghost" onPress={() => actions.dismiss.mutate({ id, reason: "dont_have" })} />
              <Button title="This isn't my product" variant="ghost" onPress={() => actions.dismiss.mutate({ id, reason: "false_match" })} />
            </View>
          </Card>
        )}

        {steps.length ? (
          <Card>
            <Subtitle>What to do</Subtitle>
            {steps.map((s, i) => (
              <Body key={i}>• {s}</Body>
            ))}
          </Card>
        ) : null}

        <Button title="Full recall details" variant="ghost" icon="document-text-outline" onPress={() => router.push(`/recall/${r.id}`)} />
        {a.watchItemId ? <Button title="Manage what you're watching" variant="ghost" onPress={() => router.push(`/watch/${a.watchItemId}`)} /> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  why: { flexDirection: "row", alignItems: "center", gap: 6 },
  codeBox: { backgroundColor: colors.cardAlt, borderRadius: 12, padding: 12 },
  code: { color: colors.text, fontSize: 15, lineHeight: 22 },
});
