import * as Location from "expo-location";
import { Platform } from "react-native";
import { US_STATES } from "@recall/shared";

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC", "puerto rico": "PR",
};

export interface Place {
  latitude: number;
  longitude: number;
  city: string | null;
  /** Two-letter US state code, or null outside the US / unknown. */
  state: string | null;
  name: string | null;
  street: string | null;
}

/** Normalise whatever the platform geocoder returns ("California", "CA", "US-CA") to a code. */
export function toStateCode(region: string | null | undefined, isoCountry?: string | null): string | null {
  if (!region) return null;
  if (isoCountry && isoCountry !== "US" && isoCountry !== "PR") return null;
  const trimmed = region.trim().replace(/^US-/i, "");
  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && (US_STATES as readonly string[]).includes(upper)) return upper;
  return STATE_NAMES[trimmed.toLowerCase()] ?? null;
}

export async function hasForegroundPermission(): Promise<boolean> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status === "granted";
}

export async function requestForegroundPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === "granted";
}

export async function requestBackgroundPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  if (!(await requestForegroundPermission())) return false;
  const { status } = await Location.requestBackgroundPermissionsAsync();
  return status === "granted";
}

/** Current coordinates (balanced accuracy is plenty for city/state and nearby lookups). */
export async function currentCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
  if (!(await hasForegroundPermission())) return null;
  const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
  const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  return pos ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : null;
}

/**
 * Where is the phone? Reverse geocoding runs on-device (Apple's geocoder on iOS, no API key),
 * so coordinates never leave the phone: only the resulting state is sent to our server.
 */
export async function currentPlace(): Promise<Place | null> {
  const coords = await currentCoordinates();
  if (!coords) return null;
  const [addr] = await Location.reverseGeocodeAsync(coords).catch(() => []);
  return {
    ...coords,
    city: addr?.city ?? addr?.subregion ?? null,
    state: toStateCode(addr?.region, addr?.isoCountryCode),
    name: addr?.name ?? null,
    street: addr?.street ?? null,
  };
}

/** Forward geocode a typed address/venue so a restaurant can get coordinates without GPS. */
export async function geocodeAddress(query: string): Promise<{ latitude: number; longitude: number } | null> {
  const [hit] = await Location.geocodeAsync(query).catch(() => []);
  return hit ? { latitude: hit.latitude, longitude: hit.longitude } : null;
}
