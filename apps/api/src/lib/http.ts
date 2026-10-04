import { logger } from "./logger.js";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} for ${url}`);
  }
}

export interface FetchJsonOptions {
  headers?: Record<string, string>;
  /** Retries on 429/5xx/network errors with exponential backoff. */
  retries?: number;
  timeoutMs?: number;
}

/**
 * Small, dependency-free JSON fetcher with retry + backoff. The ingestion jobs are the
 * ONLY place in the system that talks to the public APIs, so we are polite: modest
 * timeouts, honour Retry-After, never hammer on failure.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "recall-tracker-ingest/0.1 (+https://github.com/jusmurdev/recall-tracker)", ...opts.headers },
        signal: controller.signal,
      });
      if (res.status === 404) {
        // openFDA returns 404 with {"error":{"code":"NOT_FOUND"}} when a query has no results.
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        if (body?.error?.code === "NOT_FOUND") return body as unknown as T;
        throw new HttpError(404, url);
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt > retries) throw new HttpError(res.status, url);
        const retryAfter = Number(res.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
        logger.warn({ url, status: res.status, attempt, delay }, "retrying fetch");
        await sleep(delay);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, url);
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (attempt > retries) throw err;
      const delay = 500 * 2 ** attempt;
      logger.warn({ url, attempt, delay, err: (err as Error).message }, "fetch failed; retrying");
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
