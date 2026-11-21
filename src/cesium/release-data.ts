/**
 * Release data loader — downloads dataset ZIPs from GitHub Releases,
 * extracts individual .bin files client-side, and caches them in memory.
 *
 * This replaces direct file fetching from public/data/ so the app works
 * for anyone who clones the repo without needing the 1.3GB of local data.
 *
 * Data flow:
 *   1. App requests /release-data/sst/sst_t0000.bin
 *   2. Loader maps dataset ID → ZIP URL on GitHub Releases
 *   3. Downloads the ZIP (cached after first download)
 *   4. Extracts the .bin file using fflate
 *   5. Returns Float32Array
 *
 * The Vercel rewrite (vercel.json) maps /release-data/* to:
 *   https://github.com/VMAX-OCEAN/ocean-web/releases/download/data-v1/*
 *
 * For local dev, vite.config.ts proxies /release-data/ to the same URL.
 */

import { unzipSync } from 'fflate';
import { ensureCacheVersion, idbGet, idbSetMany } from './idb-cache';

/** GitHub Releases base URL for data assets (documentation only).
 *  In production, Vercel rewrites /release-data/* to this URL (vercel.json).
 *  In dev, vite.config.ts proxies /release-data/* to this URL.
 *  IMPORTANT: Always fetch via the same-origin /release-data/ path so the
 *  proxy/rewrite adds CORS headers. Fetching github.com directly is blocked
 *  by CORS (GitHub Releases does not send Access-Control-Allow-Origin). */
const PROXY_PREFIX = '/release-data';

/** Map dataset ID → ZIP filename on the release. */
const DATASET_ZIPS: Record<string, string> = {
  sst: 'sst-data.zip',
  mhw: 'mhw-data.zip',
  ph_surface: 'ph-data.zip',
  ph_trend: 'ph-data.zip',
  sea_level: 'sea-level-data.zip',
  sea_ice_arctic: 'sea-ice-data.zip',
  sea_ice_antarctic: 'sea-ice-data.zip',
  vam: 'vam-data.zip', // may not exist on release — will 404 gracefully
};

/** In-memory cache: ZIP name → Map<filename, Uint8Array>.
 *  Keyed by ZIP name (not dataset ID) so datasets sharing a ZIP
 *  (e.g. arctic + antarctic sea ice both use sea-ice-data.zip)
 *  download it only once. */
const zipCache = new Map<string, Map<string, Uint8Array>>();

/** Track which ZIPs are currently being downloaded (avoid duplicate fetches). */
const pendingDownloads = new Map<string, Promise<Map<string, Uint8Array>>>();

/** Download queue — only 1 ZIP downloads at a time to avoid overwhelming
 *  the browser with multiple 100MB+ concurrent downloads. */
const downloadQueue: Array<() => void> = [];
let activeDownloads = 0;
const MAX_CONCURRENT_DOWNLOADS = 1;

/** Enqueue a download task. Resolves when it's this task's turn to run. */
function enqueueDownload(): Promise<void> {
  if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
    activeDownloads++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    downloadQueue.push(() => {
      activeDownloads++;
      resolve();
    });
  });
}

/** Mark a download as complete and start the next queued one. */
function dequeueDownload(): void {
  activeDownloads--;
  const next = downloadQueue.shift();
  if (next) next();
}

/**
 * Download and extract a dataset ZIP from GitHub Releases.
 * Caches the extracted files in memory (keyed by ZIP name).
 */
async function loadDatasetZip(datasetId: string): Promise<Map<string, Uint8Array>> {
  const zipName = DATASET_ZIPS[datasetId];
  if (!zipName) throw new Error(`No ZIP mapping for dataset: ${datasetId}`);

  // Return cached if already loaded in memory
  const cached = zipCache.get(zipName);
  if (cached) return cached;

  // Return pending promise if download is in progress
  const pending = pendingDownloads.get(zipName);
  if (pending) return pending;

  // Use the same-origin proxy path so the Vite dev proxy or Vercel rewrite
  // forwards to GitHub Releases with proper CORS handling.
  const url = `${PROXY_PREFIX}/${zipName}`;

  const downloadPromise = (async () => {
    // Wait in the download queue — only 1 ZIP downloads at a time.
    await enqueueDownload();
    try {
      console.log(`[release-data] Downloading ${zipName}...`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download ${zipName}: HTTP ${response.status}`);
      }
      const zipBuffer = new Uint8Array(await response.arrayBuffer());
      console.log(`[release-data] Extracting ${zipName} (${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB)...`);

      const extracted = unzipSync(zipBuffer);
      const fileMap = new Map<string, Uint8Array>();

      // Collect entries for IndexedDB batch write (only .bin files)
      const idbEntries: Array<[string, Uint8Array]> = [];

      for (const [path, data] of Object.entries(extracted)) {
        // Store by both full path and basename for flexible lookup
        fileMap.set(path, data);
        const basename = path.split('/').pop() ?? path;
        fileMap.set(basename, data);
        // Persist .bin files to IndexedDB for repeat visits
        if (basename.endsWith('.bin')) {
          idbEntries.push([basename, data]);
        }
      }

      // Write all .bin files to IndexedDB in a single transaction
      if (idbEntries.length > 0) {
        idbSetMany(idbEntries).catch(() => {
          // Silently ignore — in-memory cache still works
        });
      }

      console.log(`[release-data] ${zipName}: ${fileMap.size} files extracted, ${idbEntries.length} cached in IndexedDB`);
      zipCache.set(zipName, fileMap);
      return fileMap;
    } finally {
      pendingDownloads.delete(zipName);
      dequeueDownload();
    }
  })();

  pendingDownloads.set(zipName, downloadPromise);
  return downloadPromise;
}

/**
 * Map a /release-data/ path to a dataset ID.
 * Examples:
 *   /release-data/sst/sst_t0000.bin → sst
 *   /release-data/sea-ice/ice_arctic_t0000.bin → sea_ice_arctic
 *   /release-data/ph/ph_surface_t0000.bin → ph_surface
 *   /release-data/ph/ph_trend_t0000.bin → ph_trend
 */
function pathToDatasetId(path: string): string {
  // Remove leading /release-data/ if present
  const clean = path.replace(/^\/release-data\//, '');
  const parts = clean.split('/');

  // Map directory name → dataset ID
  const dir = parts[0] ?? '';
  const filename = parts[parts.length - 1] ?? '';

  // Direct match: directory is the dataset ID
  if (DATASET_ZIPS[dir]) return dir;

  // Map directory names to dataset IDs
  const dirMap: Record<string, string> = {
    'sst': 'sst',
    'mhw': 'mhw',
    'ph': filename.startsWith('ph_trend') ? 'ph_trend' : 'ph_surface',
    'sea-level': 'sea_level',
    'sea-ice': filename.startsWith('ice_arctic') ? 'sea_ice_arctic' : 'sea_ice_antarctic',
    'vam': 'vam',
  };

  return dirMap[dir] ?? dir;
}

/**
 * Fetch a .bin file from GitHub Releases via ZIP extraction.
 * Returns a Float32Array.
 *
 * @param path Full path like '/release-data/sst/sst_t0000.bin'
 */
export async function fetchReleaseBin(path: string): Promise<Float32Array> {
  const clean = path.replace(/^\/release-data\//, '');
  const filename = clean.split('/').pop() ?? clean;
  const datasetId = pathToDatasetId(path);

  // 1. Check in-memory ZIP cache first (fastest)
  const memCached = zipCache.get(DATASET_ZIPS[datasetId] ?? '');
  if (memCached) {
    const data = memCached.get(filename) ?? memCached.get(clean);
    if (data) {
      return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    }
  }

  // 2. Check IndexedDB persistent cache (instant on repeat visits)
  const idbData = await idbGet(filename);
  if (idbData) {
    // Also populate in-memory cache for this file
    const zipName = DATASET_ZIPS[datasetId];
    if (zipName) {
      let fileMap = zipCache.get(zipName);
      if (!fileMap) {
        fileMap = new Map();
        zipCache.set(zipName, fileMap);
      }
      fileMap.set(filename, idbData);
    }
    return new Float32Array(idbData.buffer, idbData.byteOffset, idbData.byteLength / 4);
  }

  // 3. Download the ZIP from GitHub Releases (first visit)
  const fileMap = await loadDatasetZip(datasetId);

  // Try basename first, then full path
  const data = fileMap.get(filename) ?? fileMap.get(clean);
  if (!data) {
    throw new Error(`File ${filename} not found in ${DATASET_ZIPS[datasetId]}`);
  }

  return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
}

/**
 * Fetch a raw file (Uint8Array) from a release-data path.
 * Works for any file type (.bin, .json, etc.) inside the ZIP.
 * Used by release-json.ts to fetch pre-aggregated time series JSON.
 */
export async function fetchReleaseRaw(path: string): Promise<Uint8Array | null> {
  const clean = path.replace(/^\/release-data\//, '');
  const filename = clean.split('/').pop() ?? clean;
  const datasetId = pathToDatasetId(path);

  // 1. Check in-memory ZIP cache first
  const memCached = zipCache.get(DATASET_ZIPS[datasetId] ?? '');
  if (memCached) {
    const data = memCached.get(filename) ?? memCached.get(clean);
    if (data) return data;
  }

  // 2. Check IndexedDB (only for .bin files, not .json)
  if (filename.endsWith('.bin')) {
    const idbData = await idbGet(filename);
    if (idbData) {
      const zipName = DATASET_ZIPS[datasetId];
      if (zipName) {
        let fileMap = zipCache.get(zipName);
        if (!fileMap) {
          fileMap = new Map();
          zipCache.set(zipName, fileMap);
        }
        fileMap.set(filename, idbData);
      }
      return idbData;
    }
  }

  // 3. Download the ZIP from GitHub Releases
  try {
    const fileMap = await loadDatasetZip(datasetId);
    const data = fileMap.get(filename) ?? fileMap.get(clean);
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if a path is a release-data path.
 */
export function isReleaseDataPath(path: string): boolean {
  return path.startsWith('/release-data/');
}

// Initialize IndexedDB cache version check on module load.
// This purges stale entries if the data version has changed.
ensureCacheVersion().catch(() => {
  // Silently ignore — in-memory cache still works
});

/**
 * Preload a dataset ZIP (useful for preloading on app start).
 */
export async function preloadDataset(datasetId: string): Promise<void> {
  try {
    await loadDatasetZip(datasetId);
  } catch (err) {
    console.warn(`[release-data] Failed to preload ${datasetId}:`, err);
  }
}
