/**
 * Data adapter — aggregates spatial binary data into 1D time series.
 *
 * Raw data: .bin files (Float32Array, row-major, south-to-north)
 *           Each file = one time step × spatial grid (lat × lon)
 *
 * Aggregation methods:
 *   mean       → area-weighted (cos lat) global mean
 *   extent     → sum of cell areas where value > threshold (million km²)
 *   percentage → % of valid cells where value > 0
 *
 * The adapter caches aggregated values per (dataset, variable) to avoid
 * re-fetching .bin files on every chart interaction.
 */

import { DATASETS, buildBinPath } from '../cesium/datasets';
import { fetchBinData } from '../cesium/binary-data';
import type { VariableConfig, VariableId, TimeSeriesPoint } from './types';

/** Earth radius in km. */
const R_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;

/** Cache: key = `${datasetId}:${variableId}`, value = TimeSeriesPoint[] */
const seriesCache = new Map<string, TimeSeriesPoint[]>();

/**
 * Compute cell area (km²) for each row of a regular lat-lon grid.
 * Grid is south-to-north (row 0 = southernmost).
 */
function computeCellAreas(
  south: number,
  north: number,
  west: number,
  east: number,
  height: number,
  width: number,
): Float64Array {
  const dlatDeg = (north - south) / height;
  const dlonDeg = (east - west) / width;
  const areas = new Float64Array(height);

  for (let row = 0; row < height; row++) {
    const lat1 = south + row * dlatDeg;
    const lat2 = lat1 + dlatDeg;
    // Spherical Earth area: R² × dlon_rad × (sin(lat2) − sin(lat1))
    const dlonRad = dlonDeg * DEG_TO_RAD;
    const sinDiff = Math.sin(lat2 * DEG_TO_RAD) - Math.sin(lat1 * DEG_TO_RAD);
    areas[row] = R_KM * R_KM * dlonRad * sinDiff;
  }
  return areas;
}

/**
 * Aggregate a spatial grid (Float32Array) into a single scalar.
 *
 * @param data    Row-major Float32Array, south-to-north
 * @param width   Grid width (lon count)
 * @param height  Grid height (lat count)
 * @param south   Southern latitude
 * @param north   Northern latitude
 * @param config  Variable config (aggregation method, threshold, etc.)
 */
function aggregateGrid(
  data: Float32Array,
  width: number,
  height: number,
  south: number,
  north: number,
  west: number,
  east: number,
  config: VariableConfig,
): number {
  const cellAreas = computeCellAreas(south, north, west, east, height, width);

  if (config.aggregation === 'extent') {
    // Sea ice extent: sum cell areas where concentration > threshold
    let totalArea = 0;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const v = data[row * width + col];
        if (Number.isFinite(v) && v > (config.extentThreshold ?? 0.15)) {
          totalArea += cellAreas[row];
        }
      }
    }
    // Convert km² to million km²
    return totalArea / 1e6;
  }

  if (config.aggregation === 'percentage') {
    // MHW: % of valid ocean cells experiencing heat wave (value > 0)
    let heatWaveCount = 0;
    let validCount = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (Number.isFinite(v)) {
        validCount++;
        if (v > 0) heatWaveCount++;
      }
    }
    return validCount > 0 ? (heatWaveCount / validCount) * 100 : 0;
  }

  // Default: area-weighted mean
  if (config.areaWeighted) {
    let weightedSum = 0;
    let weightSum = 0;
    for (let row = 0; row < height; row++) {
      const weight = cellAreas[row]; // already includes cos(lat) factor
      for (let col = 0; col < width; col++) {
        const v = data[row * width + col];
        if (Number.isFinite(v)) {
          weightedSum += v * weight;
          weightSum += weight;
        }
      }
    }
    return weightSum > 0 ? weightedSum / weightSum : NaN;
  }

  // Simple mean
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (Number.isFinite(v)) {
      sum += v;
      count++;
    }
  }
  return count > 0 ? sum / count : NaN;
}

/**
 * Get the full time series for a variable (all time steps).
 * Cached per (datasetId, variableId).
 */
export async function getFullTimeSeries(
  _variableId: VariableId,
  config: VariableConfig,
): Promise<TimeSeriesPoint[]> {
  const cacheKey = `${config.datasetId}:${config.datasetVariableId}`;
  const cached = seriesCache.get(cacheKey);
  if (cached) return cached;

  const dataset = DATASETS[config.datasetId];
  if (!dataset) throw new Error(`Dataset not found: ${config.datasetId}`);

  const { width, height } = dataset.grid;
  const { west, south, east, north } = dataset.bbox;
  const times = dataset.times;
  const points: TimeSeriesPoint[] = [];

  // Fetch all time steps and aggregate
  for (let t = 0; t < times.length; t++) {
    const binPath = buildBinPath(dataset, config.datasetVariableId, 0, t);
    try {
      const data = await fetchBinData(binPath);
      const value = aggregateGrid(data, width, height, south, north, west, east, config);
      const dateStr = times[t];
      const date = new Date(dateStr);
      points.push({
        date: dateStr,
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        value,
      });
    } catch {
      // Skip failed fetches
      points.push({ date: times[t], year: 0, month: 0, value: NaN });
    }
  }

  seriesCache.set(cacheKey, points);
  return points;
}

/**
 * Compute the reference (climatology) time series.
 * For seasonal charts: average of reference years per month.
 * For trend charts: overall mean.
 */
export function computeReferenceSeries(
  fullSeries: TimeSeriesPoint[],
  config: VariableConfig,
): TimeSeriesPoint[] {
  if (config.chartType === 'seasonal') {
    // Average per month across reference years
    const monthlyAvg: Record<number, number[]> = {};
    for (const p of fullSeries) {
      if (config.referenceYears.includes(p.year) && Number.isFinite(p.value)) {
        if (!monthlyAvg[p.month]) monthlyAvg[p.month] = [];
        monthlyAvg[p.month].push(p.value);
      }
    }
    const refPoints: TimeSeriesPoint[] = [];
    for (let m = 1; m <= 12; m++) {
      const vals = monthlyAvg[m] ?? [];
      const mean = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
      refPoints.push({ date: `ref-${m}`, year: -1, month: m, value: mean });
    }
    return refPoints;
  }
  // Trend: overall mean of reference period
  const refVals = fullSeries.filter(p =>
    config.referenceYears.includes(p.year) && Number.isFinite(p.value),
  );
  const mean = refVals.length > 0
    ? refVals.reduce((a, b) => a + b.value, 0) / refVals.length
    : NaN;
  return [{ date: 'ref', year: -1, month: 0, value: mean }];
}

/**
 * Filter the full time series for specific years.
 * Used for year comparison in seasonal charts.
 */
export function filterByYear(
  fullSeries: TimeSeriesPoint[],
  year: number,
): TimeSeriesPoint[] {
  return fullSeries.filter(p => p.year === year && Number.isFinite(p.value));
}

/**
 * Aggregate monthly data to annual means.
 */
export function toAnnual(fullSeries: TimeSeriesPoint[]): TimeSeriesPoint[] {
  const byYear: Record<number, number[]> = {};
  for (const p of fullSeries) {
    if (Number.isFinite(p.value)) {
      if (!byYear[p.year]) byYear[p.year] = [];
      byYear[p.year].push(p.value);
    }
  }
  const result: TimeSeriesPoint[] = [];
  for (const year of Object.keys(byYear).map(Number).sort((a, b) => a - b)) {
    const vals = byYear[year];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    result.push({ date: `${year}-01-01T00:00:00Z`, year, month: 0, value: mean });
  }
  return result;
}

/**
 * Convert absolute values to anomalies (subtract reference climatology).
 */
export function toAnomalies(
  fullSeries: TimeSeriesPoint[],
  config: VariableConfig,
): TimeSeriesPoint[] {
  // Compute monthly climatology from reference years
  const monthlyClim: Record<number, number[]> = {};
  for (const p of fullSeries) {
    if (config.referenceYears.includes(p.year) && Number.isFinite(p.value)) {
      if (!monthlyClim[p.month]) monthlyClim[p.month] = [];
      monthlyClim[p.month].push(p.value);
    }
  }
  const climMean: Record<number, number> = {};
  for (const m of Object.keys(monthlyClim)) {
    const vals = monthlyClim[Number(m)];
    climMean[Number(m)] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  return fullSeries.map(p => ({
    ...p,
    value: Number.isFinite(p.value) && climMean[p.month] != null
      ? p.value - climMean[p.month]
      : NaN,
  }));
}

/**
 * Get the latest value from a time series (for the summary metric).
 */
export function getLatestValue(fullSeries: TimeSeriesPoint[]): TimeSeriesPoint | null {
  const valid = fullSeries.filter(p => Number.isFinite(p.value));
  if (valid.length === 0) return null;
  return valid[valid.length - 1];
}

/**
 * Compute a simple linear trend (slope) for the time series.
 * Returns slope per year.
 */
export function computeTrend(fullSeries: TimeSeriesPoint[]): { slope: number; r2: number } {
  const valid = fullSeries.filter(p => Number.isFinite(p.value));
  if (valid.length < 2) return { slope: 0, r2: 0 };

  // x = index (proxy for time), y = value
  const n = valid.length;
  const xs = valid.map((_, i) => i);
  const ys = valid.map(p => p.value);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    const dy = ys[i] - yMean;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const slope = denX > 0 ? num / denX : 0;
  const r2 = denX > 0 && denY > 0 ? (num * num) / (denX * denY) : 0;

  // Convert slope from per-step to per-year
  // For monthly data, 12 steps per year
  const stepsPerYear = 12;
  return { slope: slope * stepsPerYear, r2 };
}

/** Clear the series cache (e.g., when switching datasets). */
export function clearSeriesCache(): void {
  seriesCache.clear();
}
