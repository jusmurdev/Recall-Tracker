export const colors = {
  bg: "#0B1F2A",
  card: "#132B38",
  cardAlt: "#193645",
  text: "#F2F6F8",
  muted: "#9FB3BE",
  border: "#234858",
  accent: "#3DBE9E",
  critical: "#E25555",
  high: "#F2A33A",
  low: "#5FA8F5",
  unknown: "#7F94A0",
  premium: "#C99A3A",
} as const;

export const severityColor: Record<string, string> = {
  critical: colors.critical,
  high: colors.high,
  low: colors.low,
  unknown: colors.unknown,
};

export const spacing = (n: number) => n * 8;
