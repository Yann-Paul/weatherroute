// Shared IndexedDB connection for the app's offline-persisted data.
//
// Two stores live in the same "weatherroute" database: "savedRoutes" (an
// explicit user "save this route" action, see savedRoutesDb.ts) and
// "resultsCache" (a silent last-viewed mirror so a results page keeps
// working after a full reload with no network, see resultsCacheDb.ts).
//
// Both stores must be created from this single onupgradeneeded handler —
// IndexedDB only fires that handler when the requested version is greater
// than the database's current version, so two modules independently calling
// `indexedDB.open("weatherroute", 1)` would race: whichever opens first
// creates its store, and the second would see the DB already at version 1
// and never get a chance to create its own.

const DB_NAME = "weatherroute";
const DB_VERSION = 2;

export const STORE_SAVED_ROUTES = "savedRoutes";
export const STORE_RESULTS_CACHE = "resultsCache";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SAVED_ROUTES)) {
          db.createObjectStore(STORE_SAVED_ROUTES, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_RESULTS_CACHE)) {
          db.createObjectStore(STORE_RESULTS_CACHE, { keyPath: "jobId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = run(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
