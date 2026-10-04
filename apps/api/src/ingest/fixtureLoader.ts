import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Serves recorded API responses from ./fixtures instead of the network. Used by tests and
 * by `INGEST_USE_FIXTURES=1` so the whole pipeline can be exercised in sandboxes that cannot
 * reach the public APIs. The URL → file mapping mirrors the real endpoints.
 */
export async function fixtureFetcher<T>(url: string): Promise<T> {
  const file = fixtureFileFor(url);
  const text = await readFile(path.join(here, "fixtures", file), "utf8");
  return JSON.parse(text) as T;
}

export function fixtureFileFor(url: string): string {
  const u = new URL(url);
  if (u.hostname === "api.fda.gov") {
    const skip = Number(u.searchParams.get("skip") ?? "0");
    if (skip > 0) return "empty-openfda.json";
    if (u.pathname.startsWith("/food/")) return "fda-food.json";
    if (u.pathname.startsWith("/drug/")) return "fda-drug.json";
    if (u.pathname.startsWith("/device/")) return "fda-device.json";
  }
  if (u.hostname === "www.fsis.usda.gov") return "fsis.json";
  if (u.hostname === "www.saferproducts.gov") return "cpsc.json";
  throw new Error(`No fixture for ${url}`);
}
