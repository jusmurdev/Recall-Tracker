import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ensureSession } from "@/api/client";
import { usePushRegistration } from "@/hooks/usePushRegistration";
import { useGeofenceSync } from "@/hooks/useGeofenceSync";
import { colors } from "@/lib/theme";
// Registers the background geofence task at bundle load (required by iOS).
import "@/lib/geofence";

// Cached responses survive restarts and no-signal moments: the last feed, watchlist and
// alerts stay readable offline (gcTime must exceed the persister's maxAge to be restored).
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000, gcTime: 7 * 24 * 3600_000 } } });
const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: "recall-tracker-cache", throttleTime: 1000 });

function Boot({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    ensureSession()
      .catch((err) => console.warn("sign-in failed; will retry on first request", err))
      .finally(() => setReady(true));
  }, []);
  usePushRegistration();
  useGeofenceSync(ready);
  return ready ? <>{children}</> : null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 3 * 24 * 3600_000, buster: "v1" }}>
          <Boot>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.bg },
                headerShadowVisible: false,
                headerTintColor: colors.text,
                headerTitleStyle: { fontWeight: "700" },
                headerBackButtonDisplayMode: "minimal",
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="recall/[id]" options={{ title: "" }} />
              <Stack.Screen name="alert/[id]" options={{ title: "" }} />
              <Stack.Screen name="watch/new" options={{ title: "Watch a brand or product", presentation: "modal" }} />
              <Stack.Screen name="watch/restaurant" options={{ title: "Track a restaurant", presentation: "modal" }} />
              <Stack.Screen name="watch/subscribe" options={{ title: "Follow a category", presentation: "modal" }} />
              <Stack.Screen name="restaurant-updates" options={{ title: "Restaurant updates" }} />
              <Stack.Screen name="watch/[id]" options={{ title: "" }} />
              <Stack.Screen name="premium/index" options={{ title: "Premium" }} />
              <Stack.Screen name="premium/connectors" options={{ title: "Connected accounts" }} />
            </Stack>
          </Boot>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
