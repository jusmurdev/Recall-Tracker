import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

export type PushStatus =
  | { state: "unknown" }
  | { state: "registered"; token: string }
  | { state: "denied" }
  /** Device has no push credentials (no FCM/APNs config in this build) or is a simulator/web. */
  | { state: "unavailable"; reason: string };

export const PUSH_STATUS_KEY = ["push-status"] as const;

export function setPushStatus(qc: QueryClient, status: PushStatus): void {
  qc.setQueryData(PUSH_STATUS_KEY, status);
}

export function usePushStatus(): PushStatus {
  const qc = useQueryClient();
  const q = useQuery<PushStatus>({ queryKey: PUSH_STATUS_KEY, queryFn: () => (qc.getQueryData<PushStatus>(PUSH_STATUS_KEY) ?? { state: "unknown" }), staleTime: Infinity, gcTime: Infinity });
  return q.data ?? { state: "unknown" };
}
