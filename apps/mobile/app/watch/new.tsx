import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { Body, Button, Card, Collapsible, Empty, Input, RecallRow, Screen, Small, Subtitle } from "@/components/ui";
import { useCreateWatchItem } from "@/hooks/queries";
import { whyAlert } from "@/lib/friendly";
import { colors, spacing } from "@/lib/theme";

/** One box. Type the thing you buy. We work out the rest. */
export default function NewWatchItem() {
  const { prefill } = useLocalSearchParams<{ prefill?: string }>();
  const [what, setWhat] = useState(prefill ?? "");
  const [upc, setUpc] = useState("");
  const [context, setContext] = useState("");
  const create = useCreateWatchItem();

  const submit = () => {
    const text = what.trim();
    const digits = upc.replace(/\D/g, "");
    // Brand is usually the first word or two; the whole phrase is the label and a term too.
    const words = text.split(/\s+/).filter(Boolean);
    const terms = [...new Set([text, words.slice(0, 2).join(" "), words[0] ?? ""].map((t) => t.toLowerCase()).filter((t) => t.length >= 2))];
    create.mutate({ kind: digits ? "upc" : "product", label: text || digits, terms, upc: digits || undefined, context: context.trim() || undefined, categories: [] });
  };

  const matches = create.data?.matches ?? [];
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }} keyboardShouldPersistTaps="handled">
        {!create.data ? (
          <>
            <Card>
              <Subtitle>What do you buy?</Subtitle>
              <Input placeholder="e.g. Jif peanut butter, Similac formula" value={what} onChangeText={setWhat} autoFocus />
              <Small>A brand name is enough. We'll match any recall that mentions it.</Small>
              <Collapsible title="Add a barcode or a note (optional)">
                <View style={{ gap: 10 }}>
                  <Input placeholder="Barcode number" value={upc} onChangeText={setUpc} keyboardType="number-pad" />
                  <Input placeholder="Note to self: bought at Costco, for the baby…" value={context} onChangeText={setContext} />
                </View>
              </Collapsible>
              <Button title="Watch it" loading={create.isPending} disabled={!what.trim() && !upc.trim()} onPress={submit} />
              {create.error ? <Body style={{ color: colors.critical }}>{(create.error as Error).message}</Body> : null}
            </Card>
            <Small style={{ textAlign: "center" }}>Tip: scanning a label from the Scan tab adds it here automatically.</Small>
          </>
        ) : (
          <>
            {matches.length ? (
              <Card tone={matches.some((m) => m.recall.severity === "critical") ? "critical" : "high"}>
                <Subtitle>Heads up: this has already been recalled</Subtitle>
                <Small>Check whether yours is one of the affected batches.</Small>
              </Card>
            ) : (
              <Empty icon="checkmark-circle-outline" title={`We're watching "${create.data.item.label}"`} body="No recalls right now. If that changes, you'll know." />
            )}
            {matches.map((m) => (
              <RecallRow key={m.recall.id} recall={m.recall} note={whyAlert({ reason: m.reason, watchItemLabel: create.data!.item.label })} onPress={() => router.push(`/recall/${m.recall.id}`)} />
            ))}
            <Button title="Done" onPress={() => router.back()} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
