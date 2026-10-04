import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import type { WatchItem } from "@recall/shared";
import { api } from "@/api/client";

export const GEOFENCE_TASK = "recall-tracker-restaurant-geofence";
/** Radius around a tracked restaurant that counts as "you're here". */
const RADIUS_M = 150;
/** iOS caps monitored regions at 20 per app. */
const MAX_REGIONS = 20;

/**
 * Background task: fires when the phone enters a tracked restaurant's geofence. If that
 * restaurant currently has supplier recalls, show a local heads-up. Defined at module scope so
 * it is registered when the JS bundle loads, which iOS requires for background delivery.
 */
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("geofence task error", error.message);
    return;
  }
  const { eventType, region } = data as { eventType: Location.GeofencingEventType; region: Location.LocationRegion };
  if (eventType !== Location.GeofencingEventType.Enter || !region.identifier) return;
  try {
    const r = await api.restaurant(region.identifier);
    if (!r.matchedRecalls.length) return;
    const top = r.matchedRecalls[0]!;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Heads up at ${r.restaurant}`,
        body: `${r.matchedRecalls.length} active recall${r.matchedRecalls.length > 1 ? "s" : ""} affect its suppliers: ${top.recall.title}`,
        data: { watchItemId: region.identifier, url: `recalltracker://watch/${region.identifier}` },
        sound: "default",
      },
      trigger: null,
    });
  } catch (err) {
    console.warn("geofence lookup failed", err);
  }
});

export function geofenceSupported(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}

export async function isGeofencingActive(): Promise<boolean> {
  if (!geofenceSupported()) return false;
  return Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
}

/**
 * (Re)register geofences for every tracked restaurant with coordinates. Call after the
 * watchlist changes. Requires "Always" location permission on iOS.
 */
export async function syncGeofences(items: WatchItem[]): Promise<number> {
  if (!geofenceSupported()) return 0;
  const { status } = await Location.getBackgroundPermissionsAsync();
  if (status !== "granted") return 0;
  const regions: Location.LocationRegion[] = items
    .filter((w) => w.kind === "restaurant" && typeof w.restaurant?.latitude === "number" && typeof w.restaurant?.longitude === "number")
    .slice(0, MAX_REGIONS)
    .map((w) => ({ identifier: w.id, latitude: w.restaurant!.latitude!, longitude: w.restaurant!.longitude!, radius: RADIUS_M, notifyOnEnter: true, notifyOnExit: false }));
  if (await isGeofencingActive()) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => undefined);
  if (!regions.length) return 0;
  await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
  return regions.length;
}

export async function stopGeofences(): Promise<void> {
  if (await isGeofencingActive()) await Location.stopGeofencingAsync(GEOFENCE_TASK);
}
