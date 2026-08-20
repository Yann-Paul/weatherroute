// Silent "last viewed" mirror of a job's results, keyed by jobId.
//
// Unlike savedRoutesDb.ts (an explicit user "save this route" action), this
// cache is written automatically every time a results page successfully
// loads, with no user action. Its only purpose is so that page keeps working
// after a full reload with no network — e.g. the browser tab gets restored,
// or the page is force-refreshed, mid-ride with no signal. Route/planner
// pages fall back to it when the network fetch fails or the browser is
// already known to be offline.

import { withStore, STORE_RESULTS_CACHE } from "@/lib/idb";

export type CachedJobKind = "route" | "gpx" | "destination";

interface CachedJobResult<T> {
  jobId: string;
  kind: CachedJobKind;
  data: T;
  cachedAt: string;
}

export async function cacheJobResult<T>(jobId: string, kind: CachedJobKind, data: T): Promise<void> {
  await withStore(STORE_RESULTS_CACHE, "readwrite", (store) =>
    store.put({ jobId, kind, data, cachedAt: new Date().toISOString() })
  );
}

export async function getCachedJobResult<T>(
  jobId: string,
  kind: CachedJobKind
): Promise<CachedJobResult<T> | undefined> {
  const entry = await withStore<CachedJobResult<T> | undefined>(STORE_RESULTS_CACHE, "readonly", (store) =>
    store.get(jobId)
  );
  return entry && entry.kind === kind ? entry : undefined;
}
