import * as Cesium from 'cesium';
import {
  VAM_DEPTHS_M,
  VAM_TIMES,
  VAM_BBOX,
  getSliceCanvas,
  fetchSliceCanvasForDataset,
  canvasToBlobUrl,
  type Variable,
} from './binary-data';
import { getDataset } from './datasets';

/**
 * Layer-by-layer 4D: binary ocean data rendered directly on the globe.
 *
 * Data flow: local .bin file → Float32Array → canvas (3-color colormap) →
 * globe texture. No PNG, no JSON, no network at runtime.
 *
 * The canvas is transparent where data is NaN (land/no-data), so the
 * base Esri satellite imagery shows through on land. The data colors
 * appear only on ocean pixels — directly on the globe surface, draped
 * over terrain.
 *
 * Performance: 5-15ms per slice (local fetch + canvas render).
 * With preload cache: ~0ms for cached adjacent slices.
 */

export { VAM_DEPTHS_M as DEPTHS_M, VAM_TIMES as TIMES };
export const DEFAULT_TIME = VAM_TIMES[6]; // 2019-03-30

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

/** Depth column state for the active slice (for legend/click readout). */
export interface DepthState {
  zaxIndex: number;
  depthM: number;
  variable: Variable;
  time: string;
  timeIdx: number;
}

let current: DepthState | null = null;
export function currentDepthState(): DepthState | null {
  return current;
}

/**
 * Show one depth slice directly on the globe (VAM dataset).
 * Data is rendered from local binary files — no network, no PNG, no JSON.
 * The canvas is transparent where data is NaN, so land keeps satellite imagery.
 */
export async function showDepthLayers(
  viewer: Cesium.Viewer,
  _west: number,
  _south: number,
  _east: number,
  _north: number,
  activeDepthM: number,
  variable: Variable = 'TEMP',
  time: string = DEFAULT_TIME,
  rangeOverride?: { min: number; max: number },
): Promise<void> {
  clearDepthLayers(viewer);
  current = null;

  const zaxIndex = VAM_DEPTHS_M.indexOf(activeDepthM);
  if (zaxIndex < 0) return;

  const timeIdx = VAM_TIMES.indexOf(time);
  if (timeIdx < 0) return;

  const seq = requestSeq;

  try {
    const canvas = await getSliceCanvas(variable, zaxIndex, timeIdx, rangeOverride);
    if (viewer.isDestroyed() || seq !== requestSeq) return;

    const objUrl = await canvasToBlobUrl(canvas);
    if (viewer.isDestroyed() || seq !== requestSeq) {
      URL.revokeObjectURL(objUrl);
      return;
    }

    const rect = Cesium.Rectangle.fromDegrees(
      VAM_BBOX.west, VAM_BBOX.south, VAM_BBOX.east, VAM_BBOX.north,
    );
    const provider = new Cesium.SingleTileImageryProvider({
      url: objUrl,
      rectangle: rect,
      tileWidth: 900,
      tileHeight: 600,
    });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    depthLayersByViewer.set(viewer, [layer]);
    depthUrlsByViewer.set(viewer, [objUrl]);

    current = { zaxIndex, depthM: activeDepthM, variable, time, timeIdx };
    viewer.scene.requestRender();
  } catch (err) {
    console.warn('Binary depth slice failed:', err);
  }
}

/**
 * Show a data slice for ANY dataset on the globe.
 * Works with any grid size, any bbox, any variable.
 */
export async function showDatasetSlice(
  viewer: Cesium.Viewer,
  datasetId: string,
  variableId: string,
  depthIdx: number,
  timeIdx: number,
): Promise<void> {
  const dataset = getDataset(datasetId);
  clearDepthLayers(viewer);
  current = null;

  const seq = requestSeq;

  try {
    const canvas = await fetchSliceCanvasForDataset(dataset, variableId, depthIdx, timeIdx);
    if (viewer.isDestroyed() || seq !== requestSeq) return;

    const objUrl = await canvasToBlobUrl(canvas);
    if (viewer.isDestroyed() || seq !== requestSeq) {
      URL.revokeObjectURL(objUrl);
      return;
    }

    const rect = Cesium.Rectangle.fromDegrees(
      dataset.bbox.west, dataset.bbox.south,
      dataset.bbox.east, dataset.bbox.north,
    );
    const provider = new Cesium.SingleTileImageryProvider({
      url: objUrl,
      rectangle: rect,
      tileWidth: canvas.width,
      tileHeight: canvas.height,
    });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = 0.85;
    depthLayersByViewer.set(viewer, [layer]);
    depthUrlsByViewer.set(viewer, [objUrl]);

    current = {
      zaxIndex: depthIdx,
      depthM: dataset.depths[depthIdx] ?? 0,
      variable: variableId as Variable,
      time: dataset.times[timeIdx] ?? 'static',
      timeIdx,
    };
    viewer.scene.requestRender();
  } catch (err) {
    console.warn('Dataset slice failed:', err);
  }
}

/** Focus camera — no-op anchor for future Zarr slice focus. */
export function focusDepth(viewer: Cesium.Viewer, _depthM: number): void {
  viewer.scene.requestRender();
}
