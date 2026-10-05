import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Linking, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { CATEGORY_LABEL } from "@recall/shared";
import { Body, Button, Card, Collapsible, Heading, Loading, Screen, SeverityChip, Small, Subtitle, Title } from "@/components/ui";
import { useRecall } from "@/hooks/queries";
import { useBottomPad } from "@/hooks/useBottomPad";
import { CATEGORY_EMOJI, SEVERITY, displayBarcode, headline, plainReason } from "@/lib/friendly";
import { colors, severityColor, spacing } from "@/lib/theme";

/**
 * Recall detail, calm by default: what it is, how worried to be, what to do. The agency
 * paperwork (source ids, full description, distribution list) sits under "Show details".
 */
export default function RecallDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useRecall(id);
  const bottomPad = useBottomPad();
  if (q.isLoading || !q.data) {
    return (
      <Screen edges={["bottom"]}>
        <Loading />
      </Screen>
    );
  }
  const r = q.data;
  const sev = SEVERITY[r.severity];
  const share = () => void Share.share({ title: headline(r), message: `${headline(r)} — ${plainReason(r.reason, r.summary)}\n${r.url ?? ""}\n\nvia Recall Tracker: recalltracker://recall/${r.id}` });
  const steps = (r.remedy ?? "").split(/(?<=[.!])\s+/).map((s) => s.trim()).filter((s) => s.length > 8).slice(0, 4);

  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ headerRight: () => <Ionicons name="share-outline" size={22} color={colors.text} onPress={share} accessibilityLabel="Share this recall" /> }} />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: bottomPad }}>
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ fontSize: 34 }}>{CATEGORY_EMOJI[r.category]}</Text>
            <SeverityChip severity={r.severity} size="lg" />
          </View>
          <Title>{headline(r)}</Title>
          <Body muted>{r.company ? `by ${r.company}` : CATEGORY_LABEL[r.category]}</Body>
        </View>

        <Card tone={r.severity === "critical" ? "critical" : r.severity === "high" ? "high" : r.severity === "low" ? "low" : "soft"}>
          <Heading>{plainReason(r.reason, r.summary)}</Heading>
          <Body>{sev.advice}</Body>
        </Card>

        {steps.length ? (
          <Card>
            <Subtitle>What to do</Subtitle>
            {steps.map((s, i) => (
              <View key={i} style={styles.step}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Body style={{ flex: 1 }}>{s}</Body>
              </View>
            ))}
          </Card>
        ) : null}

        {r.codeInfo ? (
          <Card>
            <Subtitle>Is yours affected?</Subtitle>
            <Small>Look for these codes on the package. If they match, it's the recalled batch.</Small>
            <View style={styles.codeBox}>
              <Text style={styles.code}>{r.codeInfo}</Text>
            </View>
          </Card>
        ) : null}

        <View style={{ flexDirection: "row", gap: 12 }}>
          <Button title="I have this" icon="eye" style={{ flex: 1 }} onPress={() => router.push({ pathname: "/watch/new", params: { prefill: headline(r) } })} />
          <Button title="Share" icon="share-social-outline" variant="secondary" style={{ flex: 1 }} onPress={share} />
        </View>

        <Card>
          <Collapsible title="Show details">
            <View style={{ gap: 10 }}>
              <Row label="Where it was sold" value={r.distributionStates.includes("US") ? "Nationwide" : r.distributionStates.length ? r.distributionStates.join(", ") : "Not specified"} />
              <Row label="Announced" value={new Date(r.publishedAt).toLocaleDateString()} />
              <Row label="Status" value={r.status === "ongoing" ? "Still active" : r.status === "completed" ? "Completed" : r.status} />
              <Row label="Source" value={`${r.source === "FSIS" ? "USDA FSIS" : r.source} · ${r.sourceId}`} />
              {r.upcs.length ? <Row label="Barcodes" value={r.upcs.map(displayBarcode).join(", ")} /> : null}
              <View style={{ gap: 4 }}>
                <Small>Full product description</Small>
                <Body>{r.productDescription}</Body>
              </View>
              <View style={{ gap: 4 }}>
                <Small>Official reason</Small>
                <Body>{r.reason || r.summary}</Body>
              </View>
              {r.url ? <Button title={`Read the official notice`} variant="ghost" icon="open-outline" onPress={() => void Linking.openURL(r.url!)} /> : null}
            </View>
          </Collapsible>
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Small>{label}</Small>
      <Body style={{ flex: 1, textAlign: "right", fontSize: 15 }}>{value}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepNumText: { color: colors.accent, fontWeight: "800", fontSize: 13 },
  codeBox: { backgroundColor: colors.cardAlt, borderRadius: 12, padding: 12, borderLeftWidth: 4, borderLeftColor: severityColor.high },
  code: { color: colors.text, fontSize: 15, lineHeight: 22 },
});
