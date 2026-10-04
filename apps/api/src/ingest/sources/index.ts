import type { RecallSource } from "@recall/shared";
import { env, openFdaEndpoints } from "../../config/env.js";
import { fetchJson } from "../../lib/http.js";
import { fixtureFetcher } from "../fixtureLoader.js";
import type { SourceAdapter } from "../types.js";
import { CpscAdapter } from "./cpsc.js";
import { FdaAdapter } from "./fda.js";
import { FsisAdapter } from "./fsis.js";

export type Fetcher = <T>(url: string) => Promise<T>;

export function defaultFetcher(): Fetcher {
  return env().INGEST_USE_FIXTURES ? fixtureFetcher : (url) => fetchJson(url);
}

export function buildAdapter(source: RecallSource, fetcher: Fetcher = defaultFetcher()): SourceAdapter {
  switch (source) {
    case "FDA":
      return new FdaAdapter(openFdaEndpoints(), fetcher);
    case "FSIS":
      return new FsisAdapter(fetcher);
    case "CPSC":
      return new CpscAdapter(fetcher);
  }
}

export const ALL_SOURCES: RecallSource[] = ["FDA", "FSIS", "CPSC"];
