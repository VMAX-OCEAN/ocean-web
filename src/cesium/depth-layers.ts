import * as Cesium from 'cesium';
import {
  VAM_DEPTHS_M,
  VAM_TIMES,
  VAM_BBOX,
  getSliceCanvas,
  fetchSliceCanvasForDataset,
  type Variable,
} from './binary-data';
import { getDataset } from './datasets';
import { CanvasImageryProvider } from './canvas-provider';

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
let requestSeq = 0;

/** Bump request sequence to cancel any in-flight slice renders. */
function bumpSeq(): number {
  requestSeq++;
  return requestSeq;
}

/** Remove depth slice layer (no blob URLs to revoke with CanvasImageryProvider). */
export function clearDepthLayers(viewer: Cesium.Viewer): void {
  const layers = depthLayersByViewer.get(viewer) ?? [];
  for (const l of layers) viewer.imageryLayers.remove(l, true);
  depthLayersByViewer.set(viewer, []);
  bumpSeq();
}

/**
 * Swap imagery layers without flicker.
 *
 * The key insight: Cesium's `addImageryProvider()` adds the layer to the
 * collection instantly, but the layer's texture isn't uploaded/rendered
 * until the next render cycle(s). If we remove the old layer immediately,
 * there's a 1-2 frame gap where neither old nor new is visible = flicker.
 *
 * Fix: add the new layer, then defer old-layer removal until Cesium has
 * actually rendered the new layer (detected via `scene.postRender`).
 * We wait for 2 postRender events to be safe (texture upload + paint).
 */
function swapLayers(
  viewer: Cesium.Viewer,
  newLayer: Cesium.ImageryLayer,
): void {
  const oldLayers = depthLayersByViewer.get(viewer) ?? [];
  depthLayersByViewer.set(viewer, [newLayer]);

  if (oldLayers.length === 0) {
    // No old layer to remove — nothing to defer.
    return;
  }

  // Defer old-layer removal until the new layer has been rendered.
  // This is the critical anti-flicker mechanism.
  let renderCount = 0;
  const removeOld = () => {
    renderCount++;
    // Wait for 2 render cycles to ensure the new texture is fully
    // uploaded and painted before tearing down the old layer.
    if (renderCount >= 2) {
      for (const l of oldLayers) {
        if (!l.isDestroyed()) viewer.imageryLayers.remove(l, true);
      }
      viewer.scene.postRender.removeEventListener(removeOld);
    }
  };
  viewer.scene.postRender.addEventListener(removeOld);
  viewer.scene.requestRender();
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
 * The canvas is transparent where data is NaN (land/no-data), so land keeps satellite imagery.
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
  const seq = bumpSeq();

  const zaxIndex = VAM_DEPTHS_M.indexOf(activeDepthM);
  if (zaxIndex < 0) return;

  const timeIdx = VAM_TIMES.indexOf(time);
  if (timeIdx < 0) return;

  try {
    const canvas = await getSliceCanvas(variable, zaxIndex, timeIdx, rangeOverride);
    if (viewer.isDestroyed() || seq !== requestSeq) return;

    const rect = Cesium.Rectangle.fromDegrees(
      VAM_BBOX.west, VAM_BBOX.south, VAM_BBOX.east, VAM_BBOX.north,
    );
    const provider = new CanvasImageryProvider({
      canvas,
      rectangle: rect,
      tileWidth: canvas.width,
      tileHeight: canvas.height,
    });

    const newLayer = viewer.imageryLayers.addImageryProvider(provider);
    newLayer.alpha = 0.85;
    swapLayers(viewer, newLayer);

    current = {
      zaxIndex,
      depthM: activeDepthM,
      variable,
      time,
      timeIdx,
    };
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
  const seq = bumpSeq();

  try {
    const canvas = await fetchSliceCanvasForDataset(dataset, variableId, depthIdx, timeIdx);
    if (viewer.isDestroyed() || seq !== requestSeq) return;

    const rect = Cesium.Rectangle.fromDegrees(
      dataset.bbox.west, dataset.bbox.south,
      dataset.bbox.east, dataset.bbox.north,
    );
    const provider = new CanvasImageryProvider({
      canvas,
      rectangle: rect,
      tileWidth: canvas.width,
      tileHeight: canvas.height,
    });

    const newLayer = viewer.imageryLayers.addImageryProvider(provider);
    newLayer.alpha = 0.85;
    swapLayers(viewer, newLayer);

    current = {
      zaxIndex: depthIdx,
      depthM: dataset.depths[depthIdx] ?? 0,
      variable: variableId as Variable,
      time: dataset.times[timeIdx] ?? 'static',
      timeIdx,
    };
  } catch (err) {
    console.warn('Dataset slice failed:', err);
  }
}

/** Focus camera — no-op anchor for future Zarr slice focus. */
export function focusDepth(viewer: Cesium.Viewer, _depthM: number): void {
  viewer.scene.requestRender();
}
