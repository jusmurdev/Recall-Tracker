import { router } from "expo-router";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, PremiumTag, Screen, Subtitle, Title } from "@/components/ui";
import { useMe } from "@/hooks/queries";
import { colors, spacing } from "@/lib/theme";

const FEATURES = [
  { title: "Connected accounts", body: "Link Instacart, DoorDash, Amazon, Walmart, Kroger or any MCP-compatible account. Your purchase history becomes a watchlist automatically." },
  { title: "Restaurant tracking", body: "AI researches who supplies the kitchen and recent inspection and review signals, then alerts you when a supplier is recalled." },
  { title: "AI label identification", body: "Photos that OCR can't read are identified by vision AI: curved cans, glare, tiny print." },
  { title: "Unlimited watchlist", body: "No 50-item cap." },
];

export default function PremiumScreen() {
  const me = useMe();
  const premium = me.data?.tier === "premium";
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <View style={{ gap: 8 }}>
          <PremiumTag />
          <Title>{premium ? "You're on Premium" : "Recall Tracker Premium"}</Title>
          <Body muted>Everything in Free, plus the parts that need AI and research on your behalf.</Body>
        </View>
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <Text style={styles.featureTitle}>{f.title}</Text>
            <Body muted>{f.body}</Body>
          </Card>
        ))}
        {premium ? (
          <Button title="Manage connected accounts" onPress={() => router.push("/premium/connectors")} />
        ) : (
          <Card>
            <Subtitle>Subscribe</Subtitle>
            <Body muted>
              In-app purchase is handled by the store SDK (RevenueCat); the server unlocks features from the entitlement webhook. Wire your product IDs in
              app.json and the purchase button below.
            </Body>
            <Button title="Start Premium" variant="premium" onPress={() => router.push("/premium/connectors")} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({ featureTitle: { color: colors.text, fontWeight: "700", fontSize: 16 } });
