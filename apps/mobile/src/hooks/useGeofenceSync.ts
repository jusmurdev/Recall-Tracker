import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/api/client";
import { syncGeofences } from "@/lib/geofence";

/**
 * Keeps the OS geofence list equal to the user's tracked restaurants. Cheap: it only runs
 * when the watchlist query data changes, and is a no-op without background permission.
 */
export function useGeofenceSync(enabled: boolean) {
  const list = useQuery({ queryKey: ["watchlist"], queryFn: api.watchlist, enabled });
  useEffect(() => {
    if (!list.data) return;
    syncGeofences(list.data.items).catch((err) => console.warn("geofence sync failed", err));
  }, [list.data]);
}
