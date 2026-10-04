import { Stack, useLocalSearchParams } from "expo-router";
import React from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { CATEGORY_LABEL } from "@recall/shared";
import { Body, Button, Card, Loading, Screen, SeverityBadge, Subtitle, Title } from "@/components/ui";
import { useRecall } from "@/hooks/queries";
import { colors, spacing } from "@/lib/theme";

export default function RecallDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useRecall(id);
  if (q.isLoading || !q.data) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  const r = q.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: r.source }} />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <View style={{ gap: 8 }}>
          <SeverityBadge severity={r.severity} />
          <Title>{r.title}</Title>
          <Body muted>
            {CATEGORY_LABEL[r.category]} · {r.status} · published {new Date(r.publishedAt).toLocaleDateString()}
            {r.recallDate ? ` · initiated ${new Date(r.recallDate).toLocaleDateString()}` : ""}
          </Body>
        </View>

        <Card>
          <Subtitle>Why it was recalled</Subtitle>
          <Body>{r.reason || r.summary}</Body>
        </Card>

        <Card>
          <Subtitle>Product</Subtitle>
          <Body>{r.productDescription}</Body>
          {r.upcs.length ? <Body muted>UPC: {r.upcs.join(", ")}</Body> : null}
          {r.brands.length ? <Body muted>Brands: {r.brands.join(", ")}</Body> : null}
          {r.company ? <Body muted>Company: {r.company}</Body> : null}
        </Card>

        <Card>
          <Subtitle>Where it was sold</Subtitle>
          <Body>{r.distributionStates.includes("US") ? "Nationwide" : r.distributionStates.length ? r.distributionStates.join(", ") : "Not specified by the agency"}</Body>
        </Card>

        {r.summary && r.summary !== r.reason ? (
          <Card>
            <Subtitle>Details</Subtitle>
            <Body>{r.summary}</Body>
          </Card>
        ) : null}

        {r.url ? <Button title={`Open on ${r.source === "FSIS" ? "fsis.usda.gov" : r.source === "CPSC" ? "cpsc.gov" : "fda.gov"}`} onPress={() => void Linking.openURL(r.url!)} /> : null}
        <Text style={styles.footnote}>
          Source record {r.source} {r.sourceId}. Last updated {new Date(r.updatedAt).toLocaleString()}.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({ footnote: { color: colors.muted, fontSize: 12, textAlign: "center" } });
