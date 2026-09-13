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

/** GitHub Releases base URL for data assets. */
const RELEASE_BASE = 'https://github.com/VMAX-OCEAN/ocean-web/releases/download/data-v1';

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

/** In-memory cache: dataset ID → Map<filename, Uint8Array>. */
const datasetCache = new Map<string, Map<string, Uint8Array>>();

/** Track which ZIPs are currently being downloaded (avoid duplicate fetches). */
const pendingDownloads = new Map<string, Promise<Map<string, Uint8Array>>>();

/**
 * Download and extract a dataset ZIP from GitHub Releases.
 * Caches the extracted files in memory.
 */
async function loadDatasetZip(datasetId: string): Promise<Map<string, Uint8Array>> {
  // Return cached if already loaded
  const cached = datasetCache.get(datasetId);
  if (cached) return cached;

  // Return pending promise if download is in progress
  const pending = pendingDownloads.get(datasetId);
  if (pending) return pending;

  const zipName = DATASET_ZIPS[datasetId];
  if (!zipName) throw new Error(`No ZIP mapping for dataset: ${datasetId}`);

  const url = `${RELEASE_BASE}/${zipName}`;

  const downloadPromise = (async () => {
    console.log(`[release-data] Downloading ${zipName}...`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${zipName}: HTTP ${response.status}`);
    }
    const zipBuffer = new Uint8Array(await response.arrayBuffer());
    console.log(`[release-data] Extracting ${zipName} (${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB)...`);

    const extracted = unzipSync(zipBuffer);
    const fileMap = new Map<string, Uint8Array>();

    for (const [path, data] of Object.entries(extracted)) {
      // Store by both full path and basename for flexible lookup
      fileMap.set(path, data);
      const basename = path.split('/').pop() ?? path;
      fileMap.set(basename, data);
    }

    console.log(`[release-data] ${zipName}: ${fileMap.size} files extracted`);
    datasetCache.set(datasetId, fileMap);
    pendingDownloads.delete(datasetId);
    return fileMap;
  })();

  pendingDownloads.set(datasetId, downloadPromise);
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

  const fileMap = await loadDatasetZip(datasetId);

  // Try basename first, then full path
  const data = fileMap.get(filename) ?? fileMap.get(clean);
  if (!data) {
    throw new Error(`File ${filename} not found in ${DATASET_ZIPS[datasetId]}`);
  }

  return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
}

/**
 * Check if a path is a release-data path.
 */
export function isReleaseDataPath(path: string): boolean {
  return path.startsWith('/release-data/');
}

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
