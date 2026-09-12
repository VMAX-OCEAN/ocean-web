import * as Cesium from 'cesium';
import { clampToVam, vamSlicePng, erddapPngObjectUrl, VAM_DEPTHS_M } from './erddap';

/**
 * Preset locations = offline fallback buttons (D7 mandate beats).
 * Primary path is any-bbox search; presets only pre-warm demo boxes.
 * Bboxes from d7-mandate-beats.md Beats 1-4.
 */

export interface Preset {
  id: string;
  label: string;
  mandate: string;
  west: number;
  south: number;
  east: number;
  north: number;
}

export const PRESETS: Preset[] = [
  {
    id: 'fani-2019',
    label: 'Fani 2019 · Bay of Bengal',
    mandate: 'Hazard assessment',
    west: 80,
    south: 5,
    east: 95,
    north: 22,
  },
  {
    id: 'konkan-sar',
    label: 'Konkan drift · Arabian Sea',
    mandate: 'Search-and-rescue',
    west: 68,
    south: 12,
    east: 74,
    north: 20,
  },
  {
    id: 'pfz-fishery',
    label: 'PFZ · SST front + chlorophyll',
    mandate: 'Fishery advisories',
    west: 60,
    south: 0,
    east: 104,
    north: 25,
  },
  {
    id: 'basin-warming',
    label: 'Basin warming · monthly vs baseline',
    mandate: 'Climate monitoring',
    west: 60,
    south: -5,
    east: 100,
    north: 30,
  },
];

/** Cinematic fly-to, NASA-Eyes-style approach. */
export function flyToPreset(viewer: Cesium.Viewer, p: Preset): void {
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(p.west, p.south, p.east, p.north),
    duration: 2.5,
  });
}

const ENTITY_TAG = 'location-volume';

// Imagery layers can't be found by entity id — track per viewer.
const imageryByViewer = new WeakMap<Cesium.Viewer, Cesium.ImageryLayer[]>();

/** Remove bbox entities + SST imagery layer. */
export function clearLocationVolume(viewer: Cesium.Viewer): void {
  const stale = viewer.entities.values.filter((e) =>
    e.id?.toString().startsWith(`${ENTITY_TAG}:`),
  );
  for (const e of stale) viewer.entities.remove(e);
  const layers = imageryByViewer.get(viewer) ?? [];
  for (const l of layers) viewer.imageryLayers.remove(l, true);
  imageryByViewer.set(viewer, []);
}

/**
 * Draw scoped bbox: outline + LIVE VAM TEMP surface slice draped on the
 * globe + center pin. Falls back to outline+pin only when bbox is fully
 * outside VAM coverage (global depth needs Copernicus proxy — no fake data).
 */
export function showLocationVolume(viewer: Cesium.Viewer, p: Preset): void {
  const bbox = { west: p.west, south: p.south, east: p.east, north: p.north };
  showBboxVolume(viewer, p.id, p.label, p.mandate, bbox);
}

/** Any-bbox entry: search/draw path shares the preset render path. */
export function showBboxVolume(
  viewer: Cesium.Viewer,
  id: string,
  label: string,
  mandate: string,
  bbox: { west: number; south: number; east: number; north: number },
): void {
  clearLocationVolume(viewer);
  const rect = Cesium.Rectangle.fromDegrees(bbox.west, bbox.south, bbox.east, bbox.north);
  const clon = (bbox.west + bbox.east) / 2;
  const clat = (bbox.south + bbox.north) / 2;

  viewer.entities.add({
    id: `${ENTITY_TAG}:${id}-outline`,
    name: `${label} bbox`,
    rectangle: {
      coordinates: rect,
      material: Cesium.Color.CYAN.withAlpha(0.08),
      outline: true,
      outlineColor: Cesium.Color.CYAN,
      height: 0,
    },
  });

  // Live VAM TEMP surface (ZAX 0 = 5 m). Fetched to blob URL first:
  // Cesium parses ANY string URL into queryParameters and re-serializes,
  // corrupting the keyless griddap constraint ("=undefined" → ERDDAP 400).
  // A blob: URL has no query string, so nothing to mangle.
  const clamped = clampToVam(bbox);
  if (clamped) {
    const rect = Cesium.Rectangle.fromDegrees(
      clamped.west,
      clamped.south,
      clamped.east,
      clamped.north,
    );
    const ctl = new AbortController();
    (showBboxVolume as unknown as { _ctl?: AbortController })._ctl?.abort();
    (showBboxVolume as unknown as { _ctl?: AbortController })._ctl = ctl;
    erddapPngObjectUrl(vamSlicePng(clamped, 0), ctl.signal)
      .then((objUrl) => {
        if (viewer.isDestroyed()) {
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
        imageryByViewer.set(viewer, [layer]);
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          console.warn('VAM surface slice failed:', err);
        }
      });
  }

  viewer.entities.add({
    id: `${ENTITY_TAG}:${id}-pin`,
    name: `${label} center`,
    position: Cesium.Cartesian3.fromDegrees(clon, clat, 5000),
    point: {
      pixelSize: 12,
      color: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
    },
    label: {
      text: clamped
        ? `${label}\n${mandate} · VAM TEMP 5 m`
        : `${label}\n${mandate} · outside VAM box — Copernicus proxy needed`,
      font: '14px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -14),
    },
  });
}

export { VAM_DEPTHS_M };
