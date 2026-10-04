import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateWatchItemRequest, DismissAlertRequest, RecallListQuery, ResolveAlertRequest, ScanMatchRequest, UpdatePreferencesRequest } from "@recall/shared";
import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "@/api/client";

export const keys = {
  me: ["me"] as const,
  stats: ["stats"] as const,
  recalls: (q: Partial<RecallListQuery>) => ["recalls", q] as const,
  recall: (id: string) => ["recall", id] as const,
  watchlist: ["watchlist"] as const,
  alerts: ["alerts"] as const,
  alert: (id: string) => ["alert", id] as const,
  connectors: ["connectors"] as const,
  restaurant: (id: string) => ["restaurant", id] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: 60_000 });
export const useStats = () => useQuery({ queryKey: keys.stats, queryFn: api.stats, staleTime: 5 * 60_000 });

export function useRecallFeed(q: Partial<RecallListQuery>) {
  return useInfiniteQuery({
    queryKey: keys.recalls(q),
    queryFn: ({ pageParam }) => api.recalls({ ...q, cursor: pageParam ?? undefined, limit: 25 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 60_000,
  });
}

export const useRecall = (id: string) => useQuery({ queryKey: keys.recall(id), queryFn: () => api.recall(id) });
export const useWatchlist = () => useQuery({ queryKey: keys.watchlist, queryFn: api.watchlist });
export function useAlerts() {
  const q = useQuery({ queryKey: keys.alerts, queryFn: () => api.alerts(), refetchInterval: 60_000 });
  // Keep the app icon badge equal to the unread count.
  useEffect(() => {
    if (q.data && Platform.OS !== "web") Notifications.setBadgeCountAsync(q.data.unread).catch(() => undefined);
  }, [q.data?.unread]);
  return q;
}
export const useAlert = (id: string) => useQuery({ queryKey: keys.alert(id), queryFn: () => api.alert(id) });
export const useConnectors = (enabled: boolean) => useQuery({ queryKey: keys.connectors, queryFn: api.connectors, enabled });
export const useRestaurant = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.restaurant(id), queryFn: () => api.restaurant(id), enabled, refetchInterval: (q) => (q.state.data?.status === "pending" ? 10_000 : false) });

export function useCreateWatchItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWatchItemRequest) => api.createWatchItem(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.watchlist });
      void qc.invalidateQueries({ queryKey: keys.alerts });
    },
  });
}

export function useDeleteWatchItem() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteWatchItem(id), onSuccess: () => void qc.invalidateQueries({ queryKey: keys.watchlist }) });
}

export function useScanMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ScanMatchRequest) => api.scanMatch(body),
    onSuccess: (_d, vars) => {
      if (vars.watch) {
        void qc.invalidateQueries({ queryKey: keys.watchlist });
        void qc.invalidateQueries({ queryKey: keys.alerts });
      }
    },
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.markRead(id), onSuccess: () => void qc.invalidateQueries({ queryKey: keys.alerts }) });
}

export function useImportPurchases() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.importPurchases(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.watchlist });
      void qc.invalidateQueries({ queryKey: keys.alerts });
      void qc.invalidateQueries({ queryKey: keys.connectors });
    },
  });
}

export function useAlertAction() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.alerts });
    void qc.invalidateQueries({ queryKey: ["alert"] });
  };
  const dismiss = useMutation({ mutationFn: ({ id, ...body }: { id: string } & DismissAlertRequest) => api.dismissAlert(id, body), onSuccess: invalidate });
  const undismiss = useMutation({ mutationFn: (id: string) => api.undismissAlert(id), onSuccess: invalidate });
  const resolve = useMutation({ mutationFn: ({ id, ...body }: { id: string } & ResolveAlertRequest) => api.resolveAlert(id, body), onSuccess: invalidate });
  return { dismiss, undismiss, resolve };
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: UpdatePreferencesRequest) => api.updatePreferences(body), onSuccess: () => void qc.invalidateQueries({ queryKey: keys.me }) });
}
