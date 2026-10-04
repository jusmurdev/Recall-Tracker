import { useEffect } from "react";
import { useMe, useUpdatePreferences } from "@/hooks/queries";

/** The phone's IANA zone, or null when the runtime cannot tell us. */
export function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * Quiet hours and the daily digest run in the user's zone. Send it on every launch, whether or
 * not push notifications could be registered, and again if the phone has moved zones.
 */
export function useTimezoneSync(enabled: boolean) {
  const me = useMe();
  const update = useUpdatePreferences();
  const serverTz = me.data?.preferences.timezone;
  useEffect(() => {
    if (!enabled || !me.data) return;
    const tz = deviceTimezone();
    if (tz && tz !== serverTz && !update.isPending) update.mutate({ timezone: tz });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, me.data?.id, serverTz]);
}
