import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type ViewProps, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Recall, RecallSeverity, RestaurantGrade } from "@recall/shared";
import { colors, radius, severityColor, severitySoft, spacing } from "@/lib/theme";
import { CATEGORY_EMOJI, SEVERITY, headline, plainReason, relativeDay } from "@/lib/friendly";

export function Screen({ children, style, ...rest }: ViewProps) {
  return (
    <View style={[styles.screen, style]} {...rest}>
      {children}
    </View>
  );
}

export function Card({ children, style, tone, ...rest }: ViewProps & { tone?: "default" | "soft" | "accent" | "critical" | "high" | "low" | "success" | "premium" }) {
  const toneStyle =
    tone === "accent" ? { backgroundColor: colors.accentSoft, borderColor: colors.accentSoft }
    : tone === "critical" ? { backgroundColor: colors.criticalSoft, borderColor: colors.criticalSoft }
    : tone === "high" ? { backgroundColor: colors.highSoft, borderColor: colors.highSoft }
    : tone === "low" ? { backgroundColor: colors.lowSoft, borderColor: colors.lowSoft }
    : tone === "success" ? { backgroundColor: colors.successSoft, borderColor: colors.successSoft }
    : tone === "premium" ? { backgroundColor: colors.premiumSoft, borderColor: colors.premiumSoft }
    : tone === "soft" ? { backgroundColor: colors.cardAlt, borderColor: colors.cardAlt }
    : null;
  return (
    <View style={[styles.card, toneStyle, style]} {...rest}>
      {children}
    </View>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}
export function Heading({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.heading, style]}>{children}</Text>;
}
/** Sentence-case section label (no shouting). */
export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}
export function Body({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[styles.body, muted && { color: colors.muted }, style]}>{children}</Text>;
}
export function Small({ children, style, numberOfLines }: { children: React.ReactNode; style?: object; numberOfLines?: number }) {
  return (
    <Text style={[styles.small, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Button({
  title,
  variant = "primary",
  loading,
  icon,
  style,
  ...rest
}: Omit<PressableProps, "style"> & { title: string; variant?: "primary" | "secondary" | "ghost" | "danger" | "premium"; loading?: boolean; icon?: React.ComponentProps<typeof Ionicons>["name"]; style?: StyleProp<ViewStyle> }) {
  const bg = variant === "primary" ? colors.accent : variant === "danger" ? colors.critical : variant === "premium" ? colors.premium : variant === "secondary" ? colors.accentSoft : colors.card;
  const fg = variant === "secondary" ? colors.accent : variant === "ghost" ? colors.accent : "#fff";
  // Every button has a visible edge: filled ones carry a slightly darker border of their own
  // color, outlined ones a clear accent border, so nothing reads as loose text.
  const border = variant === "ghost" ? styles.ghost : variant === "secondary" ? styles.secondary : styles.filledEdge;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.button, border, { backgroundColor: bg, opacity: pressed || rest.disabled ? 0.6 : 1 }, style]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
      style={[styles.input, focused && styles.inputFocused, props.style]}
    />
  );
}

/** Friendly severity chip: "Serious" / "Moderate" / "Minor" with a dot, no class numbers. */
export function SeverityChip({ severity, size = "sm" }: { severity: RecallSeverity; size?: "sm" | "lg" }) {
  const s = SEVERITY[severity];
  return (
    <View style={[styles.chip, { backgroundColor: severitySoft[severity] }, size === "lg" && { paddingVertical: 6, paddingHorizontal: 12 }]} accessibilityLabel={`${s.label} recall`}>
      <View style={[styles.dot, { backgroundColor: severityColor[severity] }]} />
      <Text style={[styles.chipText, { color: severityColor[severity] }, size === "lg" && { fontSize: 14 }]}>{s.label}</Text>
    </View>
  );
}
/** Back-compat alias. */
export const SeverityBadge = SeverityChip;

export function Pill({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: React.ComponentProps<typeof Ionicons>["name"] }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active }} accessibilityLabel={label} onPress={onPress} style={[styles.pill, active && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
      {icon ? <Ionicons name={icon} size={14} color={active ? "#fff" : colors.muted} /> : null}
      <Text style={[styles.pillText, active && { color: "#fff", fontWeight: "700" }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function PremiumTag() {
  return (
    <View style={[styles.chip, { backgroundColor: colors.premiumSoft }]}>
      <Ionicons name="sparkles" size={12} color={colors.premium} />
      <Text style={[styles.chipText, { color: colors.premium }]}>Premium</Text>
    </View>
  );
}

export const gradeColor: Record<RestaurantGrade["level"], string> = { good: colors.success, ok: colors.high, poor: colors.critical, unknown: colors.unknown };
const gradeSoft: Record<RestaurantGrade["level"], string> = { good: colors.successSoft, ok: colors.highSoft, poor: colors.criticalSoft, unknown: colors.unknownSoft };

/** Health grade chip. */
export function GradeBadge({ grade, compact }: { grade: RestaurantGrade | null | undefined; compact?: boolean }) {
  if (!grade || (!grade.grade && grade.score == null)) {
    return compact ? null : (
      <View style={[styles.chip, { backgroundColor: colors.unknownSoft }]}>
        <Text style={[styles.chipText, { color: colors.muted }]}>No grade yet</Text>
      </View>
    );
  }
  const text = grade.grade ?? String(grade.score);
  return (
    <View style={[styles.chip, { backgroundColor: gradeSoft[grade.level] }]} accessibilityLabel={`Health grade ${text}`}>
      <Ionicons name="medkit-outline" size={12} color={gradeColor[grade.level]} />
      <Text style={[styles.chipText, { color: gradeColor[grade.level] }]}>{compact ? text : `Health ${text}`}</Text>
    </View>
  );
}

/**
 * Recall card for lists: emoji, plain headline, plain reason, friendly severity. Agency, category
 * and dates live on the detail page.
 */
export function RecallRow({ recall, onPress, footer, note }: { recall: Recall; onPress: () => void; footer?: React.ReactNode; note?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${SEVERITY[recall.severity].label} recall: ${headline(recall)}`} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}>
      <View style={[styles.emojiBox, { backgroundColor: severitySoft[recall.severity] }]}>
        <Text style={{ fontSize: 22 }}>{CATEGORY_EMOJI[recall.category]}</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {headline(recall)}
        </Text>
        <Text style={styles.rowReason} numberOfLines={2}>
          {plainReason(recall.reason, recall.summary)}
        </Text>
        {note ? (
          <Text style={styles.rowNote} numberOfLines={2}>
            {note}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <SeverityChip severity={recall.severity} />
          <Text style={styles.rowMeta}>{relativeDay(recall.publishedAt)}</Text>
        </View>
        {footer}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.border} />
    </Pressable>
  );
}

/** Big tappable tile for the main actions ("Scan a label", "Add a brand"). */
export function ActionTile({ icon, title, subtitle, onPress, tone = "accent" }: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; subtitle?: string; onPress: () => void; tone?: "accent" | "premium" | "soft" }) {
  const bg = tone === "premium" ? colors.premiumSoft : tone === "soft" ? colors.cardAlt : colors.accentSoft;
  const fg = tone === "premium" ? colors.premium : colors.accent;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.tile, { backgroundColor: bg, opacity: pressed ? 0.8 : 1 }]}>
      <View style={[styles.tileIcon, { backgroundColor: colors.card }]}>
        <Ionicons name={icon} size={22} color={fg} />
      </View>
      <Text style={styles.tileTitle}>{title}</Text>
      {subtitle ? <Text style={styles.tileSub}>{subtitle}</Text> : null}
    </Pressable>
  );
}

/** "Show details" disclosure so the default view stays calm. */
export function Collapsible({ title, children, initiallyOpen = false }: { title: string; children: React.ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={{ gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={styles.disclosure}>
        <Text style={styles.disclosureText}>{title}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.accent} />
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export function Empty({ title, body, icon = "leaf-outline" }: { title: string; body?: string; icon?: React.ComponentProps<typeof Ionicons>["name"] }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={28} color={colors.accent} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

/**
 * A labeled switch where the whole row toggles, not just the knob. Label and description sit on
 * the left, the switch on the right.
 */
export function SwitchRow({ label, description, value, onValueChange, disabled }: { label: string; description?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} accessibilityLabel={label} disabled={disabled} onPress={() => onValueChange(!value)} style={({ pressed }) => [styles.switchRow, pressed && { opacity: 0.7 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.body}>{label}</Text>
        {description ? <Text style={styles.small}>{description}</Text> : null}
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onValueChange} trackColor={{ true: colors.accent }} />
    </Pressable>
  );
}

/** Shown when a screen is displaying cached data because the server could not be reached. */
export function OfflineNotice({ onRetry, stale }: { onRetry?: () => void; stale?: boolean }) {
  return (
    <View style={styles.offline} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={18} color={colors.high} />
      <Text style={[styles.small, { flex: 1, color: colors.text }]}>{stale ? "Can't reach the server. Showing what we saved earlier." : "Can't reach the server. Check your connection."}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
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
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing(2), borderWidth: 1, borderColor: colors.border, gap: 12 },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  heading: { color: colors.text, fontSize: 18, fontWeight: "800" },
  subtitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  body: { color: colors.text, fontSize: 16, lineHeight: 23 },
  small: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  button: { paddingVertical: 13, paddingHorizontal: 20, borderRadius: radius.md, alignItems: "center", justifyContent: "center", minHeight: 50, borderWidth: 1.5 },
  ghost: { borderColor: colors.accent },
  secondary: { borderColor: "rgba(31,138,128,0.35)" },
  filledEdge: { borderColor: "rgba(0,0,0,0.08)" },
  buttonText: { fontWeight: "700", fontSize: 16 },
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, borderWidth: 1.5, borderColor: colors.border, outlineWidth: 0 },
  inputFocused: { borderColor: colors.accent },
  chip: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: "700" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, marginBottom: 8, flexShrink: 0 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  offline: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: colors.highSoft, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(224,154,43,0.35)" },
  retry: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.high },
  retryText: { color: colors.high, fontWeight: "700", fontSize: 13 },
  pillText: { color: colors.text, fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing(2), backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  emojiBox: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  rowReason: { color: colors.muted, fontSize: 14 },
  rowNote: { color: colors.accent, fontSize: 13 },
  rowMeta: { color: colors.muted, fontSize: 12 },
  tile: { flex: 1, borderRadius: radius.lg, padding: spacing(2), gap: 8, minHeight: 118, borderWidth: 1, borderColor: "rgba(0,0,0,0.06)" },
  tileIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tileTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  tileSub: { color: colors.muted, fontSize: 13 },
  disclosure: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: colors.cardAlt },
  disclosureText: { color: colors.accent, fontWeight: "700", fontSize: 15 },
  empty: { padding: spacing(4), alignItems: "center", gap: 8 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" },
  emptyBody: { color: colors.muted, fontSize: 15, textAlign: "center", lineHeight: 21 },
});
