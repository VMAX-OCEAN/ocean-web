/**
 * IndexedDB persistent cache for extracted .bin files.
 *
 * Stores individual .bin files (as ArrayBuffer) keyed by filename.
 * On page load, the release-data loader checks IndexedDB first before
 * downloading the ZIP from GitHub Releases. This makes repeat visits
 * instant — no network requests at all.
 *
 * Cache versioning: bump CACHE_VERSION when the underlying data changes
 * (e.g. new release uploaded). Old entries are purged on version mismatch.
 */

const DB_NAME = 'ocean-web-data';
const STORE_NAME = 'bin-files';
const CACHE_VERSION = 1;
const META_KEY = '__cache_version__';

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open the IndexedDB database. */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, CACHE_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

/** Check if the cache version matches. If not, purge all entries. */
export async function ensureCacheVersion(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const versionReq = store.get(META_KEY);
    const version = await new Promise<number | undefined>((resolve) => {
      versionReq.onsuccess = () => resolve(versionReq.result as number | undefined);
      versionReq.onerror = () => resolve(undefined);
    });

    if (version !== CACHE_VERSION) {
      // Version mismatch — clear the store and write the new version
      store.clear();
      store.put(CACHE_VERSION, META_KEY);
    }
  } catch {
    // IndexedDB might be unavailable (private browsing, quota, etc.)
    // Silently fall back to in-memory only caching.
  }
}

/** Store a .bin file in IndexedDB. */
export async function idbSet(key: string, data: Uint8Array): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    // Store a copy of the data (ArrayBuffer) so it persists
    store.put(data.buffer.slice(0), key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Silently ignore — in-memory cache still works
  }
}

/** Retrieve a .bin file from IndexedDB. Returns null if not found. */
export async function idbGet(key: string): Promise<Uint8Array | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const result = await new Promise<ArrayBuffer | undefined>((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
      req.onerror = () => resolve(undefined);
    });
    if (!result) return null;
    return new Uint8Array(result);
  } catch {
    return null;
  }
}

/** Store multiple .bin files in a single transaction (faster). */
export async function idbSetMany(entries: Array<[string, Uint8Array]>): Promise<void> {
  if (entries.length === 0) return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const [key, data] of entries) {
      store.put(data.buffer.slice(0), key);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Silently ignore
  }
}

/** Check if a key exists in IndexedDB. */
export async function idbHas(key: string): Promise<boolean> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const count = await new Promise<number>((resolve) => {
      const req = store.count(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
    return count > 0;
  } catch {
    return false;
  }
}
