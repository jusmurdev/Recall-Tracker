import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Recorded open-data responses so grade sync runs offline (tests, INGEST_USE_FIXTURES=1). */
export async function inspectionFixtureFetcher<T>(url: string): Promise<T> {
  const u = new URL(url);
  const file = u.hostname === "data.cityofnewyork.us" ? "nyc.json" : u.hostname === "data.cityofchicago.org" ? "chicago.json" : null;
  if (!file) throw new Error(`No inspection fixture for ${url}`);
  return JSON.parse(await readFile(path.join(here, "fixtures", file), "utf8")) as T;
}
