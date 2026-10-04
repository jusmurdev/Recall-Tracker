import { router } from "expo-router";
import React, { useState } from "react";
import { ScrollView, Text } from "react-native";
import { CATEGORY_LABEL, type RecallCategory, type RecallSeverity } from "@recall/shared";
import { Body, Button, Card, Input, Pill, RecallRow, Screen, Subtitle } from "@/components/ui";
import { useCreateWatchItem, useMe } from "@/hooks/queries";
import { colors, spacing } from "@/lib/theme";

const CATS: RecallCategory[] = ["food", "meat_poultry", "dietary_supplement", "veterinary", "cosmetic", "drug", "medical_device", "consumer_product"];
const SEV: Array<{ v: RecallSeverity; label: string }> = [
  { v: "unknown", label: "Everything" },
  { v: "low", label: "Class III and up" },
  { v: "high", label: "Class II and up" },
  { v: "critical", label: "Class I only" },
];

/** "Tell me about every critical food recall sold in my state" — no product list needed. */
export default function Subscribe() {
  const [cats, setCats] = useState<RecallCategory[]>(["food", "meat_poultry"]);
  const [min, setMin] = useState<RecallSeverity>("high");
  const [label, setLabel] = useState("");
  const create = useCreateWatchItem();
  const me = useMe();
  const auto = `${SEV.find((s) => s.v === min)!.label} · ${cats.map((c) => CATEGORY_LABEL[c]).join(", ")}${me.data?.homeState ? ` · near ${me.data.homeState}` : ""}`;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Subtitle>Categories</Subtitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {CATS.map((c) => (
              <Pill key={c} label={CATEGORY_LABEL[c]} active={cats.includes(c)} onPress={() => setCats((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))} />
            ))}
          </ScrollView>
          <Subtitle>Minimum severity</Subtitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {SEV.map((s) => (
              <Pill key={s.v} label={s.label} active={min === s.v} onPress={() => setMin(s.v)} />
            ))}
          </ScrollView>
          <Input placeholder={auto} value={label} onChangeText={setLabel} />
          <Body muted>
            {me.data?.homeState
              ? `Only recalls distributed nationwide or in ${me.data.homeState}${me.data.lastKnownState && me.data.lastKnownState !== me.data.homeState ? ` / ${me.data.lastKnownState}` : ""} will alert you.`
              : "Set your location in Settings to limit this to recalls sold near you."}
          </Body>
          <Button
            title="Subscribe"
            loading={create.isPending}
            disabled={!cats.length}
            onPress={() => create.mutate({ kind: "category", label: (label.trim() || auto).slice(0, 120), terms: [], categories: cats, minSeverity: min })}
          />
          {create.error ? <Body style={{ color: colors.critical }}>{(create.error as Error).message}</Body> : null}
        </Card>
        {create.data ? (
          <>
            <Subtitle>{create.data.matches.length ? `Last 30 days: ${create.data.matches.length} matching recall${create.data.matches.length > 1 ? "s" : ""}` : "Nothing in the last 30 days — you're set"}</Subtitle>
            {create.data.matches.map((m) => (
              <RecallRow key={m.recall.id} recall={m.recall} onPress={() => router.push(`/recall/${m.recall.id}`)} footer={<Text style={{ color: colors.accent, fontSize: 12 }}>{m.explanation}</Text>} />
            ))}
            <Button title="Done" variant="ghost" onPress={() => router.back()} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
