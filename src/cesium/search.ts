import * as Cesium from 'cesium';
import { showBboxVolume, clearLocationVolume } from './presets';
import { clearDepthLayers } from './depth-layers';

/**
 * Any-area search: free-text (Nominatim bbox) + draw-rectangle.
 * Scope rule: bbox required before any fetch. Empty bbox = blocked
 * message, never a blank fetch. Presets stay as offline fallback buttons.
 * Nominatim usage policy: User-Agent required, 1 req/s, ODbL attribution.
 * Docs: 04-google-earth-fly-to.md (presets-first), 06 toggle (bbox, not point).
 */

export interface SearchBbox {
  west: number;
  south: number;
  east: number;
  north: number;
  label: string;
}

interface NominatimHit {
  boundingbox: [string, string, string, string]; // south, north, west, east
  display_name: string;
}

const UA = 'SIH-OCEAN-hackathon';

/** Free-text → bbox via Nominatim. Throws on empty/invalid. */
export async function searchBbox(query: string): Promise<SearchBbox> {
  const q = query.trim();
  if (!q) throw new Error('Type a place name first.');
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status}). Try a preset.`);
  const hits = (await res.json()) as NominatimHit[];
  if (!hits.length) throw new Error(`No match for "${q}". Try a preset or draw a box.`);
  const [south, north, west, east] = hits[0].boundingbox.map(Number);
  if (![south, north, west, east].every(Number.isFinite) || west >= east || south >= north) {
    throw new Error(`Bad bbox for "${q}". Try a preset or draw a box.`);
  }
  return { west, south, east, north, label: hits[0].display_name.split(',')[0] };
}

/** Fly camera to a bbox (same cinematic path as presets). */
export function flyToBbox(viewer: Cesium.Viewer, b: SearchBbox): void {
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north),
    duration: 2.5,
  });
}

/** Render live volume for any bbox (search/draw share preset path). */
export function showSearchVolume(viewer: Cesium.Viewer, b: SearchBbox): void {
  showBboxVolume(viewer, `search-${Date.now()}`, b.label, 'Custom search', b);
}

export { clearLocationVolume, clearDepthLayers };

void UA;
