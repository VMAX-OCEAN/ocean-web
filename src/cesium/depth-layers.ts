import * as Cesium from 'cesium';
import {
  VAM_DEPTHS_M,
  VAM_TIMES,
  VAM_TIME,
  clampToVam,
  vamSlicePng,
  erddapPngObjectUrl,
  type Bbox,
  type Variable,
} from './erddap';

/**
 * Layer-by-layer 4D: single live VAM slice per depth/variable/time.
 * Slider swaps ZAX index, variable toggle swaps TEMP/SAL, time scrub swaps
 * 10-day step — one live slice at a time, never full column.
 * ponytail: swap fetch-blob for ZarrCubeProvider slices when M2 Zarr proven.
 */

export { VAM_DEPTHS_M as DEPTHS_M, VAM_TIMES as TIMES, VAM_TIME as DEFAULT_TIME };

const depthLayersByViewer = new WeakMap<Cesium.Viewer, Cesium.ImageryLayer[]>();
const depthUrlsByViewer = new WeakMap<Cesium.Viewer, string[]>();
let requestSeq = 0;

/** Remove depth slice layer + revoke blob URLs. */
export function clearDepthLayers(viewer: Cesium.Viewer): void {
  const layers = depthLayersByViewer.get(viewer) ?? [];
  for (const l of layers) viewer.imageryLayers.remove(l, true);
  depthLayersByViewer.set(viewer, []);
  for (const u of depthUrlsByViewer.get(viewer) ?? []) URL.revokeObjectURL(u);
  depthUrlsByViewer.set(viewer, []);
  requestSeq++;
}

/** Depth column state for the active bbox (for legend/click readout). */
export interface DepthState {
  bbox: Bbox;
  zaxIndex: number;
  depthM: number;
  variable: Variable;
  time: string;
  url: string;
}

let current: DepthState | null = null;
export function currentDepthState(): DepthState | null {
  return current;
}

/**
 * Show one live depth slice draped on the globe inside bbox.
 * Scope rule: bbox + single ZAX index required, never full column.
 * Outside VAM coverage: clears slice, keeps state null (honest empty).
 * Superseded slider fetches are ignored by sequence guard (no abort needed:
 * completed blobs are revoked on clear).
 */
export function showDepthLayers(
  viewer: Cesium.Viewer,
  west: number,
  south: number,
  east: number,
  north: number,
  activeDepthM: number,
  variable: Variable = 'TEMP',
  time: string = VAM_TIME,
): void {
  clearDepthLayers(viewer);
  current = null;
  const clamped = clampToVam({ west, south, east, north });
  if (!clamped) return;
  const zaxIndex = VAM_DEPTHS_M.indexOf(activeDepthM);
  if (zaxIndex < 0) return;
  const rect = Cesium.Rectangle.fromDegrees(
    clamped.west,
    clamped.south,
    clamped.east,
    clamped.north,
  );
  const url = vamSlicePng(clamped, zaxIndex, variable, time);
  const seq = requestSeq;
  erddapPngObjectUrl(url)
    .then((objUrl) => {
      if (viewer.isDestroyed() || seq !== requestSeq) {
        URL.revokeObjectURL(objUrl);
        return;
      }
      const provider = new Cesium.SingleTileImageryProvider({
        url: objUrl,
        rectangle: rect,
        tileWidth: 1024,
        tileHeight: 1024,
      });
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      depthLayersByViewer.set(viewer, [layer]);
      depthUrlsByViewer.set(viewer, [objUrl]);
    })
    .catch((err) => console.warn('VAM depth slice failed:', err));
  current = { bbox: clamped, zaxIndex, depthM: activeDepthM, variable, time, url };
}

/** Focus camera — kept as no-op anchor for Zarr slice focus later. */
export function focusDepth(viewer: Cesium.Viewer, _depthM: number): void {
  viewer.scene.requestRender();
}
