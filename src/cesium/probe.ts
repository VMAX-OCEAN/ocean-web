import { vamPointCsv, vamProfileCsv, VAM_ID, type Variable } from './erddap';

/**
 * Click-to-query: live VAM point + depth profile via ERDDAP .csv.
 * Every readout carries dataset/var/units/time/source. _FillValue -9999,
 * missing_value, and NaN surface as "no data", never as a number.
 */

export interface PointReading {
  lat: number;
  lon: number;
  depthM: number;
  zaxIndex: number;
  variable: Variable;
  value: number | null;
  units: string;
  time: string;
  dataset: string;
  url: string;
}

export interface ProfileRow {
  depthM: number;
  value: number | null;
}

export const VAR_META: Record<Variable, { units: string; fill: number }> = {
  TEMP: { units: 'degs (°C)', fill: -9999 },
  SAL: { units: 'PSU', fill: -9999 },
};

async function fetchCsv(url: string, timeoutMs = 25000): Promise<string[][]> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`ERDDAP HTTP ${res.status}`);
    return (await res.text())
      .trim()
      .split('\n')
      .map((line) => line.split(','));
  } finally {
    window.clearTimeout(t);
  }
}

function clean(raw: string | undefined, fill: number): number | null {
  if (raw == null || raw === '' || raw === 'NaN') return null;
  const v = Number(raw);
  return Number.isNaN(v) || v === fill ? null : v;
}

/** Live point value at lat/lon/depth/variable/time. */
export async function probePoint(
  lat: number,
  lon: number,
  zaxIndex: number,
  depthM: number,
  variable: Variable,
  time: string,
): Promise<PointReading> {
  const url = vamPointCsv(lat, lon, zaxIndex, variable, time);
  const rows = await fetchCsv(url);
  return {
    lat,
    lon,
    depthM,
    zaxIndex,
    variable,
    value: clean(rows[2]?.[4], VAR_META[variable].fill),
    units: VAR_META[variable].units,
    time,
    dataset: VAM_ID,
    url,
  };
}

/** Live depth profile at lat/lon (24 ZAX, variable + time). */
export async function probeProfile(
  lat: number,
  lon: number,
  variable: Variable,
  time: string,
): Promise<ProfileRow[]> {
  const rows = await fetchCsv(vamProfileCsv(lat, lon, variable, time));
  return rows.slice(2).map((r) => ({
    depthM: Number(r[1]),
    value: clean(r[4], VAR_META[variable].fill),
  }));
}
