import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type ViewProps, type ViewStyle } from "react-native";
import { colors, severityColor, spacing } from "@/lib/theme";
import { CATEGORY_LABEL, type Recall, type RecallSeverity } from "@recall/shared";

export function Screen({ children, style, ...rest }: ViewProps) {
  return (
    <View style={[styles.screen, style]} {...rest}>
      {children}
    </View>
  );
}

export function Card({ children, style, ...rest }: ViewProps) {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}
export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}
export function Body({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[styles.body, muted && { color: colors.muted }, style]}>{children}</Text>;
}

export function Button({
  title,
  variant = "primary",
  loading,
  style,
  ...rest
}: Omit<PressableProps, "style"> & { title: string; variant?: "primary" | "ghost" | "danger" | "premium"; loading?: boolean; style?: StyleProp<ViewStyle> }) {
  const bg = variant === "primary" ? colors.accent : variant === "danger" ? colors.critical : variant === "premium" ? colors.premium : "transparent";
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: pressed || rest.disabled ? 0.6 : 1 }, variant === "ghost" && styles.ghost, style]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === "ghost" ? colors.accent : colors.bg} />
      ) : (
        <Text style={[styles.buttonText, variant === "ghost" && { color: colors.accent }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.input, props.style]} />;
}

export function SeverityBadge({ severity }: { severity: RecallSeverity }) {
  const label = severity === "critical" ? "Class I · Critical" : severity === "high" ? "Class II · High" : severity === "low" ? "Class III · Low" : "Unclassified";
  return (
    <View style={[styles.badge, { backgroundColor: severityColor[severity] }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export function Pill({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active }} accessibilityLabel={label} onPress={onPress} style={[styles.pill, active && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
      <Text style={[styles.pillText, active && { color: colors.bg, fontWeight: "700" }]}>{label}</Text>
    </Pressable>
  );
}

export function PremiumTag() {
  return (
    <View style={[styles.badge, { backgroundColor: colors.premium }]}>
      <Text style={styles.badgeText}>PREMIUM</Text>
    </View>
  );
}

export function RecallRow({ recall, onPress, footer }: { recall: Recall; onPress: () => void; footer?: React.ReactNode }) {
  const date = new Date(recall.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${recall.severity} recall: ${recall.title}`} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={[styles.stripe, { backgroundColor: severityColor[recall.severity] }]} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {recall.title}
        </Text>
        <Text style={styles.rowMeta}>
          {recall.source} · {CATEGORY_LABEL[recall.category]} · {date}
        </Text>
        <Text style={styles.rowReason} numberOfLines={2}>
          {recall.reason}
        </Text>
        {footer}
      </View>
    </Pressable>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: spacing(2), borderWidth: 1, borderColor: colors.border, gap: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 14, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  button: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 46 },
  ghost: { borderWidth: 1, borderColor: colors.accent },
  buttonText: { color: colors.bg, fontWeight: "700", fontSize: 15 },
  input: { backgroundColor: colors.cardAlt, color: colors.text, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  badge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: "#0B1F2A", fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  pillText: { color: colors.text, fontSize: 13 },
  row: { flexDirection: "row", gap: 12, padding: spacing(2), backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  stripe: { width: 4, borderRadius: 2 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  rowMeta: { color: colors.muted, fontSize: 12 },
  rowReason: { color: colors.text, fontSize: 13, opacity: 0.85 },
  empty: { padding: spacing(4), alignItems: "center", gap: 6 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "700", textAlign: "center" },
  emptyBody: { color: colors.muted, fontSize: 14, textAlign: "center" },
});
