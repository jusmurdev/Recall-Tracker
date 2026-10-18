import type { RecallSource } from "@recall/shared";
import { HttpError } from "../lib/http.js";

/** Operator guidance for known source access failures; null when no specific advice applies. */
export function ingestFailureAdvice(source: RecallSource, err: unknown): string | null {
  if (source !== "FSIS" || !(err instanceof HttpError) || err.status !== 403) return null;
  return "FSIS returned HTTP 403. This may be an edge/egress restriction; verify response headers, then retry from a different network or egress IP. Changing User-Agent headers is not expected to help.";
}
