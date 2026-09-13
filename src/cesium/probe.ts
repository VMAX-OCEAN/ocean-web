import {
  getSliceData,
  samplePoint,
  VAM_DEPTHS_M,
  VAM_GRID,
  VAR_RANGES,
  VAM_ID,
  type Variable,
} from './binary-data';

/**
 * Click-to-query: instant point + depth profile from local binary data.
 * No network, no ERDDAP, no CORS. Values match the displayed slice exactly.
 * Every readout carries dataset/var/units/time. NaN = "no data".
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

/** Instant point value from local binary data (no network). */
export async function probePoint(
  lat: number,
  lon: number,
  zaxIndex: number,
  depthM: number,
  variable: Variable,
  time: string,
): Promise<PointReading> {
  const timeIdx = VAM_TIMES_IDX(time);
  const data = await getSliceData(variable, zaxIndex, timeIdx);
  const value = samplePoint(data, VAM_GRID.width, VAM_GRID.height, lat, lon);
  return {
    lat,
    lon,
    depthM,
    zaxIndex,
    variable,
    value,
    units: VAR_RANGES[variable].units,
    time,
    dataset: VAM_ID,
    url: `/data/vam/${variable.toLowerCase()}_d${zaxIndex}_t${timeIdx}.bin`,
  };
}

/** Depth profile at one point — fetches all 24 depth slices in parallel. */
export async function probeProfile(
  lat: number,
  lon: number,
  variable: Variable,
  time: string,
): Promise<ProfileRow[]> {
  const timeIdx = VAM_TIMES_IDX(time);
  const slices = await Promise.all(
    VAM_DEPTHS_M.map((_, depthIdx) => getSliceData(variable, depthIdx, timeIdx)),
  );
  return slices.map((data, depthIdx) => ({
    depthM: VAM_DEPTHS_M[depthIdx],
    value: samplePoint(data, VAM_GRID.width, VAM_GRID.height, lat, lon),
  }));
}

/** VAM_TIMES index lookup (imported from binary-data). */
import { VAM_TIMES } from './binary-data';
function VAM_TIMES_IDX(time: string): number {
  const idx = VAM_TIMES.indexOf(time);
  return idx < 0 ? 6 : idx; // default to 2019-03-30
}
