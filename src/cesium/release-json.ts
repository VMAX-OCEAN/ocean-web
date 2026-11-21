/**
 * Fetch JSON files from GitHub Release ZIPs.
 *
 * Used by the timeseries loader to get pre-aggregated time series JSON
 * files that are stored alongside the .bin files in the release ZIPs.
 *
 * Tries local /data/ path first (instant), falls back to release-data
 * (GitHub Releases ZIP extraction) if the local file doesn't exist.
 */

import { fetchReleaseRaw } from './release-data';

/** In-memory cache for JSON files extracted from ZIPs. */
const jsonCache = new Map<string, any>();

/**
 * Fetch a JSON file from a release-data path.
 * The path must be like '/release-data/<dir>/<filename>.json'
 *
 * Tries local /data/ first, then falls back to release-data ZIP extraction.
 */
export async function fetchReleaseJson(path: string): Promise<any | null> {
  const cached = jsonCache.get(path);
  if (cached !== undefined) return cached;

  // Try local /data/ path first (instant — no ZIP download needed)
  const localPath = path.replace(/^\/release-data\//, '/data/');
  try {
    const response = await fetch(localPath);
    if (response.ok) {
      const json = await response.json();
      jsonCache.set(path, json);
      return json;
    }
  } catch {
    // Local fetch failed — fall through to release-data
  }

  // Fall back to GitHub Releases via ZIP extraction
  try {
    const rawData = await fetchReleaseRaw(path);
    if (!rawData) return null;

    const text = new TextDecoder().decode(rawData);
    const json = JSON.parse(text);
    jsonCache.set(path, json);
    return json;
  } catch {
    jsonCache.set(path, null);
    return null;
  }
}
