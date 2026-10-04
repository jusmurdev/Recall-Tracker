import { router } from "expo-router";
import React, { useState } from "react";
import { ScrollView } from "react-native";
import { Body, Button, Card, Input, PremiumTag, Screen, Subtitle } from "@/components/ui";
import { useCreateWatchItem } from "@/hooks/queries";
import { ApiError } from "@/api/client";
import { colors, spacing } from "@/lib/theme";

export default function NewRestaurant() {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [website, setWebsite] = useState("");
  const [context, setContext] = useState("");
  const create = useCreateWatchItem();

  const submit = () =>
    create.mutate(
      {
        kind: "restaurant",
        label: name.trim(),
        terms: [],
        context: context.trim() || undefined,
        categories: [],
        restaurant: { name: name.trim(), city: city.trim() || undefined, state: state.trim().toUpperCase() || undefined, website: website.trim() || undefined },
      },
      {
        onSuccess: (res) => router.replace(`/watch/${res.item.id}`),
        onError: (err) => {
          if (err instanceof ApiError && err.premiumRequired) router.replace("/premium");
        },
      },
    );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }} keyboardShouldPersistTaps="handled">
        <Card>
          <PremiumTag />
          <Subtitle>Restaurant</Subtitle>
          <Body muted>
            We research who supplies the kitchen (distributors, brands, signature ingredients) and recent food-safety signals, then alert you when any supplier is recalled.
          </Body>
          <Input placeholder="Restaurant name" value={name} onChangeText={setName} />
          <Input placeholder="City" value={city} onChangeText={setCity} />
          <Input placeholder="State (e.g. TX)" value={state} onChangeText={setState} autoCapitalize="characters" maxLength={2} />
          <Input placeholder="Website (optional)" value={website} onChangeText={setWebsite} autoCapitalize="none" keyboardType="url" />
          <Input placeholder="Notes (optional): going Friday, kids' birthday…" value={context} onChangeText={setContext} />
          <Button title="Research & track" variant="premium" loading={create.isPending} disabled={name.trim().length < 2} onPress={submit} />
          {create.error ? <Body style={{ color: colors.critical }}>{(create.error as Error).message}</Body> : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}
