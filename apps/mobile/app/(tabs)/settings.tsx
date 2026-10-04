import { router } from "expo-router";
import React from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, PremiumTag, Screen, Subtitle } from "@/components/ui";
import { useMe, useStats } from "@/hooks/queries";
import { apiBaseUrl } from "@/lib/config";
import { colors, spacing } from "@/lib/theme";

export default function SettingsScreen() {
  const me = useMe();
  const stats = useStats();
  const premium = me.data?.tier === "premium";
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Subtitle>Plan</Subtitle>
            {premium ? <PremiumTag /> : null}
          </View>
          <Body>{premium ? "Premium: connected accounts, restaurant tracking and AI label identification are on." : "Free: unlimited recall browsing, label scanning and alerts for up to 50 watched items."}</Body>
          {!premium ? <Button title="See Premium" variant="premium" onPress={() => router.push("/premium")} /> : <Button title="Connected accounts" onPress={() => router.push("/premium/connectors")} />}
        </Card>

        <Card>
          <Subtitle>Data sources</Subtitle>
          {(stats.data?.sources ?? []).map((s) => (
            <View key={s.source} style={styles.sourceRow}>
              <Text style={styles.sourceName}>{SOURCE_LABEL[s.source] ?? s.source}</Text>
              <Text style={[styles.sourceStatus, { color: s.healthy ? colors.accent : colors.high }]}>
                {s.lastSuccessAt ? `synced ${new Date(s.lastSuccessAt).toLocaleString()}` : "not yet synced"}
              </Text>
            </View>
          ))}
          <Body muted>
            Recalls are pulled into one shared database a few times a day from the FDA, USDA FSIS and CPSC. Your phone never queries government servers directly.
          </Body>
        </Card>

        <Card>
          <Subtitle>About</Subtitle>
          <Body muted>
            This app surfaces official recall notices only. It does not replace guidance from the issuing agency: always follow the instructions in the recall itself.
          </Body>
          <Button title="FDA recalls" variant="ghost" onPress={() => void Linking.openURL("https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts")} />
          <Button title="USDA FSIS recalls" variant="ghost" onPress={() => void Linking.openURL("https://www.fsis.usda.gov/recalls")} />
          <Body muted style={{ fontSize: 12 }}>
            API: {apiBaseUrl()} · User {me.data?.id ?? "…"}
          </Body>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const SOURCE_LABEL: Record<string, string> = { FDA: "FDA enforcement reports", FSIS: "USDA FSIS (meat, poultry, eggs)", CPSC: "CPSC consumer products" };

const styles = StyleSheet.create({
  sourceRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  sourceName: { color: colors.text, fontWeight: "600", flex: 1 },
  sourceStatus: { fontSize: 12 },
});
