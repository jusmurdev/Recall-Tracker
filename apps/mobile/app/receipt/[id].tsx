import { useLocalSearchParams } from "expo-router";
import React from "react";
import { ScrollView } from "react-native";
import { ReceiptResults } from "@/components/ReceiptResults";
import { Loading, Screen } from "@/components/ui";
import { useReceipt } from "@/hooks/queries";
import { useBottomPad } from "@/hooks/useBottomPad";
import { spacing } from "@/lib/theme";

/** A saved receipt, re-checked against today's recalls every time it is opened. */
export default function ReceiptDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useReceipt(id);
  const bottomPad = useBottomPad();
  if (!q.data) {
    return (
      <Screen edges={["bottom"]}>
        <Loading />
      </Screen>
    );
  }
  return (
    <Screen edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: bottomPad }}>
        <ReceiptResults result={q.data} />
      </ScrollView>
    </Screen>
  );
}
