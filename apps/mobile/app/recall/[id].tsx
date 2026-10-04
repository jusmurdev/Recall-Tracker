import { Stack, useLocalSearchParams } from "expo-router";
import React from "react";
import { Linking, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
  const share = () =>
    void Share.share({
      title: r.title,
      message: `${r.title}\n${r.reason}\n${r.url ?? ""}\n\nvia Recall Tracker: recalltracker://recall/${r.id}`,
    });
  return (
    <Screen>
      <Stack.Screen
        options={{
          title: r.source,
          headerRight: () => <Ionicons name="share-outline" size={22} color={colors.text} onPress={share} accessibilityLabel="Share this recall" />,
        }}
      />
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

        {r.codeInfo ? (
          <Card style={{ borderColor: colors.high }}>
            <Subtitle>Check your package</Subtitle>
            <Body>{r.codeInfo}</Body>
            <Body muted>Compare the lot, date or model code printed on your item. Only matching codes are affected.</Body>
          </Card>
        ) : null}

        {r.remedy ? (
          <Card style={{ borderColor: colors.accent }}>
            <Subtitle>What to do</Subtitle>
            <Body>{r.remedy}</Body>
          </Card>
        ) : null}

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
        <Button title="Share" variant="ghost" onPress={share} />
        <Text style={styles.footnote}>
          Source record {r.source} {r.sourceId}. Last updated {new Date(r.updatedAt).toLocaleString()}.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({ footnote: { color: colors.muted, fontSize: 12, textAlign: "center" } });
