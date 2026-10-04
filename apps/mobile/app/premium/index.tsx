import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, PremiumTag, Screen, Small, Title } from "@/components/ui";
import { useMe } from "@/hooks/queries";
import { useBottomPad } from "@/hooks/useBottomPad";
import { colors, spacing } from "@/lib/theme";

const FEATURES: Array<{ icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; body: string }> = [
  { icon: "restaurant", title: "Know before you eat out", body: "Health inspection grades and who supplies the kitchen, for any restaurant. We tell you if a supplier gets recalled or the grade drops." },
  { icon: "cart", title: "Import what you buy", body: "Connect Instacart, Amazon, Walmart and more. Everything you've bought gets watched automatically." },
  { icon: "camera", title: "Photo identification", body: "Curved cans, glare, tiny print: send a photo and we'll work out what it is." },
  { icon: "walk", title: "A nudge when you arrive", body: "Walk into a tracked restaurant with an active supplier recall and your phone lets you know." },
];

export default function PremiumScreen() {
  const me = useMe();
  const premium = me.data?.tier === "premium";
  const bottomPad = useBottomPad();
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: bottomPad }}>
        <View style={{ gap: 8 }}>
          <PremiumTag />
          <Title>{premium ? "You're on Premium" : "Go further with Premium"}</Title>
          <Body muted>Everything in the free app stays free. Premium adds the parts that need research on your behalf.</Body>
        </View>
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <View style={styles.row}>
              <View style={styles.icon}>
                <Ionicons name={f.icon} size={22} color={colors.premium} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.title}>{f.title}</Text>
                <Small>{f.body}</Small>
              </View>
            </View>
          </Card>
        ))}
        {premium ? (
          <Button title="Connected accounts" icon="link" variant="premium" onPress={() => router.push("/premium/connectors")} />
        ) : (
          <>
            <Button title="Start Premium" icon="sparkles" variant="premium" onPress={() => router.push("/premium/connectors")} />
            <Small style={{ textAlign: "center" }}>Billed through {Platform.OS === "android" ? "Google Play" : "the App Store"}. Cancel any time.</Small>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.premiumSoft, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontWeight: "700", fontSize: 16 },
});
