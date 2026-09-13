import * as Cesium from 'cesium';

/**
 * Argo float markers: local CSV data (pre-fetched from INCOIS ERDDAP).
 * No network at runtime — data is bundled in public/data/floats.csv.
 * QC flag carried per point; residual gated until a model value exists.
 */

export interface FloatPoint {
  platform: string;
  lat: number;
  lon: number;
  time: string;
  tempC: number | null;
  psal: number | null;
  pres: number | null;
  qc: string;
}

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const TAG = 'argo-float';
const FLOATS_CSV = '/data/floats.csv';

export function clearFloats(viewer: Cesium.Viewer): void {
  const stale = viewer.entities.values.filter((e) =>
    e.id?.toString().startsWith(`${TAG}:`),
  );
  for (const e of stale) viewer.entities.remove(e);
}

let cachedFloats: FloatPoint[] | null = null;

async function fetchFloats(): Promise<FloatPoint[]> {
  if (cachedFloats) return cachedFloats;
  const res = await fetch(FLOATS_CSV);
  if (!res.ok) throw new Error(`Floats HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split('\n');
  cachedFloats = lines.slice(2).map((line) => {
    const [platform, lat, lon, time, temp, psal, pres, qc] = line.split(',');
    const num = (s: string) => {
      const v = Number(s);
      return s === '' || Number.isNaN(v) ? null : v;
    };
    return {
      platform,
      lat: Number(lat),
      lon: Number(lon),
      time,
      tempC: num(temp),
      psal: num(psal),
      pres: num(pres),
      qc: qc ?? '',
    };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  return cachedFloats;
}

/** Plot float markers from local CSV. Caps at 500 for performance. */
export async function showFloats(
  viewer: Cesium.Viewer,
  _b: Bbox,
  _start: string,
  _end: string,
  _onPick: (p: FloatPoint) => void,
): Promise<{ count: number; error: string | null }> {
  clearFloats(viewer);
  try {
    const all = await fetchFloats();
    // Cap at 500 — take every Nth float for even geographic distribution.
    const MAX = 500;
    const step = Math.max(1, Math.floor(all.length / MAX));
    const pts = all.filter((_, i) => i % step === 0).slice(0, MAX);
    for (const p of pts) {
      viewer.entities.add({
        id: `${TAG}:${p.platform}-${p.time}`,
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 3000),
        point: {
          pixelSize: 8,
          color: p.qc === '1' ? Cesium.Color.LIME : Cesium.Color.ORANGE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
        },
        properties: { float: JSON.stringify(p) },
      });
    }
    return { count: pts.length, error: null };
  } catch (e) {
    return { count: 0, error: e instanceof Error ? e.message : 'Floats failed.' };
  }
}
