import { useEffect } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { setPushStatus } from "@/lib/pushStatus";

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
  const qc = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!Device.isDevice || Platform.OS === "web") {
        setPushStatus(qc, { state: "unavailable", reason: Platform.OS === "web" ? "web" : "simulator" });
        return;
      }
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
      if (status !== "granted") {
        setPushStatus(qc, { state: "denied" });
        return;
      }
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      let token: string;
      try {
        token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
      } catch (err) {
        // No google-services.json / APNs entitlement in this build: alerts still show in-app.
        setPushStatus(qc, { state: "unavailable", reason: (err as Error).message });
        return;
      }
      if (cancelled) return;
      await api.registerDevice({ expoPushToken: token, platform: Platform.OS === "ios" ? "ios" : "android", homeState: homeState as never });
      setPushStatus(qc, { state: "registered", token });
      // The timezone is synced separately (useTimezoneSync) so it does not depend on push working.
    })().catch((err) => {
      console.warn("push registration failed", err);
      setPushStatus(qc, { state: "unavailable", reason: (err as Error).message });
    });
    return () => {
      cancelled = true;
    };
  }, [homeState, qc]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { alertId?: string };
      if (data?.alertId) router.push(`/alert/${data.alertId}`);
    });
    return () => sub.remove();
  }, []);
}
