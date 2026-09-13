/**
 * Web Worker for parsing large GeoJSON border files off the main thread.
 *
 * The 10m admin-1 states/provinces file is ~21 MB. Parsing JSON on the
 * main thread blocks the UI for 1-3 seconds. This worker fetches and
 * parses the file, then posts the result back as a transferable
 * structured clone.
 *
 * Usage:
 *   const worker = new Worker(new URL('./borders-worker.ts', import.meta.url), { type: 'module' });
 *   worker.postMessage({ path: '/borders/ne_10m_admin_1_states_provinces_lines.geojson' });
 *   worker.onmessage = (e) => { const geojson = e.data.geojson; ... };
 */

export interface WorkerRequest {
  path: string;
}

export interface WorkerResponse {
  geojson: unknown;
  error?: string;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { path } = e.data;
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    // Parse as text first, then JSON.parse — this is slightly faster
    // than response.json() for large payloads because it avoids the
    // internal stream parsing overhead.
    const text = await response.text();
    const geojson = JSON.parse(text);
    (self as unknown as Worker).postMessage({ geojson } satisfies WorkerResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      geojson: null,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
