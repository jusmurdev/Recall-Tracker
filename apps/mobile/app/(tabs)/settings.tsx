import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Alert as RNAlert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { type RecallCategory, type RecallSeverity } from "@recall/shared";
import { api } from "@/api/client";
import { Body, Button, Card, Collapsible, Hint, Input, Pill, PremiumTag, Screen, Small, Subtitle, SwitchRow, Title } from "@/components/ui";
import { ALLERGY_PROFILES, DIET_TOGGLES, EMPTY_DIET, addOtherAllergen, removeOtherAllergen, toggleProfile } from "@/lib/diet";
import { deviceTimezone } from "@/hooks/useTimezoneSync";
import { usePushStatus } from "@/lib/pushStatus";
import { resetWidgets } from "@/widgets/WidgetSync";
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
  const push = usePushStatus();
  const diet = me.data?.diet ?? EMPTY_DIET;
  const [otherAllergen, setOtherAllergen] = useState("");
  const [allergenError, setAllergenError] = useState<string | null>(null);
  const [dietNote, setDietNote] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const allergenRef = useRef<TextInput>(null);
  const scrollY = useRef(0);
  // The allergen box sits mid-page; when the keyboard opens, bring it (and the Add button) into view.
  const revealAllergenInput = () => {
    setTimeout(() => {
      allergenRef.current?.measureInWindow((_x, y, _w, h) => {
        const visibleBottom = 280; // roughly the top of a soft keyboard on a 2340px-tall phone, in points
        if (y + h > visibleBottom) scrollRef.current?.scrollTo({ y: scrollY.current + (y + h - visibleBottom) + 24, animated: true });
      });
    }, 250);
  };
  const saveDiet = (next: typeof diet) =>
    update.mutate(next, {
      onSuccess: (res) => {
        const n = res.dietAlertsMatching ?? 0;
        const anyOn = next.dietProfiles.length > 0 || next.otherAllergens.length > 0;
        if (!anyOn) setDietNote(null);
        else if (n > 0) setDietNote(`${n} recent recall${n === 1 ? "" : "s"} match${n === 1 ? "es" : ""} your profile. See the Alerts tab.`);
        else setDietNote("No current recall matches your profile. We'll tell you when one does.");
      },
    });
  const addAllergen = () => {
    const r = addOtherAllergen(diet, otherAllergen);
    setAllergenError(r.error);
    if (!r.error) {
      setOtherAllergen("");
      if (r.next !== diet) saveDiet(r.next);
    }
  };
  const tz = prefs?.timezone ?? deviceTimezone();
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
          await resetWidgets();
          RNAlert.alert("Done", "Your data has been deleted.");
        },
      },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <Screen>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}>
        <ScrollView ref={scrollRef} onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)} scrollEventThrottle={100} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: spacing(6) }}>
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
            <Subtitle>Diet and allergies</Subtitle>
            <Small>Get told when a recall mentions something you avoid, even if you never added the product. Scans get a heads-up too.</Small>
            {/* Right under the intro, so it is on screen where the user just tapped. */}
            {dietNote ? (
              <View style={styles.notice} accessibilityRole="alert" accessibilityLiveRegion="polite">
                <Ionicons name="information-circle-outline" size={18} color={colors.high} />
                <Small style={{ flex: 1, color: colors.text }}>{dietNote}</Small>
                {dietNote.includes("Alerts") ? <Button title="Open" variant="ghost" onPress={() => router.push("/alerts")} style={{ minHeight: 40, paddingVertical: 6, paddingHorizontal: 14, flexShrink: 0 }} /> : null}
              </View>
            ) : null}
            {me.data ? (
              <>
                <Small>Allergies</Small>
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {ALLERGY_PROFILES.map((a) => (
                    <Pill key={a.profile} label={`${a.emoji} ${a.label}`} active={diet.dietProfiles.includes(a.profile)} onPress={() => saveDiet(toggleProfile(diet, a.profile))} />
                  ))}
                  {diet.otherAllergens.map((w) => (
                    <Pill key={w} label={`✕ ${w}`} active onPress={() => saveDiet(removeOtherAllergen(diet, w))} />
                  ))}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                  {/* The field keeps room for its placeholder; on narrow screens or large text the Add button wraps below it. */}
                  <Input ref={allergenRef} placeholder="Other allergen" value={otherAllergen} onChangeText={setOtherAllergen} onSubmitEditing={addAllergen} onFocus={revealAllergenInput} returnKeyType="done" autoCapitalize="none" style={{ flexGrow: 1, flexBasis: 200, minWidth: 0 }} />
                  <Button title="Add" variant="secondary" disabled={otherAllergen.trim().length < 2} onPress={addAllergen} style={{ flexShrink: 0, paddingHorizontal: 16 }} />
                </View>
                <Hint>Add one we don't list, e.g. mustard, lupin, celery</Hint>
                {allergenError ? <Small style={{ color: colors.critical }}>{allergenError}</Small> : null}
                {DIET_TOGGLES.map((t) => (
                  <SwitchRow key={t.profile} label={t.label} description={t.description} value={diet.dietProfiles.includes(t.profile)} onValueChange={() => saveDiet(toggleProfile(diet, t.profile))} />
                ))}
                <Small>Matches come from the words in recall notices and labels. They can miss things and never say a product is halal or kosher. Always check the package.</Small>
                <Button title="About diet alerts" variant="ghost" icon="help-circle-outline" onPress={() => router.push("/diet-info")} />
              </>
            ) : (
              <Small>Loading…</Small>
            )}
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
                <SwitchRow
                  label="Quiet hours"
                  description={prefs.quietHoursStart != null ? `Non-urgent alerts wait until ${fmtHour(prefs.quietHoursEnd ?? 7)}${tz ? ` (${tz.replace(/_/g, " ")})` : ""}` : "Hold non-urgent alerts overnight"}
                  value={prefs.quietHoursStart != null}
                  onValueChange={(v) => setPref(v ? { quietHoursStart: 22, quietHoursEnd: 7 } : { quietHoursStart: null, quietHoursEnd: null })}
                />
                <SwitchRow label="One daily summary" description="Instead of a buzz per alert. Serious recalls still come straight away." value={prefs.digestMode} onValueChange={(v) => setPref({ digestMode: v })} />
                {push.state === "unavailable" || push.state === "denied" ? (
                  <View style={styles.notice}>
                    <Ionicons name="notifications-off-outline" size={18} color={colors.high} />
                    <Small style={{ flex: 1, color: colors.text }}>
                      {push.state === "denied" ? "Notifications are turned off for this app. Alerts still appear here and on the Home tab." : "Push notifications aren't available in this build. Alerts still appear here and on the Home tab."}
                      {tz ? ` Quiet hours and summaries use your phone's time zone (${tz.replace(/_/g, " ")}).` : ""}
                    </Small>
                  </View>
                ) : null}
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
              <SwitchRow label="Heads-up when I arrive" description={'A nudge if you walk into a tracked restaurant with a supplier recall. Needs "Always" location.'} value={geofences} disabled={geoBusy} onValueChange={(v) => void toggleGeofences(v)} />
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
        </KeyboardAvoidingView>
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: colors.highSoft, borderRadius: radius.sm },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  _r: { borderRadius: radius.sm },
  _t: { color: colors.text },
});
