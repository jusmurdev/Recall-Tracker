import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { type RecallCategory, type RecallSeverity } from "@recall/shared";
import { Body, Button, Card, Empty, RecallRow, Screen, Small, Subtitle } from "@/components/ui";
import { useCreateWatchItem, useMe } from "@/hooks/queries";
import { useBottomPad } from "@/hooks/useBottomPad";
import { CATEGORY_EMOJI, CATEGORY_FRIENDLY } from "@/lib/friendly";
import { colors, radius, spacing } from "@/lib/theme";

const CATS: RecallCategory[] = ["food", "meat_poultry", "veterinary", "dietary_supplement", "cosmetic", "drug", "consumer_product", "medical_device"];
const SEV: Array<{ v: RecallSeverity; label: string; body: string }> = [
  { v: "critical", label: "Only the serious ones", body: "Could cause serious illness" },
  { v: "high", label: "Serious and moderate", body: "Anything that could make you sick" },
  { v: "unknown", label: "Everything", body: "Including minor labeling slip-ups" },
];

/** "Tell me about everything in these categories" — for people who don't want to list products. */
export default function Subscribe() {
  const [cats, setCats] = useState<RecallCategory[]>(["food", "meat_poultry"]);
  const [min, setMin] = useState<RecallSeverity>("critical");
  const create = useCreateWatchItem();
  const me = useMe();
  const bottomPad = useBottomPad();
  const label = `${SEV.find((s) => s.v === min)!.label}: ${cats.map((c) => CATEGORY_FRIENDLY[c]).join(", ")}`;

  return (
    <Screen edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: bottomPad }}>
        {!create.data ? (
          <>
            <Card>
              <Subtitle>Which kinds of things?</Subtitle>
              <View style={styles.grid}>
                {CATS.map((c) => {
                  const on = cats.includes(c);
                  return (
                    <Pressable key={c} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setCats((p) => (on ? p.filter((x) => x !== c) : [...p, c]))} style={[styles.cat, on && styles.catOn]}>
                      <Text style={{ fontSize: 22 }}>{CATEGORY_EMOJI[c]}</Text>
                      <Text style={[styles.catText, on && { color: colors.accent }]}>{CATEGORY_FRIENDLY[c]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
            <Card>
              <Subtitle>How much do you want to hear about?</Subtitle>
              {SEV.map((s) => (
                <Pressable key={s.v} accessibilityRole="button" accessibilityState={{ selected: min === s.v }} onPress={() => setMin(s.v)} style={[styles.option, min === s.v && styles.optionOn]}>
                  <View style={[styles.radio, min === s.v && styles.radioOn]} />
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{s.label}</Body>
                    <Small>{s.body}</Small>
                  </View>
                </Pressable>
              ))}
              <Small>{me.data?.homeState ? `Limited to recalls sold nationwide or in ${me.data.homeState}.` : "Set your location on the You tab to limit this to what's sold near you."}</Small>
              <Button title="Follow" loading={create.isPending} disabled={!cats.length} onPress={() => create.mutate({ kind: "category", label: label.slice(0, 120), terms: [], categories: cats, minSeverity: min })} />
              {create.error ? <Body style={{ color: colors.critical }}>{(create.error as Error).message}</Body> : null}
            </Card>
          </>
        ) : (
          <>
            {create.data.matches.length ? (
              <Subtitle>In the last 30 days</Subtitle>
            ) : (
              <Empty icon="checkmark-circle-outline" title="You're following" body="Nothing serious in the last 30 days. We'll tell you when there is." />
            )}
            {create.data.matches.map((m) => (
              <RecallRow key={m.recall.id} recall={m.recall} onPress={() => router.push(`/recall/${m.recall.id}`)} />
            ))}
            <Button title="Done" onPress={() => router.back()} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cat: { width: "47%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  catOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  catText: { color: colors.text, fontSize: 13, fontWeight: "600", flex: 1 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border },
  optionOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border },
  radioOn: { borderColor: colors.accent, backgroundColor: colors.accent },
});
