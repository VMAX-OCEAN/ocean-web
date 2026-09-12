/**
 * INCOIS ERDDAP griddap URL builders — live query APIs, no file downloads.
 * Verified 2026-09-11 against erddap.incois.gov.in (HTTP 200s):
 * - VAM incois_argo_10d_VAM: TEMP/SAL, 24 ZAX 5–2000 m, lon 30.5–119.5,
 *   lat ±29.5, time 2004 → 2026-07-30. ZAX addressed by INDEX (0–23):
 *   [5,10,20,30,50,75,100,125,150,200,250,300,400,500,600,700,
 *    800,900,1000,1200,1400,1600,1800,2000] m.
 * - VAP incois_valueadded_products_datasets: D26/D20/MLD/HTCNT/GEO_U/V,
 *   2D, ends 2019-03-30.
 * - SST NOAA_AVHRR_AMSR_datasets: sst/anom °C, ends 2011-10-04 (demo only).
 * Rules: brackets %5B%5D (raw [] 400s on Tomcat), -k TLS, -L redirects.
 * Card: ocean-docs/docs/data/incois-las.md. License: ERDDAP .das boilerplate
 * (free redistribute, no warranty); holdings tiers govern reuse.
 */

/**
 * Same-origin in dev via vite proxy (/erddap → incois, CORS bypass).
 * Prod (preview/deploy) needs the same rewrite on the host or ocean-api.
 */
const ROOT =
  import.meta.env.DEV
    ? '/erddap/griddap'
    : 'https://erddap.incois.gov.in/erddap/griddap';

export const VAM_ID = 'incois_argo_10d_VAM';
export const VAM_TIME = '2019-03-30T00:00:00Z';
export const VAM_LON = [30.5, 119.5] as const;
export const VAM_LAT = [-29.5, 29.5] as const;
export const FLOATS_ID = 'Indian_ARGO_Floats';

export type Variable = 'TEMP' | 'SAL';

/** 10-day VAM timesteps around Fani (verified 2026-09-11). */
export const VAM_TIMES = [
  '2019-01-30T00:00:00Z',
  '2019-02-10T00:00:00Z',
  '2019-02-20T00:00:00Z',
  '2019-02-28T00:00:00Z',
  '2019-03-10T00:00:00Z',
  '2019-03-20T00:00:00Z',
  '2019-03-30T00:00:00Z',
  '2019-04-10T00:00:00Z',
  '2019-04-20T00:00:00Z',
  '2019-04-30T00:00:00Z',
  '2019-05-10T00:00:00Z',
];

/** Live VAM ZAX axis (m), fetched 2026-09-11 via ?ZAX unconstrained. */
export const VAM_DEPTHS_M = [
  5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500,
  600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000,
];

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const enc = (s: string) => s.replace(/\[/g, '%5B').replace(/\]/g, '%5D');

/** Clamp bbox into VAM coverage; null when fully outside. */
export function clampToVam(b: Bbox): Bbox | null {
  const west = Math.max(b.west, VAM_LON[0]);
  const east = Math.min(b.east, VAM_LON[1]);
  const south = Math.max(b.south, VAM_LAT[0]);
  const north = Math.min(b.north, VAM_LAT[1]);
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

/**
 * Live VAM depth-slice map for a bbox at one ZAX index + variable + time.
 * NOTE: query params are passed to SingleTileImageryProvider as an OBJECT
 * (Cesium parses the URL into queryParameters and re-serializes it, which
 * corrupts the griddap constraint syntax with a stray "="). The object form
 * bypasses URL parsing entirely. Callers: buildErddapTileProvider().
 */
export function vamSliceQuery(
  b: Bbox,
  zaxIndex: number,
  variable: Variable = 'TEMP',
  time = VAM_TIME,
): { baseUrl: string; query: Record<string, string> } {
  const q =
    `${variable}[(${time}):1:(${time})]` +
    `[(${zaxIndex}):1:(${zaxIndex})]` +
    `[(${b.south}):1:(${b.north})]` +
    `[(${b.west}):1:(${b.east})]`;
  return {
    baseUrl: `${ROOT}/${VAM_ID}.png?${enc(q)}`,
    query: {
      '.draw': 'surface',
      '.vars': `longitude|latitude|${variable}`,
    },
  };
}

/**
 * Fetch an ERDDAP .png through the same-origin proxy → blob object URL.
 * Cesium parses ANY string URL into queryParameters and re-serializes it,
 * which corrupts the keyless griddap constraint (appends "=undefined" →
 * Tomcat/ERDDAP 400). A blob URL has no query string, so nothing to mangle.
 */
export async function erddapPngObjectUrl(
  relativePngUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(relativePngUrl, { signal });
  if (!res.ok) throw new Error(`ERDDAP PNG HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/** Legacy string form — fetch() only (Cesium mangles it, do not pass there). */
export function vamSlicePng(
  b: Bbox,
  zaxIndex: number,
  variable: Variable = 'TEMP',
  time = VAM_TIME,
): string {
  const { baseUrl, query } = vamSliceQuery(b, zaxIndex, variable, time);
  return `${baseUrl}&.draw=${query['.draw']}&.vars=${encodeURIComponent(query['.vars'])}`;
}

/** Live VAM point value (TEMP degs °C / SAL PSU, _FillValue -9999). */
export function vamPointCsv(
  lat: number,
  lon: number,
  zaxIndex: number,
  variable: Variable = 'TEMP',
  time = VAM_TIME,
): string {
  const q =
    `${variable}[(${time}):1:(${time})]` +
    `[(${zaxIndex}):1:(${zaxIndex})]` +
    `[(${lat}):1:(${lat})]` +
    `[(${lon}):1:(${lon})]`;
  return `${ROOT}/${VAM_ID}.csv?${enc(q)}`;
}

/**
 * Live VAM depth profile at one point (all 24 ZAX, single time + variable).
 * ZAX constrained by VALUE range (5–2000 m), not index — griddap matches
 * axis values, so (0):(23) would return only 5/10/20 m.
 */
export function vamProfileCsv(
  lat: number,
  lon: number,
  variable: Variable = 'TEMP',
  time = VAM_TIME,
): string {
  const q =
    `${variable}[(${time}):1:(${time})]` +
    `[(5.0):1:(2000.0)]` +
    `[(${lat}):1:(${lat})]` +
    `[(${lon}):1:(${lon})]`;
  return `${ROOT}/${VAM_ID}.csv?${enc(q)}`;
}

const TROOT = import.meta.env.DEV
  ? '/erddap/tabledap'
  : 'https://erddap.incois.gov.in/erddap/tabledap';

/**
 * Live Argo float surface points in bbox+month (tabledap, QC flag included).
 * PRES<6m keeps one marker per profile (~16 KB/month Fani box, 200).
 * orderBy(time) has no server cap — the PRES filter is the cap.
 */
export function floatsCsv(b: Bbox, start: string, end: string): string {
  const q =
    `${FLOATS_ID}.csv?PLATFORM_NUMBER,latitude,longitude,time,TEMP,PSAL,PRES,TEMP_QC` +
    `&time%3E=${start}&time%3C=${end}` +
    `&latitude%3E=${b.south}&latitude%3C=${b.north}` +
    `&longitude%3E=${b.west}&longitude%3C=${b.east}` +
    `&PRES%3C=6.0&orderBy(%22time%22)`;
  return `${TROOT}/${q}`;
}
