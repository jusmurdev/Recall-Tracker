/** Fuzzy venue matching helpers shared by the open-data adapters. */

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|restaurant|cafe|café|grill|kitchen|bar|llc|inc|corp|co)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dice coefficient on word bigrams + token overlap; 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const overlap = [...ta].filter((t) => tb.has(t)).length;
  const tokenScore = (2 * overlap) / (ta.size + tb.size);
  const grams = (s: string) => {
    const out = new Set<string>();
    const str = s.replace(/ /g, "");
    for (let i = 0; i + 1 < str.length; i += 1) out.add(str.slice(i, i + 2));
    return out;
  };
  const ga = grams(na);
  const gb = grams(nb);
  const gOverlap = [...ga].filter((g) => gb.has(g)).length;
  const gramScore = (2 * gOverlap) / (ga.size + gb.size);
  return Math.max(tokenScore, gramScore);
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Pick the best candidate venue for a profile: name similarity, with a distance tiebreak when
 * both sides have coordinates. Returns null below a confidence floor to avoid attaching a
 * stranger's grade to the wrong restaurant.
 */
export function pickBestVenue<T extends { name: string; latitude?: number | null; longitude?: number | null }>(
  profile: { name: string; latitude: number | null; longitude: number | null },
  candidates: T[],
): T | null {
  let best: { c: T; score: number } | null = null;
  for (const c of candidates) {
    let score = nameSimilarity(profile.name, c.name);
    if (profile.latitude != null && profile.longitude != null && c.latitude != null && c.longitude != null) {
      const d = distanceKm(profile.latitude, profile.longitude, c.latitude, c.longitude);
      if (d > 2) score -= 0.4; // same name, different neighbourhood: probably a chain sibling
      else if (d < 0.3) score += 0.15;
    }
    if (!best || score > best.score) best = { c, score };
  }
  return best && best.score >= 0.6 ? best.c : null;
}
