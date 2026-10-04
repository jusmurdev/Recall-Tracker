import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { currentPlace, hasForegroundPermission, requestForegroundPermission, type Place } from "@/lib/location";

/**
 * Keeps the server's idea of "where is this user" current, cheaply: once per app launch, and
 * on demand. Only the two-letter state is sent. Also exposes the full on-device place so
 * screens can offer "near me" filters and pre-fill restaurant forms.
 */
export function useLocationState() {
  const [place, setPlace] = useState<Place | null>(null);
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const reported = useRef<string | null>(null);

  const refresh = useCallback(
    async (opts: { ask?: boolean; setHome?: boolean } = {}) => {
      setBusy(true);
      try {
        let ok = await hasForegroundPermission();
        if (!ok && opts.ask) ok = await requestForegroundPermission();
        setPermission(ok ? "granted" : "denied");
        if (!ok) return null;
        const p = await currentPlace();
        setPlace(p);
        if (p?.state && (reported.current !== p.state || opts.setHome)) {
          reported.current = p.state;
          await api.updateLocation({ state: p.state, setHome: opts.setHome ?? false });
          void qc.invalidateQueries({ queryKey: ["me"] });
        }
        return p;
      } catch (err) {
        console.warn("location refresh failed", err);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [qc],
  );

  // Silent refresh on launch if permission was already granted earlier.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { place, state: place?.state ?? null, permission, busy, refresh };
}
