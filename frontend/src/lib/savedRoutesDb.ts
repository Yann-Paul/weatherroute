// Saved routes live entirely in the browser's IndexedDB.
//
// They used to be written to a JSON file on the server, but on Render a web
// service's filesystem is ephemeral: it resets on every redeploy and every
// time the instance restarts after being idle (which happens automatically
// after inactivity), so anything saved there was silently lost. Storing the
// route locally instead means it survives exactly as long as the user's
// browser profile does, independent of the backend's lifecycle.
//
// The backend is only involved transiently: `saveRoute()` in api/client.ts
// asks it to bundle a finished job's result into a portable blob, which gets
// written here; `restoreSavedRoute()` reads the blob back out and sends it to
// the backend just long enough to spin up an in-memory job again (and
// refresh the weather forecast).

import type { SavedRoute, SavedRouteSummary } from "@/api/types";

const DB_NAME = "weatherroute";
const DB_VERSION = 1;
const STORE = "savedRoutes";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listSavedRoutes(): Promise<SavedRouteSummary[]> {
  const all = await withStore<SavedRoute[]>("readonly", (store) => store.getAll());
  return all
    .map(({ id, name, savedAt, totalDistance, totalDays, startDay }) => ({
      id,
      name,
      savedAt,
      totalDistance,
      totalDays,
      startDay,
    }))
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export async function getSavedRoute(id: string): Promise<SavedRoute | undefined> {
  return withStore<SavedRoute | undefined>("readonly", (store) => store.get(id));
}

export async function putSavedRoute(route: SavedRoute): Promise<void> {
  await withStore("readwrite", (store) => store.put(route));
}

export async function deleteSavedRoute(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}
