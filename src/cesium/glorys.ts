import * as zarr from 'zarrita';

/**
 * GLORYS Fani subset — real NetCDF→Zarr, local public store.
 * File: ocean-data/fani-20190502.nc
 * sha256: be8d0770127d003a084b98eb3252a30ce32e3ce0bc2ffe2d2b2689c3d5a09bdf
 * Store: public/zarr/fani-20190502.zarr (v2 consolidated, Blosc zstd-3
 * bitshuffle, chunks (1,8,205,181), 16 chunk files, 6.36 MB total).
 * Grid: time 1 × depth 31 (0.49–453.9 m) × lat 205 × lon 181,
 * Fani box 80–95E/5–22N, 2019-05-02. thetao/uo/vo float64→float32.
 * Surface thetao mean 29.97 °C (27.19–31.99). uo mean 0.11 m/s.
 * Source: GLOBAL_MULTIYEAR_PHY_001_030, DOI 10.48670/moi-00021,
 * E.U. Copernicus Marine Service Information.
 */

export const GLORYS_STORE_URL = './zarr/fani-20190502.zarr';
export const GLORYS_DEPTHS_M = [
  0.494, 1.541, 2.646, 3.819, 5.078, 6.441, 7.93, 9.573, 11.405, 13.467,
  15.81, 18.496, 21.598, 25.202, 29.444, 34.434, 40.344, 47.373, 55.764,
  65.807, 77.853, 92.326, 109.638, 130.215, 154.586, 183.395, 217.359,
  266.04, 318.127, 380.213, 453.938,
];
export const GLORYS_BBOX = { west: 80, south: 5, east: 95, north: 22 };
export const GLORYS_TIME = '2019-05-02';

type Arr = zarr.Array<zarr.DataType, zarr.FetchStore>;

let arrays: Record<string, Arr> | null = null;

async function arraysOnce(): Promise<Record<string, Arr>> {
  if (arrays) return arrays;
  const root = await zarr.open(new zarr.FetchStore(GLORYS_STORE_URL), {
    kind: 'group',
  });
  const out: Record<string, Arr> = {};
  for (const v of ['thetao', 'uo', 'vo']) {
    out[v] = (await zarr.open(root.resolve(v), { kind: 'array' })) as Arr;
  }
  arrays = out;
  return out;
}

/** Nearest depth index for a target meter value. */
export function nearestDepthIndex(depthM: number): number {
  let best = 0;
  for (let i = 1; i < GLORYS_DEPTHS_M.length; i++) {
    if (Math.abs(GLORYS_DEPTHS_M[i] - depthM) < Math.abs(GLORYS_DEPTHS_M[best] - depthM)) {
      best = i;
    }
  }
  return best;
}

/** Decode one GLORYS slice (time 0, depth idx) as Float32Array row-major. */
export async function glorysSlice(
  variable: 'thetao' | 'uo' | 'vo',
  depthIdx: number,
): Promise<{ data: Float32Array; width: number; height: number }> {
  const arrs = await arraysOnce();
  const res = await zarr.get(arrs[variable], [0, depthIdx, null, null]);
  return {
    data: new Float32Array(res.data as ArrayLike<number>),
    width: 181,
    height: 205,
  };
}

/** Decode surface u/v pair for particle advection. */
export async function glorysSurfaceUV(depthIdx = 0): Promise<{
  u: Float32Array;
  v: Float32Array;
  width: number;
  height: number;
}> {
  const [u, v] = await Promise.all([
    glorysSlice('uo', depthIdx),
    glorysSlice('vo', depthIdx),
  ]);
  return { u: u.data, v: v.data, width: u.width, height: u.height };
}

/** Point sample from decoded slice (bilinear off — nearest, documented). */
export function sampleNearest(
  data: Float32Array,
  width: number,
  height: number,
  bbox: { west: number; south: number; east: number; north: number },
  lat: number,
  lon: number,
): number {
  const fx = ((lon - bbox.west) / (bbox.east - bbox.west)) * (width - 1);
  const fy = ((bbox.north - lat) / (bbox.north - bbox.south)) * (height - 1);
  const x = Math.min(width - 1, Math.max(0, Math.round(fx)));
  const y = Math.min(height - 1, Math.max(0, Math.round(fy)));
  return data[y * width + x];
}
