/**
 * Warm, calm, light palette. Colour is reserved for status (how worried should I be?) and
 * one accent for actions, so the eye lands on what matters.
 */
export const colors = {
  bg: "#F7F4EE",
  card: "#FFFFFF",
  cardAlt: "#F1EDE4",
  text: "#1F2A33",
  muted: "#6B7781",
  border: "#E6E0D4",
  accent: "#1F8A80", // teal: actions, "all clear"
  accentSoft: "#DDEFEC",
  critical: "#D64B4B", // "Serious"
  criticalSoft: "#FBE4E4",
  high: "#E09A2B", // "Moderate"
  highSoft: "#FBEFD9",
  low: "#4A7FC1", // "Minor"
  lowSoft: "#E1EAF7",
  unknown: "#8A949C",
  unknownSoft: "#ECEEF0",
  success: "#2E9E6B",
  successSoft: "#DFF3E8",
  premium: "#B9841E",
  premiumSoft: "#F7ECD4",
} as const;

export const severityColor: Record<string, string> = { critical: colors.critical, high: colors.high, low: colors.low, unknown: colors.unknown };
export const severitySoft: Record<string, string> = { critical: colors.criticalSoft, high: colors.highSoft, low: colors.lowSoft, unknown: colors.unknownSoft };

export const spacing = (n: number) => n * 8;
export const radius = { sm: 10, md: 16, lg: 22, pill: 999 };
