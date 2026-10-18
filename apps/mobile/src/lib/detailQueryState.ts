export type DetailQueryState = "loading" | "notFound" | "error" | "success";

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** Keep cached detail visible during a failed background refresh; classify uncached failures. */
export function detailQueryState(data: unknown, error: unknown): DetailQueryState {
  if (data != null) return "success";
  if (error == null) return "loading";
  return statusOf(error) === 404 ? "notFound" : "error";
}
