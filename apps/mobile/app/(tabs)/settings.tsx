import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert as RNAlert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { type RecallCategory, type RecallSeverity } from "@recall/shared";
import { api } from "@/api/client";
import { Body, Button, Card, Collapsible, Pill, PremiumTag, Screen, Small, Subtitle, Title } from "@/components/ui";
import { useMe, useStats, useUpdatePreferences, useWatchlist } from "@/hooks/queries";
import { useLocationState } from "@/hooks/useLocationState";
import { setToken } from "@/lib/auth";
import { apiBaseUrl } from "@/lib/config";
import { CATEGORY_EMOJI, CATEGORY_FRIENDLY } from "@/lib/friendly";
import { geofenceSupported, isGeofencingActive, stopGeofences, syncGeofences } from "@/lib/geofence";
import { requestBackgroundPermission } from "@/lib/location";
import { colors, radius, spacing } from "@/lib/theme";

const SEV: Array<{ v: RecallSeverity; label: string }> = [
  { v: "unknown", label: "Everything" },
  { v: "high", label: "Serious & moderate" },
  { v: "critical", label: "Only serious" },
];
const CATS: RecallCategory[] = ["food", "meat_poultry", "veterinary", "dietary_supplement", "cosmetic", "drug", "consumer_product", "medical_device"];
const fmtHour = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

export default function SettingsScreen() {
  const me = useMe();
  const stats = useStats();
  const list = useWatchlist();
  const loc = useLocationState();
  const qc = useQueryClient();
  const premium = me.data?.tier === "premium";
  const prefs = me.data?.preferences;
  const update = useUpdatePreferences();
  const setPref = (patch: Parameters<typeof update.mutate>[0]) => update.mutate(patch);
  const [geofences, setGeofences] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  useEffect(() => {
    void isGeofencingActive().then(setGeofences);
  }, []);
  const trackedRestaurants = (list.data?.items ?? []).filter((w) => w.kind === "restaurant" && w.restaurant?.latitude != null).length;

  const toggleGeofences = async (on: boolean) => {
    setGeoBusy(true);
    try {
      if (!on) {
        await stopGeofences();
        setGeofences(false);
        return;
      }
      const ok = await requestBackgroundPermission();
      if (!ok) return setGeofences(false);
      const n = await syncGeofences(list.data?.items ?? []);
      setGeofences(n > 0 || trackedRestaurants === 0);
    } finally {
      setGeoBusy(false);
    }
  };

  const deleteAccount = () =>
    RNAlert.alert("Delete everything?", "Your watchlist, alerts and connected accounts will be removed. This can't be undone.", [
      { text: "Keep my data", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await api.deleteAccount();
          await setToken("");
          qc.clear();
          RNAlert.alert("Done", "Your data has been deleted.");
        },
      },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <Screen>
        <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: spacing(6) }}>
          <Title>You</Title>

          <Pressable onPress={() => router.push(premium ? "/premium/connectors" : "/premium")} accessibilityRole="button">
            <Card tone="premium">
              <View style={styles.row}>
                <Ionicons name="sparkles" size={22} color={colors.premium} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "700" }}>{premium ? "You're on Premium" : "Try Premium"}</Body>
                  <Small>{premium ? "Manage connected accounts" : "Restaurant grades, supplier alerts, import your shopping"}</Small>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </View>
            </Card>
          </Pressable>

          <Card>
            <Subtitle>Where you are</Subtitle>
            <Body>{me.data?.homeState ? `Home: ${me.data.homeState}${me.data.lastKnownState && me.data.lastKnownState !== me.data.homeState ? ` · now in ${me.data.lastKnownState}` : ""}` : "We don't know your state yet"}</Body>
            <Small>Recalls sold near you come first. We only ever save the state, never your exact location.</Small>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Button title={loc.busy ? "Finding you…" : "Use my location"} icon="locate" style={{ flex: 1 }} loading={loc.busy} onPress={() => void loc.refresh({ ask: true, setHome: !me.data?.homeState })} />
              {loc.state ? <Button title="Set as home" variant="secondary" onPress={() => void loc.refresh({ ask: true, setHome: true })} /> : null}
            </View>
            {loc.permission === "denied" ? <Button title="Allow location in Settings" variant="ghost" onPress={() => void Linking.openSettings()} /> : null}
          </Card>

          <Card>
            <Subtitle>Notifications</Subtitle>
            {prefs ? (
              <>
                <Small>Tell me about</Small>
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {SEV.map((s) => (
                    <Pill key={s.v} label={s.label} active={prefs.pushMinSeverity === s.v} onPress={() => setPref({ pushMinSeverity: s.v })} />
                  ))}
                </View>
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Body>Quiet hours</Body>
                    <Small>{prefs.quietHoursStart != null ? `Non-urgent alerts wait until ${fmtHour(prefs.quietHoursEnd ?? 7)}` : "Hold non-urgent alerts overnight"}</Small>
                  </View>
                  <Switch value={prefs.quietHoursStart != null} onValueChange={(v) => setPref(v ? { quietHoursStart: 22, quietHoursEnd: 7 } : { quietHoursStart: null, quietHoursEnd: null })} trackColor={{ true: colors.accent }} />
                </View>
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Body>One daily summary</Body>
                    <Small>Instead of a buzz per alert. Serious recalls still come straight away.</Small>
                  </View>
                  <Switch value={prefs.digestMode} onValueChange={(v) => setPref({ digestMode: v })} trackColor={{ true: colors.accent }} />
                </View>
                <Collapsible title="More options">
                  <View style={{ gap: 10 }}>
                    {prefs.digestMode ? (
                      <>
                        <Small>Summary time</Small>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          {[7, 8, 9, 12, 18, 20].map((h) => (
                            <Pill key={h} label={fmtHour(h)} active={prefs.digestHour === h} onPress={() => setPref({ digestHour: h })} />
                          ))}
                        </ScrollView>
                      </>
                    ) : null}
                    {prefs.quietHoursStart != null ? (
                      <>
                        <Small>Quiet from / until</Small>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          {[20, 21, 22, 23].map((h) => (
                            <Pill key={h} label={fmtHour(h)} active={prefs.quietHoursStart === h} onPress={() => setPref({ quietHoursStart: h, quietHoursEnd: prefs.quietHoursEnd ?? 7 })} />
                          ))}
                          {[6, 7, 8, 9].map((h) => (
                            <Pill key={h} label={`until ${fmtHour(h)}`} active={prefs.quietHoursEnd === h} onPress={() => setPref({ quietHoursStart: prefs.quietHoursStart ?? 22, quietHoursEnd: h })} />
                          ))}
                        </ScrollView>
                      </>
                    ) : null}
                    <Small>Don't buzz me about</Small>
                    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                      {CATS.map((c) => (
                        <Pill
                          key={c}
                          label={`${CATEGORY_EMOJI[c]} ${CATEGORY_FRIENDLY[c]}`}
                          active={prefs.mutedCategories.includes(c)}
                          onPress={() => setPref({ mutedCategories: prefs.mutedCategories.includes(c) ? prefs.mutedCategories.filter((x) => x !== c) : [...prefs.mutedCategories, c] })}
                        />
                      ))}
                    </View>
                  </View>
                </Collapsible>
              </>
            ) : (
              <Small>Loading…</Small>
            )}
          </Card>

          {premium && geofenceSupported() ? (
            <Card>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Body>Heads-up when I arrive</Body>
                  <Small>A nudge if you walk into a tracked restaurant with a supplier recall. Needs "Always" location.</Small>
                </View>
                <Switch value={geofences} disabled={geoBusy} onValueChange={(v) => void toggleGeofences(v)} trackColor={{ true: colors.accent }} />
              </View>
            </Card>
          ) : null}

          <Card>
            <Collapsible title="About this app">
              <View style={{ gap: 12 }}>
                <Small>
                  We pull every recall a few times a day from the FDA, USDA and CPSC into one place, so your phone never has to. This app surfaces official notices; always follow the instructions in the recall itself.
                </Small>
                {(stats.data?.sources ?? []).map((s) => (
                  <View key={s.source} style={styles.sourceRow}>
                    <Ionicons name={s.healthy ? "checkmark-circle" : "alert-circle"} size={16} color={s.healthy ? colors.success : colors.high} />
                    <Small style={{ flex: 1 }}>
                      {s.source === "FSIS" ? "USDA (meat, poultry, eggs)" : s.source === "CPSC" ? "CPSC (household products)" : "FDA (food, drugs, cosmetics)"} · {s.lastSuccessAt ? `updated ${new Date(s.lastSuccessAt).toLocaleDateString()}` : "not yet"}
                    </Small>
                  </View>
                ))}
                <Small style={{ fontSize: 11 }}>
                  {Platform.OS} · {apiBaseUrl()} · {me.data?.id ?? ""}
                </Small>
                <Button title="Delete my data" variant="ghost" onPress={deleteAccount} />
              </View>
            </Collapsible>
          </Card>
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  _r: { borderRadius: radius.sm },
  _t: { color: colors.text },
});
