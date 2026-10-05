import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import type { CatalogRestaurant, NearbyRestaurant, RestaurantLookup } from "@recall/shared";
import { Pressable, Text, View } from "react-native";
import { Body, Button, Card, GradeBadge, Hint, Input, PremiumTag, Screen, Subtitle } from "@/components/ui";
import { useCreateWatchItem } from "@/hooks/queries";
import { useBottomPad } from "@/hooks/useBottomPad";
import { useLocationState } from "@/hooks/useLocationState";
import { api, ApiError } from "@/api/client";
import { geocodeAddress } from "@/lib/location";
import { colors, spacing } from "@/lib/theme";

export default function NewRestaurant() {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [website, setWebsite] = useState("");
  const [context, setContext] = useState("");
  const create = useCreateWatchItem();
  const bottomPad = useBottomPad();
  const [lookup, setLookup] = useState<RestaurantLookup | null>(null);
  const [catalog, setCatalog] = useState<CatalogRestaurant[]>([]);
  const [picked, setPicked] = useState<CatalogRestaurant | null>(null);

  // Shared catalog: everything anyone has added, with research + health grade already attached.
  useEffect(() => {
    if (picked || name.trim().length < 2) {
      setCatalog([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .restaurantSearch({ q: name.trim(), lat: loc.place?.latitude, lng: loc.place?.longitude, state: state.trim().length === 2 ? state.trim().toUpperCase() : undefined })
        .then((r) => setCatalog(r.items))
        .catch(() => setCatalog([]));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, state, picked]);

  const pickCatalog = (c: CatalogRestaurant) => {
    setPicked(c);
    setName(c.name);
    if (c.city) setCity(c.city);
    if (c.state) setState(c.state);
    if (c.website) setWebsite(c.website);
    if (c.latitude != null && c.longitude != null) setCoords({ latitude: c.latitude, longitude: c.longitude });
    setCatalog([]);
  };
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [nearby, setNearby] = useState<NearbyRestaurant[]>([]);
  const loc = useLocationState();

  // "I'm here": fill city/state from the phone, pin the venue to the current coordinates, and
  // list restaurants other users already track within walking distance.
  const useMyLocation = async () => {
    const p = loc.place ?? (await loc.refresh({ ask: true }));
    if (!p) return;
    if (p.city && !city) setCity(p.city);
    if (p.state && !state) setState(p.state);
    if (p.name && !name && !/^\d/.test(p.name)) setName(p.name);
    setCoords({ latitude: p.latitude, longitude: p.longitude });
    api
      .restaurantsNearby({ lat: p.latitude, lng: p.longitude, radiusKm: 1.5 })
      .then((r) => setNearby(r.items))
      .catch(() => setNearby([]));
  };

  const pickNearby = (n: NearbyRestaurant) => {
    setName(n.name);
    if (n.city) setCity(n.city);
    if (n.state) setState(n.state);
    setCoords({ latitude: n.latitude, longitude: n.longitude });
  };

  // Ask the server whether someone has already researched this place; if so, adding it is instant.
  useEffect(() => {
    if (name.trim().length < 3) {
      setLookup(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .restaurantLookup({ name: name.trim(), city: city.trim() || undefined, state: state.trim().length === 2 ? state.trim().toUpperCase() : undefined, website: website.trim() || undefined })
        .then(setLookup)
        .catch(() => setLookup(null));
    }, 500);
    return () => clearTimeout(t);
  }, [name, city, state, website]);

  const submit = async () => {
    // Without GPS, try to geocode the typed address on-device so geofence alerts still work.
    let venue = coords;
    if (!venue && (city.trim() || state.trim())) venue = await geocodeAddress(`${name.trim()}, ${city.trim()} ${state.trim()}`.trim());
    create.mutate(
      {
        kind: "restaurant",
        label: name.trim(),
        terms: [],
        context: context.trim() || undefined,
        categories: [],
        restaurant: {
          profileId: picked?.profileId,
          name: name.trim(),
          city: city.trim() || undefined,
          state: state.trim().toUpperCase() || undefined,
          website: website.trim() || undefined,
          latitude: venue?.latitude,
          longitude: venue?.longitude,
        },
      },
      {
        onSuccess: (res) => router.replace(`/watch/${res.item.id}`),
        onError: (err) => {
          if (err instanceof ApiError && err.premiumRequired) router.replace("/premium");
        },
      },
    );
  };

  return (
    <Screen edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: bottomPad }} keyboardShouldPersistTaps="handled">
        <Card>
          <Subtitle>Which restaurant?</Subtitle>
          <Body muted>We'll find its health grade and who supplies the kitchen, and tell you if either changes.</Body>
          <Button title={loc.busy ? "Locating…" : "I'm here — use my location"} variant="ghost" loading={loc.busy} onPress={() => void useMyLocation()} />
          {nearby.length ? (
            <View style={{ gap: 10 }}>
              <Body muted>Tracked restaurants nearby</Body>
              {nearby.slice(0, 5).map((n) => (
                <Pressable key={n.profileId} onPress={() => pickNearby(n)} style={styles.nearby}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nearbyName}>{n.name}</Text>
                    <Text style={styles.nearbyMeta}>
                      {Math.round(n.distanceKm * 1000)} m · tracked by {n.trackedBy} · {n.activeRecalls ? `${n.activeRecalls} active supplier recall${n.activeRecalls > 1 ? "s" : ""}` : "no active supplier recalls"}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Input
            placeholder="Restaurant name"
            value={name}
            onChangeText={(v) => {
              setName(v);
              if (picked && v !== picked.name) setPicked(null);
            }}
          />
          {catalog.length ? (
            <View style={{ gap: 10 }}>
              <Body muted>Already known — tap to use it</Body>
              {catalog.slice(0, 5).map((c) => (
                <Pressable key={c.profileId} onPress={() => pickCatalog(c)} style={styles.nearby} accessibilityRole="button">
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nearbyName}>{c.name}</Text>
                    <Text style={styles.nearbyMeta}>
                      {[c.city, c.state].filter(Boolean).join(", ")}
                      {c.distanceKm != null ? ` · ${c.distanceKm} km` : ""} · tracked by {c.trackedBy} · {c.researchStatus === "ready" ? "researched" : "research pending"}
                      {c.activeRecalls ? ` · ${c.activeRecalls} supplier recall${c.activeRecalls > 1 ? "s" : ""}` : ""}
                    </Text>
                  </View>
                  <GradeBadge grade={c.grade} compact />
                </Pressable>
              ))}
            </View>
          ) : null}
          {picked ? (
            <Body style={{ color: colors.accent }}>
              Great, we already know {picked.name}{picked.grade.grade ? ` (health grade ${picked.grade.grade})` : ""}.
            </Body>
          ) : null}
          <Input placeholder="City" value={city} onChangeText={setCity} />
          <Input placeholder="State (e.g. TX)" value={state} onChangeText={setState} autoCapitalize="characters" maxLength={2} />
          <Input placeholder="Website" value={website} onChangeText={setWebsite} autoCapitalize="none" keyboardType="url" />
          <Input placeholder="Notes (optional)" value={context} onChangeText={setContext} />
          <Hint>e.g. going Friday, kids' birthday</Hint>
          {picked ? null : lookup?.known && lookup.fresh ? (
            <Body style={{ color: colors.accent }}>
              Already researched{lookup.trackedBy ? ` · tracked by ${lookup.trackedBy} ${lookup.trackedBy === 1 ? "person" : "people"}` : ""}. Results appear instantly.
            </Body>
          ) : lookup?.known ? (
            <Body muted>Known restaurant; research is {lookup.status === "researching" ? "in progress" : "being refreshed"}.</Body>
          ) : name.trim().length >= 3 ? (
            <Body muted>New to us. Give us a minute or two to look it up.</Body>
          ) : null}
          {coords ? <Body muted>Pinned at {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)} — arrival alerts available.</Body> : null}
          <Button title="Track it" variant="premium" icon="restaurant" loading={create.isPending} disabled={name.trim().length < 2} onPress={() => void submit()} />
          {create.error ? <Body style={{ color: colors.critical }}>{(create.error as Error).message}</Body> : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  nearby: { flexDirection: "row", alignItems: "center", gap: 10, padding: spacing(1.25), borderRadius: 10, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  nearbyName: { color: colors.text, fontWeight: "600" },
  nearbyMeta: { color: colors.muted, fontSize: 12 },
});
