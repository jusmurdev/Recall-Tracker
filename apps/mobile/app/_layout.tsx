import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

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
        <QueryClientProvider client={queryClient}>
          <Boot>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.bg },
                headerTintColor: colors.text,
                headerTitleStyle: { fontWeight: "700" },
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="recall/[id]" options={{ title: "Recall" }} />
              <Stack.Screen name="alert/[id]" options={{ title: "Alert" }} />
              <Stack.Screen name="watch/new" options={{ title: "Watch an item", presentation: "modal" }} />
              <Stack.Screen name="watch/restaurant" options={{ title: "Track a restaurant", presentation: "modal" }} />
              <Stack.Screen name="watch/[id]" options={{ title: "Watch item" }} />
              <Stack.Screen name="premium/index" options={{ title: "Premium" }} />
              <Stack.Screen name="premium/connectors" options={{ title: "Connected accounts" }} />
            </Stack>
          </Boot>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
