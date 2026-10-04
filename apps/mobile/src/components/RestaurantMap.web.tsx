import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MapRestaurant } from "@recall/shared";
import { colors } from "@/lib/theme";

export interface RestaurantMapProps {
  center: { latitude: number; longitude: number };
  radiusKm: number;
  items: MapRestaurant[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onRegionSettled: (c: { latitude: number; longitude: number; radiusKm: number }) => void;
}

const pinColor: Record<MapRestaurant["rating"]["level"], string> = { good: colors.success, ok: colors.high, poor: colors.critical, unknown: colors.unknown };

/** Web has no native map; draw a simple radar so the layout still makes sense. */
export function RestaurantMap({ center, radiusKm, items, selectedId, onSelect }: RestaurantMapProps) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]}>
      <View style={styles.ring} />
      <View style={[styles.ring, { width: "50%", height: "50%" }]} />
      <View style={styles.you} />
      {items.map((it) => {
        const dx = ((it.longitude - center.longitude) * 111 * Math.cos((center.latitude * Math.PI) / 180)) / radiusKm;
        const dy = ((it.latitude - center.latitude) * 111) / radiusKm;
        const left = 50 + dx * 45;
        const top = 50 - dy * 45;
        if (left < 2 || left > 98 || top < 2 || top > 98) return null;
        return (
          <View key={it.profileId} style={[styles.pin, { left: `${left}%`, top: `${top}%`, backgroundColor: pinColor[it.rating.level], transform: [{ scale: selectedId === it.profileId ? 1.3 : 1 }] }]} onTouchEnd={() => onSelect(it.profileId)}>
            <Text style={styles.pinText}>{it.rating.stars != null ? it.rating.stars.toFixed(1) : "?"}</Text>
          </View>
        );
      })}
      <Text style={styles.note}>Map preview · the full map needs a phone build</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: "#E9E4D8", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  ring: { position: "absolute", width: "90%", height: "90%", borderRadius: 9999, borderWidth: 1, borderColor: "#CFC7B6" },
  you: { position: "absolute", width: 14, height: 14, borderRadius: 7, backgroundColor: colors.accent, borderWidth: 3, borderColor: "#fff" },
  pin: { position: "absolute", width: 34, height: 34, marginLeft: -17, marginTop: -17, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  pinText: { color: "#fff", fontWeight: "800", fontSize: 11 },
  note: { position: "absolute", bottom: 8, color: colors.muted, fontSize: 11 },
});
