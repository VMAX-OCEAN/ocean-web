import * as Cesium from 'cesium';
import {
  BAND_FILES,
  classifyFeature,
  type BandId,
  type BandFile,
  type GeoJSONFeatureCollection,
} from './borders-data';
import { BAND_VISUALS, FADE_RANGES, computeBandAlpha } from './borders-styling';

/**
 * Zoom-dependent borders: continents → countries → states.
 *
 * Mirrors Google Earth's "Borders & Labels" layer: borders smoothly
 * fade in/out by camera altitude (same alpha-fade pattern as clouds.ts),
 * with coarser data loading at startup and finer data lazy-loading as
 * the user zooms in.
 *
 * Four bands, each backed by Natural Earth vector data (public domain):
 *   L0 — Continents (110m, ~200 KB, loads at startup)
 *   L1 — Countries (50m, ~800 KB, loads at startup)
 *   L2 — Detailed countries (10m, ~3 MB, lazy-loads below 6,000 km)
 *   L3 — States/provinces (10m, ~21 MB, lazy-loads below 1,500 km)
 *
 * Rendering: GroundPolylinePrimitive (Primitive API, not GeoJsonDataSource)
 * — full width control, terrain draping, GPU distance display, and a
 * custom Fabric material with an `alpha` uniform for smooth fading.
 * See BORDERS-PLAN.md for the full design rationale.
 */

// ─── Custom material (solid + dashed + dotted, with alpha fade) ──────────
// For solid lines: a simple color material with an alpha uniform for
// smooth altitude-based fading (same pattern as clouds.ts).
// For dashed/dotted lines: Cesium's built-in PolylineDash material,
// which computes dashes in pixel space (consistent dash length
// regardless of segment length). The earlier custom shader used
// materialInput.st.s (normalized 0→1 per segment), which made dash
// count vary with segment length — long borders got long dashes,
// short borders got short dashes. PolylineDash fixes this.
//
// The alpha uniform is updated per-frame by the onTick listener for
// smooth altitude-based fading.

const SOLID_MATERIAL_SOURCE = `
  uniform vec4 color;
  uniform float alpha;

  czm_material czm_getMaterial(czm_materialInput materialInput)
  {
      czm_material material = czm_getDefaultMaterial(materialInput);
      material.diffuse = color.rgb;
      material.alpha = alpha;
      return material;
  }
`;

function createBorderMaterial(
  color: Cesium.Color,
  alpha: number,
  dash: 'solid' | 'dashed' | 'dotted',
): Cesium.Material {
  if (dash === 'solid') {
    // Simple solid color with alpha fade — no dash pattern needed
    return new Cesium.Material({
      fabric: {
        type: 'BorderLineSolid',
        uniforms: { color, alpha },
        source: SOLID_MATERIAL_SOURCE,
      },
    });
  }

  // Dashed/dotted: use Cesium's built-in PolylineDash material which
  // computes dashes in pixel space (via gl_FragCoord) for consistent
  // dash length regardless of segment length. The earlier custom
  // shader used materialInput.st.s (normalized 0→1 per segment), which
  // made dash count vary with segment length.
  //
  // PolylineDash uniforms:
  //   color: line color (alpha controls opacity)
  //   gapColor: color of gaps (transparent for dashed)
  //   dashLength: dash length in pixels (16 for dashed, 4 for dotted)
  //   dashPattern: 16-bit stipple pattern (0xff00 for dashes, 0x5555 for dots)
  return new Cesium.Material({
    fabric: {
      type: 'PolylineDash',
      uniforms: {
        color: color.withAlpha(alpha),
        gapColor: Cesium.Color.TRANSPARENT,
        dashLength: dash === 'dotted' ? 4.0 : 16.0,
        dashPattern: dash === 'dotted' ? 0x5555 : 0xff00,
      },
    },
  });
}

// ─── GeoJSON parsing ────────────────────────────────────────────────────

/** Extract line segments from a GeoJSON geometry (LineString or MultiLineString).
 *  Returns [] for null/undefined geometry or non-line types. */
function extractLineSegments(geometry: GeoJSONFeatureCollection['features'][0]['geometry'] | null | undefined): number[][][] {
  if (!geometry || !geometry.type) return [];
  if (geometry.type === 'LineString') {
    return [geometry.coordinates as number[][]];
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates as number[][][];
  }
  return [];
}

/** Fetch and parse a GeoJSON file. Uses a Web Worker for large files
 *  (>5 MB) to avoid blocking the main thread during JSON parsing. */
async function loadBandData(path: string): Promise<GeoJSONFeatureCollection> {
  // Use the worker for files likely to be large (the 10m admin-1 file
  // is ~21 MB). The worker fetches + parses off the main thread.
  // Small files (110m, 50m) are fast enough to parse inline.
  if (path.includes('admin_1_states_provinces')) {
    // Worker fetch resolves relative paths against the worker's own URL
    // (e.g. /src/cesium/borders/...), not the site root. Ensure the
    // path is absolute so the worker fetches from the correct location.
    const absPath = path.startsWith('/') ? path : `/${path}`;
    return loadBandDataViaWorker(absPath);
  }

  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return (await response.json()) as GeoJSONFeatureCollection;
}

/** Load via Web Worker — fetch + JSON.parse off the main thread. */
function loadBandDataViaWorker(path: string): Promise<GeoJSONFeatureCollection> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./borders-worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (e: MessageEvent<{ geojson: unknown; error?: string }>) => {
      worker.terminate();
      if (e.data.error) {
        reject(new Error(e.data.error));
      } else {
        resolve(e.data.geojson as GeoJSONFeatureCollection);
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage({ path });
  });
}

// ─── Primitive building ──────────────────────────────────────────────────

interface BandState {
  primitives: Cesium.GroundPolylinePrimitive[];
  alpha: number;
  loaded: boolean;
  loading: boolean;
  /** Track which primitives have finished async geometry build. */
  readyFlags: boolean[];
}

/**
 * Build GroundPolylinePrimitive(s) for a band.
 *
 * Features are grouped by style (solid/dashed/dotted + color) so each
 * style gets its own primitive with its own material. This keeps draw
 * calls minimal (typically 1-3 per band) while allowing different
 * styling per feature class.
 */
function buildBandPrimitives(
  viewer: Cesium.Viewer,
  geojson: GeoJSONFeatureCollection,
  bandId: BandId,
): Cesium.GroundPolylinePrimitive[] {
  const visual = BAND_VISUALS[bandId];

  // Group features by style key
  const styleGroups = new Map<
    string,
    { color: Cesium.Color; dash: 'solid' | 'dashed' | 'dotted'; instances: Cesium.GeometryInstance[] }
  >();

  if (!geojson || !Array.isArray(geojson.features)) return [];
  for (const feature of geojson.features) {
    if (!feature || !feature.properties) continue;
    const style = classifyFeature(feature.properties.FEATURECLA);
    const key = `${style.dash}-${style.color}`;

    if (!styleGroups.has(key)) {
      styleGroups.set(key, {
        color: Cesium.Color.fromCssColorString(style.color),
        dash: style.dash,
        instances: [],
      });
    }

    const segments = extractLineSegments(feature.geometry);
    for (const segment of segments) {
      if (!Array.isArray(segment) || segment.length < 2) continue;

      // Flatten [ [lon, lat], ... ] → [lon, lat, lon, lat, ...]
      const flatCoords: number[] = [];
      for (const point of segment) {
        if (!Array.isArray(point) || point.length < 2) continue;
        flatCoords.push(point[0], point[1]);
      }

      const positions = Cesium.Cartesian3.fromDegreesArray(flatCoords);
      const geometry = new Cesium.GroundPolylineGeometry({
        positions,
        width: visual.width,
      });

      styleGroups.get(key)!.instances.push(new Cesium.GeometryInstance({ geometry }));
    }
  }

  // Create one primitive per style group
  const primitives: Cesium.GroundPolylinePrimitive[] = [];
  for (const [, group] of styleGroups) {
    if (group.instances.length === 0) continue;

    const material = createBorderMaterial(group.color, 0, group.dash);
    const primitive = new Cesium.GroundPolylinePrimitive({
      geometryInstances: group.instances,
      appearance: new Cesium.PolylineMaterialAppearance({
        material,
        translucent: true,
      }),
      asynchronous: true,
    });

    viewer.scene.groundPrimitives.add(primitive);
    primitives.push(primitive);
  }

  return primitives;
}

// ─── Band loading (with lazy-load support) ───────────────────────────────

/**
 * Set the alpha fade on a border primitive's material.
 * Handles both solid (has `alpha` uniform) and dashed (PolylineDash,
 * uses `color.a`) materials.
 */
function setBorderAlpha(prim: Cesium.GroundPolylinePrimitive, alpha: number): void {
  const appearance = prim.appearance as Cesium.PolylineMaterialAppearance;
  const uniforms = appearance.material.uniforms as Record<string, unknown>;
  if ('alpha' in uniforms) {
    // Solid material — direct alpha uniform
    (uniforms as { alpha: number }).alpha = alpha;
  } else if ('color' in uniforms) {
    // PolylineDash material — alpha is the color uniform's .a.
    // The uniform may be stored as a plain {r,g,b,a} object rather
    // than a Cesium.Color instance, so set .alpha directly instead
    // of calling .withAlpha().
    const color = uniforms.color as { red: number; green: number; blue: number; alpha: number };
    color.alpha = alpha;
  }
}

async function loadBand(
  file: BandFile,
  viewer: Cesium.Viewer,
  bandStates: Map<BandId, BandState>,
): Promise<void> {
  const state = bandStates.get(file.id);
  if (!state || state.loaded || state.loading) return;
  state.loading = true;

  try {
    const geojson = await loadBandData(file.path);
    if (viewer.isDestroyed()) return;

    const primitives = buildBandPrimitives(viewer, geojson, file.id);
    state.primitives = primitives;
    state.readyFlags = primitives.map(() => false);
    state.loaded = true;

    // Set initial alpha based on current camera height
    const height = viewer.camera.positionCartographic.height;
    const alpha = computeBandAlpha(height, FADE_RANGES[file.id]);
    state.alpha = alpha;
    for (const prim of primitives) {
      setBorderAlpha(prim, alpha);
      prim.show = alpha > 0;
    }

    viewer.scene.requestRender();
  } catch (err) {
    console.warn(`Failed to load border band ${file.id} (${file.label}):`, err);
    // Mark as loaded even on failure so onTick doesn't retry infinitely.
    // The band simply won't appear — better than a fetch loop.
    state.loaded = true;
  } finally {
    state.loading = false;
  }
}

// ─── Main entry point ────────────────────────────────────────────────────

/**
 * Add zoom-dependent borders to the viewer.
 *
 * Call this after terrain is ready (same deferred pattern as addCloudLayer).
 * L0 + L1 load immediately; L2 + L3 lazy-load as the user zooms in.
 * A single onTick listener updates each band's alpha based on camera
 * altitude and calls requestRender() only when an alpha actually changes.
 */
export function addBorders(viewer: Cesium.Viewer): void {
  const bandStates = new Map<BandId, BandState>();
  for (const file of BAND_FILES) {
    bandStates.set(file.id, {
      primitives: [],
      alpha: -1,
      loaded: false,
      loading: false,
      readyFlags: [],
    });
  }

  // Add Natural Earth attribution (public domain, CC0)
  const scene = viewer.scene as unknown as {
    creditDisplay?: { addStaticCredit: (credit: Cesium.Credit) => void };
  };
  scene.creditDisplay?.addStaticCredit(
    new Cesium.Credit('Natural Earth (public domain, CC0)'),
  );

  // Load L0 + L1 immediately (small files, ~1 MB total)
  for (const file of BAND_FILES) {
    if (file.loadBelowAltitude === Number.MAX_VALUE) {
      void loadBand(file, viewer, bandStates);
    }
  }

  // Single onTick listener: lazy-load + alpha fade + ready-poll
  viewer.clock.onTick.addEventListener(() => {
    if (viewer.isDestroyed()) return;

    const height = viewer.camera.positionCartographic.height;
    let anyChanged = false;

    // Lazy-load bands when camera crosses their threshold
    for (const file of BAND_FILES) {
      if (file.loadBelowAltitude === Number.MAX_VALUE) continue;
      const state = bandStates.get(file.id);
      if (state && !state.loaded && !state.loading && height < file.loadBelowAltitude) {
        void loadBand(file, viewer, bandStates);
      }
    }

    // Poll primitive readiness — GroundPolylinePrimitive with
    // asynchronous:true builds geometry on a worker. In
    // requestRenderMode, Cesium does NOT auto-render when the
    // primitive becomes ready (Cesium issue #6734, PR #12841).
    // We must detect the false→true transition and requestRender().
    for (const state of bandStates.values()) {
      if (!state.loaded || state.primitives.length === 0) continue;
      for (let i = 0; i < state.primitives.length; i++) {
        if (!state.readyFlags[i] && state.primitives[i].ready) {
          state.readyFlags[i] = true;
          anyChanged = true;
        }
      }
    }

    // Update alpha for each loaded band
    for (const [bandId, state] of bandStates) {
      if (!state.loaded || state.primitives.length === 0) continue;

      const newAlpha = computeBandAlpha(height, FADE_RANGES[bandId]);
      if (newAlpha !== state.alpha) {
        state.alpha = newAlpha;
        for (const prim of state.primitives) {
          setBorderAlpha(prim, newAlpha);
          prim.show = newAlpha > 0;
        }
        anyChanged = true;
      }
    }

    if (anyChanged) {
      viewer.scene.requestRender();
    }
  });
}
