import type {
  Alert,
  AuthResponse,
  Connector,
  CreateConnectorRequest,
  CreateWatchItemRequest,
  CreateWatchItemResponse,
  ImportPurchasesResponse,
  Recall,
  RecallListQuery,
  NearbyRestaurant,
  RegisterDeviceRequest,
  RestaurantLookup,
  ScanMatch,
  ScanMatchRequest,
  ScanMatchResponse,
  UpdateLocationRequest,
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
}

let signingIn: Promise<string> | null = null;

/** Ensure we hold a bearer token; signs in anonymously on first launch. */
export async function ensureSession(): Promise<string> {
  const existing = await getToken();
  if (existing) return existing;
  if (!signingIn) {
    signingIn = (async () => {
      const installId = await getInstallId();
      const res = await fetch(`${apiBaseUrl()}/v1/auth/anonymous`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ installId, platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web" }),
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
  const res = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers });
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
  updateLocation: (body: UpdateLocationRequest) =>
    request<{ homeState: string | null; lastKnownState: string | null; lastLocationAt: string | null }>("/v1/me/location", { method: "PUT", body: JSON.stringify(body) }),

  recalls: (q: Partial<RecallListQuery>) => request<{ items: Recall[]; nextCursor: string | null }>(`/v1/recalls?${qs(q)}`, { auth: false }),
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

  scanMatch: (body: ScanMatchRequest) => request<ScanMatchResponse>("/v1/scan/match", { method: "POST", body: JSON.stringify(body) }),
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
      shared: { profileId: string; trackedBy: number; researchCount: number; cacheHits: number; fresh: boolean; canRefresh: boolean } | null;
    }>(`/v1/premium/restaurants/${id}`),
  restaurantLookup: (q: { name: string; city?: string; state?: string; website?: string }) => request<RestaurantLookup>(`/v1/premium/restaurants/lookup?${qs(q)}`),
  restaurantsNearby: (q: { lat: number; lng: number; radiusKm?: number }) => request<{ items: NearbyRestaurant[] }>(`/v1/premium/restaurants/nearby?${qs(q)}`),
  refreshRestaurant: (id: string) => request<{ queued: boolean }>(`/v1/premium/restaurants/${id}/refresh`, { method: "POST" }),
};
