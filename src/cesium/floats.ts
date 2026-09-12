import * as Cesium from 'cesium';
import { floatsCsv, type Bbox } from './erddap';

/**
 * Argo float markers: live tabledap points in bbox+month.
 * QC flag carried per point; residual gated (model − obs) until a model
 * value exists at the same cell — panel shows both, never a bare diff.
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

const TAG = 'argo-float';

export function clearFloats(viewer: Cesium.Viewer): void {
  const stale = viewer.entities.values.filter((e) =>
    e.id?.toString().startsWith(`${TAG}:`),
  );
  for (const e of stale) viewer.entities.remove(e);
}

async function fetchFloats(b: Bbox, start: string, end: string): Promise<FloatPoint[]> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(floatsCsv(b, start, end), { signal: ctl.signal });
    if (!res.ok) throw new Error(`Floats HTTP ${res.status}`);
    const lines = (await res.text()).trim().split('\n');
    return lines.slice(2).map((line) => {
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
  } finally {
    window.clearTimeout(t);
  }
}

/** Plot float markers (cap 500, tabledap pageSize). Returns count + error. */
export async function showFloats(
  viewer: Cesium.Viewer,
  b: Bbox,
  start: string,
  end: string,
  onPick: (p: FloatPoint) => void,
): Promise<{ count: number; error: string | null }> {
  clearFloats(viewer);
  try {
    const pts = await fetchFloats(b, start, end);
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
    // One shared click handler per show call would stack — store picker on viewer.
    const anyViewer = viewer as unknown as { __floatPick?: (p: FloatPoint) => void };
    anyViewer.__floatPick = onPick;
    return { count: pts.length, error: null };
  } catch (e) {
    return { count: 0, error: e instanceof Error ? e.message : 'Floats failed.' };
  }
}
