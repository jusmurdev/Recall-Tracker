import React from "react";
import { ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Body, Card, Screen, Small, Subtitle, Title } from "@/components/ui";
import { useBottomPad } from "@/hooks/useBottomPad";
import { colors, spacing } from "@/lib/theme";

/**
 * Honest explanation of what diet alerts can and cannot do. Linked from Settings and from every
 * diet alert, because a false sense of safety is worse than no alert.
 */
export default function DietInfoScreen() {
  const bottomPad = useBottomPad();
  return (
    <Screen edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: bottomPad }}>
        <View style={{ gap: 6 }}>
          <Title>About diet alerts</Title>
          <Body muted>Where they come from, and where they fall short.</Body>
        </View>

        <Card>
          <Subtitle>How a diet alert happens</Subtitle>
          <Body>We read the words in each official recall notice and compare them with a list of ingredients for the profiles you turned on. A match means the notice mentions something you avoid, or says an allergen was left off a label.</Body>
          <Body>The same list runs on labels and receipts you scan. That is a heads-up, not a recall. It only means the words are there.</Body>
        </Card>

        <Card tone="high">
          <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <Ionicons name="warning-outline" size={22} color={colors.high} />
            <View style={{ flex: 1, gap: 8 }}>
              <Subtitle>What it can miss</Subtitle>
              <Body>Recall notices do not list every ingredient, and labels change. We only see the words, so a hidden source that is not named will not be flagged. For allergies, always check the package yourself, and ask the manufacturer if you are unsure.</Body>
            </View>
          </View>
        </Card>

        <Card>
          <Subtitle>Halal and kosher</Subtitle>
          <Body>No recall says whether a product is halal or kosher, so we never claim that. We flag named ingredients ("mentions pork-derived gelatin", "contains alcohol"), named kosher certifiers (OU, OK, Star-K, KOF-K), and wording about meat and dairy mixing. The decision stays with you and your certifier.</Body>
          <Body>Words like "gelatin", "natural flavors" or "enzymes" can come from several sources. We show those as "might contain" rather than guessing.</Body>
        </Card>

        <Card>
          <Subtitle>Vegan</Subtitle>
          <Body>We flag animal-derived ingredients a notice or label names: meat, fish, dairy, egg, honey, gelatin, carmine, isinglass and similar. Sugar, glycerin, vitamin D3 and "natural flavors" can be either, so they appear as "might contain". Nothing here certifies a product as vegan.</Body>
        </Card>

        <Card>
          <Subtitle>Your privacy</Subtitle>
          <Body>Your selections are stored as a plain list on your account, used only to match recalls, and deleted with your account. They are never written to logs or analytics and never sent to an AI provider. The optional premium check of ambiguous ingredients sends the label text only.</Body>
        </Card>

        <Small>This app surfaces official recall notices and label words. It is not medical or religious advice and does not replace reading the label or asking the manufacturer.</Small>
      </ScrollView>
    </Screen>
  );
}
