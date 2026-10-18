export type QueryContentState = "loading" | "error" | "empty" | "data" | "stale";

/** A failed request is not an empty result. Even an empty cached response is data. */
export function queryContentState(
  query: { data?: unknown; isError: boolean },
  itemCount: number,
): QueryContentState {
  if (query.data === undefined) return query.isError ? "error" : "loading";
  if (query.isError) return "stale";
  return itemCount > 0 ? "data" : "empty";
}
