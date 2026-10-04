import { useEffect } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { router } from "expo-router";
import { api } from "@/api/client";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Asks for notification permission, registers the Expo push token with the API, and routes
 * taps on a notification to the alert screen. Safe to call on every launch (idempotent).
 */
export function usePushRegistration(homeState?: string) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!Device.isDevice || Platform.OS === "web") return;
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("recalls", { name: "Recall alerts", importance: Notifications.AndroidImportance.DEFAULT });
        await Notifications.setNotificationChannelAsync("critical-recalls", {
          name: "Critical recalls",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#E25555",
        });
      }
      const { status: existing } = await Notifications.getPermissionsAsync();
      const status = existing === "granted" ? existing : (await Notifications.requestPermissionsAsync()).status;
      if (status !== "granted") return;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
      if (cancelled) return;
      await api.registerDevice({ expoPushToken: token, platform: Platform.OS === "ios" ? "ios" : "android", homeState: homeState as never });
      // Quiet hours and digests are evaluated in the phone's zone.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) await api.updatePreferences({ timezone: tz }).catch(() => undefined);
    })().catch((err) => console.warn("push registration failed", err));
    return () => {
      cancelled = true;
    };
  }, [homeState]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { alertId?: string };
      if (data?.alertId) router.push(`/alert/${data.alertId}`);
    });
    return () => sub.remove();
  }, []);
}
