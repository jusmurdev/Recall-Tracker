import type {
  Alert,
  AuthResponse,
  CatalogRestaurant,
  Connector,
  CreateConnectorRequest,
  CreateWatchItemRequest,
  CreateWatchItemResponse,
  DietPreferences,
  DismissAlertRequest,
  ImportPurchasesResponse,
  Inspection,
  MapResponse,
  NotificationPreferences,
  PublicRestaurant,
  ReceiptScanRequest,
  ReceiptScanResponse,
  ReceiptSummary,
  Recall,
  RecallListQuery,
  RecallWithDietHit,
  NearbyRestaurant,
  RegisterDeviceRequest,
  ResolveAlertRequest,
  RestaurantGrade,
  RestaurantLookup,
  RestaurantNotice,
  ScanMatch,
  ScanMatchRequest,
  ScanMatchResponse,
  UpdateLocationRequest,
  UpdatePreferencesRequest,
  WatchItem,
} from "@recall/shared";
import { apiBaseUrl } from "@/lib/config";
import { getInstallId, getToken, setToken } from "@/lib/auth";
import { Platform } from "react-native";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
  get premiumRequired(): boolean {
    return this.status === 402;
  }
  /** The request never reached the server (offline, wrong address, server down). */
  get offline(): boolean {
    return this.status === 0;
  }
}

export const OFFLINE_MESSAGE = "Can't reach the server. Check your connection and try again.";

/** fetch() rejects with a raw TypeError/IOException when the network is down; say it plainly. */
async function safeFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    throw new ApiError(0, "network", OFFLINE_MESSAGE);
  }
}

function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

let signingIn: Promise<string> | null = null;

/** Ensure we hold a bearer token; signs in anonymously on first launch. */
export async function ensureSession(): Promise<string> {
  const existing = await getToken();
  if (existing) return existing;
  if (!signingIn) {
    signingIn = (async () => {
      const installId = await getInstallId();
      const res = await safeFetch(`${apiBaseUrl()}/v1/auth/anonymous`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Timezone travels with sign-in so quiet hours are right even when push registration fails.
        body: JSON.stringify({ installId, platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web", timezone: deviceTimezone() }),
      });
      if (!res.ok) throw new ApiError(res.status, "auth_failed", "Could not sign in");
      const body = (await res.json()) as AuthResponse;
      await setToken(body.token);
      return body.token;
    })().finally(() => {
      signingIn = null;
    });
  }
  return signingIn;
}

async function request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...(init.headers as Record<string, string> | undefined) };
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  if (init.auth !== false) headers.authorization = `Bearer ${await ensureSession()}`;
  const res = await safeFetch(`${apiBaseUrl()}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (body ?? {}) as { code?: string; error?: string; message?: string };
    if (res.status === 401) await setToken(""); // token rotated elsewhere; next call re-authenticates
    throw new ApiError(res.status, err.code ?? err.error ?? "error", err.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

const qs = (params: Record<string, string | number | boolean | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

export interface Me {
  id: string;
  tier: "free" | "premium";
  homeState: string | null;
  lastKnownState: string | null;
  preferences: NotificationPreferences;
  /** Dietary profile selections (free tier). */
  diet: DietPreferences;
  premium: { tier: "free" | "premium"; features: { connectors: boolean; restaurants: boolean; aiScan: boolean }; expiresAt: string | null };
}

export interface Stats {
  last7Days: number;
  severityLast7Days: Record<string, number>;
  totalBySource: Record<string, number>;
  sources: Array<{ source: string; lastSuccessAt: string | null; healthy: boolean }>;
}

export const api = {
  me: () => request<Me>("/v1/me"),
  registerDevice: (body: RegisterDeviceRequest) => request<{ id: string }>("/v1/devices", { method: "POST", body: JSON.stringify(body) }),
  updatePreferences: (body: UpdatePreferencesRequest) => request<NotificationPreferences & { diet: DietPreferences; dietAlertsAdded: number; dietAlertsMatching?: number }>("/v1/me/preferences", { method: "PATCH", body: JSON.stringify(body) }),
  deleteAccount: () => request<void>("/v1/me", { method: "DELETE" }),
  updateLocation: (body: UpdateLocationRequest) =>
    request<{ homeState: string | null; lastKnownState: string | null; lastLocationAt: string | null }>("/v1/me/location", { method: "PUT", body: JSON.stringify(body) }),

  // "For my diet" needs the signed-in user; everything else is the public feed.
  recalls: (q: Partial<RecallListQuery>) => request<{ items: RecallWithDietHit[]; nextCursor: string | null; diet?: { configured: boolean } }>(`/v1/recalls?${qs({ ...q, diet: q.diet ? "1" : undefined })}`, { auth: !!q.diet }),
  recall: (id: string) => request<Recall>(`/v1/recalls/${id}`, { auth: false }),
  stats: () => request<Stats>("/v1/recalls/stats", { auth: false }),

  watchlist: () => request<{ items: WatchItem[] }>("/v1/watchlist"),
  createWatchItem: (body: CreateWatchItemRequest) => request<CreateWatchItemResponse>("/v1/watchlist", { method: "POST", body: JSON.stringify(body) }),
  watchMatches: (id: string) => request<{ matches: ScanMatch[] }>(`/v1/watchlist/${id}/matches`),
  deleteWatchItem: (id: string) => request<void>(`/v1/watchlist/${id}`, { method: "DELETE" }),

  alerts: (unreadOnly = false) => request<{ items: Alert[]; unread: number }>(`/v1/alerts?${qs({ unreadOnly })}`),
  alert: (id: string) => request<Alert>(`/v1/alerts/${id}`),
  markRead: (id: string) => request<{ updated: number }>(`/v1/alerts/${id}/read`, { method: "POST" }),
  markAllRead: () => request<{ updated: number }>("/v1/alerts/read-all", { method: "POST" }),
  dismissAlert: (id: string, body: DismissAlertRequest) => request<{ dismissed: boolean }>(`/v1/alerts/${id}/dismiss`, { method: "POST", body: JSON.stringify(body) }),
  undismissAlert: (id: string) => request<{ dismissed: boolean }>(`/v1/alerts/${id}/undismiss`, { method: "POST" }),
  resolveAlert: (id: string, body: ResolveAlertRequest) => request<{ resolved: boolean }>(`/v1/alerts/${id}/resolve`, { method: "POST", body: JSON.stringify(body) }),
  alertSummary: () => request<{ unread: number; open: number; resolved: number; dismissed: number }>("/v1/alerts/summary"),

  scanMatch: (body: ScanMatchRequest) => request<ScanMatchResponse>("/v1/scan/match", { method: "POST", body: JSON.stringify(body) }),
  scanReceipt: (body: ReceiptScanRequest) => request<ReceiptScanResponse>("/v1/scan/receipt", { method: "POST", body: JSON.stringify(body) }),
  receipts: () => request<{ items: ReceiptSummary[] }>("/v1/scan/receipts"),
  receipt: (id: string) => request<ReceiptScanResponse>(`/v1/scan/receipts/${id}`),
  scanIdentify: (body: { imageBase64: string; mediaType?: string; ocrText?: string; context?: string }) =>
    request<ScanMatchResponse & { identified: { brand: string | null; productName: string | null; confidence: string } }>("/v1/scan/identify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  providers: () => request<{ providers: Array<{ id: string; label: string; mcpUrl: string | null; docs: string }> }>("/v1/premium/providers", { auth: false }),
  connectors: () => request<{ items: Connector[] }>("/v1/premium/connectors"),
  createConnector: (body: CreateConnectorRequest) => request<Connector>("/v1/premium/connectors", { method: "POST", body: JSON.stringify(body) }),
  deleteConnector: (id: string) => request<void>(`/v1/premium/connectors/${id}`, { method: "DELETE" }),
  importPurchases: (id: string) => request<ImportPurchasesResponse>(`/v1/premium/connectors/${id}/import`, { method: "POST" }),
  restaurant: (id: string) =>
    request<{
      watchItemId: string;
      restaurant: string;
      summary: string;
      supplierTerms: string[];
      riskSignals: Array<{ signal: string; sourceUrl: string | null }>;
      sources: string[];
      matchedRecalls: ScanMatch[];
      researchedAt: string | null;
      status: "ready" | "pending" | "failed";
      error: string | null;
      location: { latitude: number; longitude: number } | null;
      grade: RestaurantGrade | null;
      gradeCoverage: "open_data" | "research" | "none";
      gradeError: string | null;
      inspections: Inspection[];
      updates: RestaurantNotice[];
      shared: { profileId: string; trackedBy: number; researchCount: number; cacheHits: number; fresh: boolean; canRefresh: boolean } | null;
    }>(`/v1/premium/restaurants/${id}`),
  restaurantLookup: (q: { name: string; city?: string; state?: string; website?: string }) => request<RestaurantLookup>(`/v1/premium/restaurants/lookup?${qs(q)}`),
  restaurantsNearby: (q: { lat: number; lng: number; radiusKm?: number }) => request<{ items: NearbyRestaurant[] }>(`/v1/premium/restaurants/nearby?${qs(q)}`),
  restaurantsMap: (q: { lat: number; lng: number; radiusKm?: number; discover?: boolean }) => request<MapResponse>(`/v1/restaurants/map?${qs(q)}`),
  restaurantPublic: (profileId: string) => request<PublicRestaurant>(`/v1/restaurants/${profileId}`),
  restaurantSearch: (q: { q: string; lat?: number; lng?: number; state?: string }) => request<{ items: CatalogRestaurant[] }>(`/v1/premium/restaurants/search?${qs(q)}`),
  restaurantUpdates: () => request<{ unread: number; items: RestaurantNotice[] }>("/v1/premium/restaurants/updates"),
  restaurantUpdatesReadAll: () => request<{ updated: number }>("/v1/premium/restaurants/updates/read-all", { method: "POST" }),
  refreshGrade: (id: string) => request<{ queued: boolean; reason?: string; grade?: RestaurantGrade }>(`/v1/premium/restaurants/${id}/grade/refresh`, { method: "POST" }),
  refreshRestaurant: (id: string) => request<{ queued: boolean }>(`/v1/premium/restaurants/${id}/refresh`, { method: "POST" }),
};
