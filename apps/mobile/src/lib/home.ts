/**
 * What the Home hero card may say. "All clear" is a claim about data; it is only allowed when the
 * alerts actually loaded (now or from the saved cache). With no data and no way to fetch, the
 * honest answer is "we can't check right now".
 */
export type HomeStatus = "loading" | "unknown" | "needs_look" | "all_clear";

export interface QueryLike {
  data?: unknown;
  isError: boolean;
  isFetching: boolean;
}

export function homeStatus(alerts: QueryLike, openCount: number): HomeStatus {
  if (alerts.data === undefined) return alerts.isError || !alerts.isFetching ? "unknown" : "loading";
  return openCount > 0 ? "needs_look" : "all_clear";
}

/**
 * Which queries the offline cache keeps. TanStack's default keeps only queries whose last fetch
 * succeeded, so one failed refresh (no signal at launch) silently drops the saved alerts and feed,
 * and the next cold start has nothing to show. Keep anything that has data.
 */
export function shouldPersistQuery(query: { state: { data: unknown; status: string } }): boolean {
  return query.state.data !== undefined;
}
