import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Body, Button, Card, Screen, Subtitle } from "@/components/ui";

export function DetailLoadFailure({
  subject,
  notFound,
  onRetry,
}: {
  subject: "alert" | "recall";
  notFound: boolean;
  onRetry: () => void;
}) {
  return (
    <Screen edges={["bottom"]}>
      <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
        <Card>
          <Subtitle>{notFound ? `We couldn't find this ${subject}.` : `We couldn't load this ${subject}.`}</Subtitle>
          <Body>{notFound ? "It may have been removed. You can return to your alerts or the home screen." : "Check your connection and try again. Your saved details will stay available if you go back."}</Body>
          {!notFound ? <Button title="Retry" onPress={onRetry} /> : null}
          <Button title="Back" variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} />
          <Button title="Home" variant="ghost" onPress={() => router.replace("/(tabs)")} />
        </Card>
      </View>
    </Screen>
  );
}
