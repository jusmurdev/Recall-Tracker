import { useLocalSearchParams } from "expo-router";
import React from "react";
import { ScrollView } from "react-native";
import { ReceiptResults } from "@/components/ReceiptResults";
import { Loading, Screen } from "@/components/ui";
import { useReceipt } from "@/hooks/queries";
import { spacing } from "@/lib/theme";

/** A saved receipt, re-checked against today's recalls every time it is opened. */
export default function ReceiptDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useReceipt(id);
  if (!q.data) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: spacing(6) }}>
        <ReceiptResults result={q.data} />
      </ScrollView>
    </Screen>
  );
}
