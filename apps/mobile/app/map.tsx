import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { MapRestaurant } from "@recall/shared";
import { api } from "@/api/client";
import { RestaurantMap, mapViewAvailable } from "@/components/RestaurantMap";
import { useBottomPad } from "@/hooks/useBottomPad";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stars } from "@/components/Stars";
import { Body, Button, Empty, GradeBadge, Loading, Small } from "@/components/ui";
import { useLocationState } from "@/hooks/useLocationState";
import { useMe } from "@/hooks/queries";
import { colors, radius, spacing } from "@/lib/theme";

const DEFAULT_CENTER = { latitude: 40.7074, longitude: -74.0113 }; // lower Manhattan until we know where you are

/**
 * Restaurants near you with a safety rating. Free to browse (grades are public); tracking a
 * place for supplier alerts is premium. Venues come from the shared catalog plus the local
 * health department's open data where we have an adapter.
 */
export default function MapScreen() {
  const loc = useLocationState();
  const premium = useMe().data?.tier === "premium";
  const [center, setCenter] = useState<{ latitude: number; longitude: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState(1.5);
  const [selected, setSelected] = useState<string | null>(null);
  const listRef = useRef<FlatList<MapRestaurant>>(null);
  const bottomPad = useBottomPad(spacing(2));
  const insets = useSafeAreaInsets();
  // Without a Google Maps key the Android map view throws; show the list on its own instead.
  const mapOk = mapViewAvailable();

  useEffect(() => {
    if (center) return;
    if (loc.place) setCenter({ latitude: loc.place.latitude, longitude: loc.place.longitude });
    else if (loc.permission === "denied") setCenter(DEFAULT_CENTER);
  }, [loc.place, loc.permission, center]);
  useEffect(() => {
    // List-only mode has no map to pan: without a fix after a few seconds, show the default area.
    if (mapOk || center) return;
    const t = setTimeout(() => setCenter((c) => c ?? DEFAULT_CENTER), 6000);
    return () => clearTimeout(t);
  }, [mapOk, center]);
  useEffect(() => {
    if (!loc.place && loc.permission === "unknown") void loc.refresh({ ask: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = useQuery({
    queryKey: ["map", center?.latitude.toFixed(3), center?.longitude.toFixed(3), radiusKm.toFixed(1)],
    queryFn: () => api.restaurantsMap({ lat: center!.latitude, lng: center!.longitude, radiusKm }),
    enabled: !!center,
    staleTime: 60_000,
  });
  const items = [...(q.data?.items ?? [])].sort((a, b) => a.distanceKm - b.distanceKm);
  const onRegionSettled = useCallback((c: { latitude: number; longitude: number; radiusKm: number }) => {
    setCenter((prev) => (prev && Math.abs(prev.latitude - c.latitude) < 0.002 && Math.abs(prev.longitude - c.longitude) < 0.002 ? prev : { latitude: c.latitude, longitude: c.longitude }));
    setRadiusKm((prev) => (Math.abs(prev - c.radiusKm) < 0.2 ? prev : c.radiusKm));
  }, []);
  const select = (id: string) => {
    setSelected(id);
    const idx = items.findIndex((i) => i.profileId === id);
    if (idx >= 0) listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.2, animated: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingBottom: insets.bottom }}>
      <View style={[styles.mapWrap, !mapOk && styles.mapWrapCollapsed]}>
        {!mapOk ? (
          <View style={styles.noMap}>
            <Ionicons name="map-outline" size={20} color={colors.muted} />
            <Small style={{ flex: 1 }}>The map isn't available in this build, so here's the list of places near you instead.</Small>
          </View>
        ) : center ? (
          <RestaurantMap center={center} radiusKm={radiusKm} items={items} selectedId={selected} onSelect={select} onOpen={(id) => router.push(`/restaurant/${id}`)} onRegionSettled={onRegionSettled} />
        ) : (
          <View style={styles.center}>
            <Loading />
            <Small>Finding you…</Small>
            {loc.permission === "denied" ? <Button title="Browse without location" variant="ghost" onPress={() => setCenter(DEFAULT_CENTER)} /> : null}
          </View>
        )}
        {center && mapOk ? (
          <Pressable style={styles.locate} accessibilityRole="button" accessibilityLabel="Center on me" onPress={() => void loc.refresh({ ask: true }).then((p) => p && setCenter({ latitude: p.latitude, longitude: p.longitude }))}>
            <Ionicons name="locate" size={20} color={colors.accent} />
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.sheet, !mapOk && { marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }]}>
        {mapOk ? <View style={styles.handle} /> : null}
        <View style={styles.sheetHeader}>
          <Body style={{ fontWeight: "700" }}>{q.isLoading ? "Looking around…" : items.length ? `${items.length} place${items.length === 1 ? "" : "s"} within ${radiusKm < 1 ? `${Math.round(radiusKm * 1000)} m` : `${radiusKm.toFixed(1)} km`}` : "Nearby"}</Body>
          {q.data?.discovery.source ? <Small>Grades from {q.data.discovery.source === "nyc_dohmh" ? "NYC Health" : q.data.discovery.source === "chicago_cdph" ? "Chicago Public Health" : q.data.discovery.source}</Small> : premium ? <Small>Health grades are public data.</Small> : <Small>Health grades are public data. Tracking is Premium.</Small>}
        </View>
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(i) => i.profileId}
          contentContainerStyle={{ padding: spacing(2), gap: spacing(1), paddingBottom: bottomPad }}
          onScrollToIndexFailed={() => undefined}
          ListEmptyComponent={q.isLoading ? null : <Empty icon="map-outline" title="No graded restaurants here yet" body={q.data?.discovery.source ? "Try zooming out." : "We don't have this area's inspection data yet. Add a restaurant and we'll research it."} />}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.rating.stars ?? "no"} stars`} onPress={() => router.push(`/restaurant/${item.profileId}`)} onPressIn={() => setSelected(item.profileId)} style={[styles.row, selected === item.profileId && { borderColor: colors.accent }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Stars rating={item.rating} size={14} />
                <Small numberOfLines={1}>
                  {item.distanceKm < 1 ? `${Math.round(item.distanceKm * 1000)} m` : `${item.distanceKm.toFixed(1)} km`}
                  {item.address ? ` · ${item.address}` : ""}
                  {item.activeRecalls ? ` · ${item.activeRecalls} supplier recall${item.activeRecalls > 1 ? "s" : ""}` : ""}
                </Small>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <GradeBadge grade={item.grade} compact />
                {item.watchItemId ? <Ionicons name="eye" size={16} color={colors.accent} /> : null}
              </View>
            </Pressable>
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: { height: "46%", backgroundColor: colors.cardAlt },
  mapWrapCollapsed: { height: undefined, paddingTop: spacing(1.5), paddingBottom: spacing(3.5) },
  noMap: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: spacing(2), padding: spacing(1.5), backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  locate: { position: "absolute", right: 12, bottom: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  sheet: { flex: 1, backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, marginTop: -18, overflow: "hidden" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 8 },
  sheetHeader: { paddingHorizontal: spacing(2), paddingTop: 10, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing(1.5), backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  name: { color: colors.text, fontWeight: "700", fontSize: 15 },
});
