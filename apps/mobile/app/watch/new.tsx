import { router } from "expo-router";
import React, { useState } from "react";
import { ScrollView, Text } from "react-native";
import { CATEGORY_LABEL, type RecallCategory } from "@recall/shared";
import { Body, Button, Card, Input, Pill, RecallRow, Screen, Subtitle } from "@/components/ui";
import { useCreateWatchItem } from "@/hooks/queries";
import { colors, spacing } from "@/lib/theme";

const CATS: RecallCategory[] = ["food", "meat_poultry", "dietary_supplement", "veterinary", "cosmetic", "drug", "medical_device", "consumer_product"];

export default function NewWatchItem() {
  const [label, setLabel] = useState("");
  const [terms, setTerms] = useState("");
  const [upc, setUpc] = useState("");
  const [context, setContext] = useState("");
  const [cats, setCats] = useState<RecallCategory[]>([]);
  const create = useCreateWatchItem();

  const submit = () => {
    const termList = terms.split(/[,\n]/).map((t) => t.trim()).filter((t) => t.length >= 2);
    const digits = upc.replace(/\D/g, "");
    create.mutate({
      kind: digits ? "upc" : "product",
      label: label.trim() || termList[0] || digits,
      terms: termList.length ? termList : label.trim() ? [label.trim()] : [],
      upc: digits || undefined,
      context: context.trim() || undefined,
      categories: cats,
    });
  };

  const matches = create.data?.matches ?? [];
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Subtitle>What are you watching?</Subtitle>
          <Input placeholder="Name (e.g. Jif peanut butter)" value={label} onChangeText={setLabel} />
          <Input placeholder="Brands or words to match, comma separated" value={terms} onChangeText={setTerms} autoCapitalize="none" />
          <Input placeholder="Barcode (optional)" value={upc} onChangeText={setUpc} keyboardType="number-pad" />
          <Input placeholder="Context (optional): bought at…, planning to buy, for the kids" value={context} onChangeText={setContext} />
          <Body muted>Limit to categories (optional)</Body>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {CATS.map((c) => (
              <Pill key={c} label={CATEGORY_LABEL[c]} active={cats.includes(c)} onPress={() => setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))} />
            ))}
          </ScrollView>
          <Button title="Start watching" loading={create.isPending} disabled={!label.trim() && !terms.trim() && !upc.trim()} onPress={submit} />
          {create.error ? <Body style={{ color: colors.critical }}>{(create.error as Error).message}</Body> : null}
        </Card>
        {create.data ? (
          <>
            <Subtitle>{matches.length ? `Already recalled: ${matches.length} match${matches.length > 1 ? "es" : ""}` : "No current recalls — we'll alert you"}</Subtitle>
            {matches.map((m) => (
              <RecallRow key={m.recall.id} recall={m.recall} onPress={() => router.push(`/recall/${m.recall.id}`)} footer={<Text style={{ color: colors.accent, fontSize: 12 }}>{m.explanation}</Text>} />
            ))}
            <Button title="Done" variant="ghost" onPress={() => router.back()} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
