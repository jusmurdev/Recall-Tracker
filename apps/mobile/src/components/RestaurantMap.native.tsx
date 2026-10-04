import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Callout, Marker, PROVIDER_DEFAULT } from "react-native-maps";
import type { MapRestaurant } from "@recall/shared";
import { colors } from "@/lib/theme";

const pinColor: Record<MapRestaurant["rating"]["level"], string> = { good: colors.success, ok: colors.high, poor: colors.critical, unknown: colors.unknown };

export interface RestaurantMapProps {
  center: { latitude: number; longitude: number };
  radiusKm: number;
  items: MapRestaurant[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onRegionSettled: (c: { latitude: number; longitude: number; radiusKm: number }) => void;
}

/** Apple Maps on iOS, Google Maps on Android (via react-native-maps). Pins are colored by rating. */
export function RestaurantMap({ center, radiusKm, items, selectedId, onSelect, onOpen, onRegionSettled }: RestaurantMapProps) {
  const ref = useRef<MapView>(null);
  const delta = Math.max(0.01, (radiusKm * 2) / 111);
  useEffect(() => {
    ref.current?.animateToRegion({ latitude: center.latitude, longitude: center.longitude, latitudeDelta: delta, longitudeDelta: delta }, 400);
  }, [center.latitude, center.longitude, delta]);
  return (
    <MapView
      ref={ref}
      provider={PROVIDER_DEFAULT}
      style={StyleSheet.absoluteFill}
      initialRegion={{ latitude: center.latitude, longitude: center.longitude, latitudeDelta: delta, longitudeDelta: delta }}
      showsUserLocation
      showsMyLocationButton
      showsPointsOfInterests={false}
      onRegionChangeComplete={(r) => onRegionSettled({ latitude: r.latitude, longitude: r.longitude, radiusKm: Math.min(10, Math.max(0.5, (r.latitudeDelta * 111) / 2)) })}
    >
      {items.map((it) => (
        <Marker
          key={it.profileId}
          coordinate={{ latitude: it.latitude, longitude: it.longitude }}
          pinColor={pinColor[it.rating.level]}
          onPress={() => onSelect(it.profileId)}
          onCalloutPress={() => onOpen(it.profileId)}
          opacity={selectedId && selectedId !== it.profileId ? 0.6 : 1}
        >
          <Callout tooltip={false}>
            <View style={{ maxWidth: 220, gap: 2 }}>
              <Text style={{ fontWeight: "700" }}>{it.name}</Text>
              <Text style={{ color: pinColor[it.rating.level] }}>{it.rating.stars != null ? `★ ${it.rating.stars.toFixed(1)} · ` : ""}{it.grade.label ?? "No grade yet"}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Tap for details</Text>
            </View>
          </Callout>
        </Marker>
      ))}
    </MapView>
  );
}
