import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert as RNAlert, Linking, Platform, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { CATEGORY_LABEL, type RecallCategory, type RecallSeverity } from "@recall/shared";
import { Pill } from "@/components/ui";
import { useUpdatePreferences } from "@/hooks/queries";
import { setToken } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Body, Button, Card, PremiumTag, Screen, Subtitle } from "@/components/ui";
import { useMe, useStats, useWatchlist } from "@/hooks/queries";
import { useLocationState } from "@/hooks/useLocationState";
import { apiBaseUrl } from "@/lib/config";
import { geofenceSupported, isGeofencingActive, stopGeofences, syncGeofences } from "@/lib/geofence";
import { requestBackgroundPermission } from "@/lib/location";
import { colors, spacing } from "@/lib/theme";

export default function SettingsScreen() {
  const me = useMe();
  const stats = useStats();
  const list = useWatchlist();
  const loc = useLocationState();
  const qc = useQueryClient();
  const premium = me.data?.tier === "premium";
  const [geofences, setGeofences] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  useEffect(() => {
    void isGeofencingActive().then(setGeofences);
  }, []);
  const trackedRestaurants = (list.data?.items ?? []).filter((w) => w.kind === "restaurant" && w.restaurant?.latitude != null).length;
  const prefs = me.data?.preferences;
  const update = useUpdatePreferences();
  const setPref = (patch: Parameters<typeof update.mutate>[0]) => update.mutate(patch);
  const SEV: Array<{ v: RecallSeverity; label: string }> = [
    { v: "unknown", label: "All" },
    { v: "low", label: "Class III+" },
    { v: "high", label: "Class II+" },
    { v: "critical", label: "Class I only" },
  ];
  const CATS: RecallCategory[] = ["food", "meat_poultry", "dietary_supplement", "veterinary", "cosmetic", "drug", "medical_device", "consumer_product"];
  const HOURS = Array.from({ length: 24 }, (_, h) => h);
  const fmtHour = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

  const deleteAccount = () =>
    RNAlert.alert("Delete your data?", "This removes your watchlist, alerts, connected accounts and device registrations. It cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete everything",
        style: "destructive",
        onPress: async () => {
          await api.deleteAccount();
          await setToken("");
          qc.clear();
          RNAlert.alert("Deleted", "Your data has been removed. The app will start fresh.");
        },
      },
    ]);

  const toggleGeofences = async (on: boolean) => {
    setGeoBusy(true);
    try {
      if (!on) {
        await stopGeofences();
        setGeofences(false);
        return;
      }
      const ok = await requestBackgroundPermission();
      if (!ok) {
        setGeofences(false);
        return;
      }
      const n = await syncGeofences(list.data?.items ?? []);
      setGeofences(n > 0 || trackedRestaurants === 0);
    } finally {
      setGeoBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Card>
          <Subtitle>Location</Subtitle>
          <Body>
            {me.data?.homeState ? `Home state: ${me.data.homeState}` : "Home state not set"}
            {me.data?.lastKnownState && me.data.lastKnownState !== me.data.homeState ? ` · currently in ${me.data.lastKnownState}` : ""}
          </Body>
          <Body muted>
            Recalls sold in your state rank higher in alerts, and the feed can filter to what is sold near you. Location is resolved on your phone; only the state name is sent to our servers.
          </Body>
          {loc.permission === "granted" && loc.place ? (
            <Body muted>Detected: {[loc.place.city, loc.place.state].filter(Boolean).join(", ") || "outside the US"}</Body>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title={loc.busy ? "Locating…" : "Use my location"} style={{ flex: 1 }} loading={loc.busy} onPress={() => void loc.refresh({ ask: true })} />
            <Button
              title="Set as home"
              variant="ghost"
              disabled={!loc.state}
              onPress={() => void loc.refresh({ ask: true, setHome: true }).then(() => qc.invalidateQueries({ queryKey: ["me"] }))}
            />
          </View>
          {loc.permission === "denied" ? <Button title="Open Settings to allow location" variant="ghost" onPress={() => void Linking.openSettings()} /> : null}
        </Card>

        <Card>
          <Subtitle>Notifications</Subtitle>
          {prefs ? (
            <>
              <Body muted>Push me about</Body>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {SEV.map((s) => (
                  <Pill key={s.v} label={s.label} active={prefs.pushMinSeverity === s.v} onPress={() => setPref({ pushMinSeverity: s.v })} />
                ))}
              </ScrollView>
              <Body muted>Mute categories (still shown in the inbox)</Body>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {CATS.map((c) => (
                  <Pill
                    key={c}
                    label={CATEGORY_LABEL[c]}
                    active={prefs.mutedCategories.includes(c)}
                    onPress={() => setPref({ mutedCategories: prefs.mutedCategories.includes(c) ? prefs.mutedCategories.filter((x) => x !== c) : [...prefs.mutedCategories, c] })}
                  />
                ))}
              </ScrollView>
              <View style={styles.switchRow}>
                <Body style={{ flex: 1 }}>Daily digest instead of one push per alert (critical recalls still arrive immediately)</Body>
                <Switch value={prefs.digestMode} onValueChange={(v) => setPref({ digestMode: v })} trackColor={{ true: colors.accent }} />
              </View>
              {prefs.digestMode ? (
                <>
                  <Body muted>Digest time</Body>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {[7, 8, 9, 12, 18, 20].map((h) => (
                      <Pill key={h} label={fmtHour(h)} active={prefs.digestHour === h} onPress={() => setPref({ digestHour: h })} />
                    ))}
                  </ScrollView>
                </>
              ) : null}
              <View style={styles.switchRow}>
                <Body style={{ flex: 1 }}>Quiet hours (non-critical pushes wait until the window ends)</Body>
                <Switch
                  value={prefs.quietHoursStart != null}
                  onValueChange={(v) => setPref(v ? { quietHoursStart: 22, quietHoursEnd: 7 } : { quietHoursStart: null, quietHoursEnd: null })}
                  trackColor={{ true: colors.accent }}
                />
              </View>
              {prefs.quietHoursStart != null ? (
                <>
                  <Body muted>From</Body>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {HOURS.map((h) => (
                      <Pill key={h} label={fmtHour(h)} active={prefs.quietHoursStart === h} onPress={() => setPref({ quietHoursStart: h, quietHoursEnd: prefs.quietHoursEnd ?? 7 })} />
                    ))}
                  </ScrollView>
                  <Body muted>Until</Body>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {HOURS.map((h) => (
                      <Pill key={h} label={fmtHour(h)} active={prefs.quietHoursEnd === h} onPress={() => setPref({ quietHoursStart: prefs.quietHoursStart ?? 22, quietHoursEnd: h })} />
                    ))}
                  </ScrollView>
                </>
              ) : null}
              <Body muted style={{ fontSize: 12 }}>Times use {prefs.timezone ?? "your phone's time zone"}.</Body>
            </>
          ) : (
            <Body muted>Loading…</Body>
          )}
        </Card>

        {premium && geofenceSupported() ? (
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Subtitle>Restaurant arrival alerts</Subtitle>
              <PremiumTag />
            </View>
            <View style={styles.switchRow}>
              <Body style={{ flex: 1 }}>Heads-up when you arrive at a tracked restaurant whose suppliers have an active recall</Body>
              <Switch value={geofences} disabled={geoBusy} onValueChange={(v) => void toggleGeofences(v)} trackColor={{ true: colors.accent }} />
            </View>
            <Body muted>
              Uses {Platform.OS === "ios" ? "'Always' location" : "background location"} for geofences around your tracked restaurants ({trackedRestaurants} with a location, up to 20). Nothing is uploaded; the check runs on your phone.
            </Body>
          </Card>
        ) : null}

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Subtitle>Plan</Subtitle>
            {premium ? <PremiumTag /> : null}
          </View>
          <Body>{premium ? "Premium: connected accounts, restaurant tracking and AI label identification are on." : "Free: unlimited recall browsing, label scanning and alerts for up to 50 watched items."}</Body>
          {!premium ? <Button title="See Premium" variant="premium" onPress={() => router.push("/premium")} /> : <Button title="Connected accounts" onPress={() => router.push("/premium/connectors")} />}
        </Card>

        <Card>
          <Subtitle>Data sources</Subtitle>
          {(stats.data?.sources ?? []).map((s) => (
            <View key={s.source} style={styles.sourceRow}>
              <Text style={styles.sourceName}>{SOURCE_LABEL[s.source] ?? s.source}</Text>
              <Text style={[styles.sourceStatus, { color: s.healthy ? colors.accent : colors.high }]}>
                {s.lastSuccessAt ? `synced ${new Date(s.lastSuccessAt).toLocaleString()}` : "not yet synced"}
              </Text>
            </View>
          ))}
          <Body muted>
            Recalls are pulled into one shared database a few times a day from the FDA, USDA FSIS and CPSC. Your phone never queries government servers directly.
          </Body>
        </Card>

        <Card>
          <Subtitle>About</Subtitle>
          <Body muted>
            This app surfaces official recall notices only. It does not replace guidance from the issuing agency: always follow the instructions in the recall itself.
          </Body>
          <Button title="FDA recalls" variant="ghost" onPress={() => void Linking.openURL("https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts")} />
          <Button title="USDA FSIS recalls" variant="ghost" onPress={() => void Linking.openURL("https://www.fsis.usda.gov/recalls")} />
          <Body muted style={{ fontSize: 12 }}>
            API: {apiBaseUrl()} · User {me.data?.id ?? "…"}
          </Body>
        </Card>

        <Card>
          <Subtitle>Your data</Subtitle>
          <Body muted>We store your watchlist, alerts, connected accounts and your state (never precise location). Delete it all at any time.</Body>
          <Button title="Delete my data" variant="danger" onPress={deleteAccount} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const SOURCE_LABEL: Record<string, string> = { FDA: "FDA enforcement reports", FSIS: "USDA FSIS (meat, poultry, eggs)", CPSC: "CPSC consumer products" };

const styles = StyleSheet.create({
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sourceRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  sourceName: { color: colors.text, fontWeight: "600", flex: 1 },
  sourceStatus: { fontSize: 12 },
});
