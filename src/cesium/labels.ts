import * as Cesium from 'cesium';
import {
  LABEL_FILES,
  LABEL_FADE_RANGES,
  CONTINENT_LABELS,
  extractOceanLabels,
  extractCountryLabels,
  extractStateLabels,
  extractCityLabels,
  extractRiverLabels,
  extractSeaLabels,
  type LabelBandId,
  type LabelPoint,
} from './labels-data';

/**
 * Zoom-dependent geographic labels using Cesium LabelCollection.
 *
 * Architecture mirrors borders.ts:
 *  - L0 (continents + oceans) loads at startup (~276 KB)
 *  - L1-L4 lazy-load as the camera zooms below their thresholds
 *  - Each band's visibility is controlled by distanceDisplayCondition
 *    (GPU-side, zero per-frame JS) — a single visibility system to
 *    avoid conflicts between GPU-side translucency and CPU-side toggles.
 *  - A single onTick listener handles lazy-loading.
 *
 * Why LabelCollection (not Entity API):
 *  Cesium forum + docs confirm Entity labels are catastrophically slow
 *  with thousands of labels (LabelVisualizer.update() loops all entities
 *  every frame). LabelCollection is batched — one draw call per
 *  collection, GPU-side distance culling.
 *
 * Why not clampToGround:
 *  HeightReference.CLAMP_TO_GROUND on labels is catastrophically slow
 *  with long text (Cesium forum). We use absolute height (1000m above
 *  surface) instead.
 */

interface BandState {
  collection: Cesium.LabelCollection | null;
  loaded: boolean;
  loading: boolean;
}

/** Fetch and parse a GeoJSON file. */
async function loadLabelData(path: string): Promise<any> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return response.json();
}

/** Build a LabelCollection for a set of label points.
 *
 *  Visibility uses a SINGLE system: distanceDisplayCondition (GPU-side,
 *  zero per-frame JS). Labels are fully opaque within their band and
 *  hard-culled outside it. This avoids the conflict between GPU-side
 *  translucencyByDistance (uses camera-to-label distance) and CPU-side
 *  computeLabelAlpha (uses camera altitude) that made labels invisible.
 *
 *  Research: Been et al. "Dynamic Map Labeling" (IEEE TVCG 2006) and
 *  Google's patent US8896630 establish that consistent dynamic labeling
 *  needs: (1) no popping, (2) no jumping, (3) history-independent.
 *  Hard band culling satisfies (2) and (3); smooth fades are a refinement
 *  that requires a single consistent metric (not two conflicting ones).
 */
function buildLabelCollection(
  viewer: Cesium.Viewer,
  labels: LabelPoint[],
  bandId: LabelBandId,
): Cesium.LabelCollection {
  const collection = new Cesium.LabelCollection();
  viewer.scene.primitives.add(collection);

  const range = LABEL_FADE_RANGES[bandId];

  // Distance display condition: show labels only within their altitude band.
  // Cesium uses distance from camera, not altitude. We convert altitude to
  // distance (approximate — assumes camera is looking straight down).
  // Near = fadeOutEnd (closest, culled below), Far = fadeInStart (farthest).
  const nearDist = range.fadeOutEnd > 0 ? range.fadeOutEnd : 100;
  const farDist = range.fadeInStart !== Number.MAX_VALUE ? range.fadeInStart : 50_000_000;

  for (const label of labels) {
    collection.add({
      position: Cesium.Cartesian3.fromDegrees(label.lon, label.lat, 1000),
      text: label.text,
      // Bold weight for stronger legibility against bright imagery.
      font: `bold ${label.fontSize}px sans-serif`,
      fillColor: Cesium.Color.WHITE,
      // FILL only — no outline. Cesium's outline is a GPU glyph
      // extrusion that produces pixelated/jagged edges (known issue:
      // CesiumGS/cesium#4235, #9444, #11124). The Cesium team
      // recommends FILL-only or HTML overlays for clean text.
      style: Cesium.LabelStyle.FILL,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      // GPU-side distance culling — single visibility system, no conflicts.
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
        nearDist,
        farDist,
      ),
      // Depth-test labels against the globe so labels on the far side
      // are hidden by the globe itself.
      disableDepthTestDistance: 0,
    });
  }

  return collection;
}

/** Load and build a label band. */
async function loadLabelBand(
  file: { id: LabelBandId; path: string; label: string },
  viewer: Cesium.Viewer,
  bandStates: Map<LabelBandId, BandState>,
  marinePolysData: any | null,
): Promise<void> {
  const state = bandStates.get(file.id);
  if (!state || state.loaded || state.loading) return;
  state.loading = true;

  try {
    let labels: LabelPoint[] = [];

    if (file.id === 'L0') {
      // L0: continents (hardcoded) + oceans (from marine polys)
      labels = [...CONTINENT_LABELS];
      if (marinePolysData) {
        labels = labels.concat(extractOceanLabels(marinePolysData));
      }
    } else if (file.id === 'L1') {
      const data = await loadLabelData(file.path) as any;
      if (viewer.isDestroyed()) return;
      labels = extractCountryLabels(data);
    } else if (file.id === 'L2') {
      const data = await loadLabelData(file.path) as any;
      if (viewer.isDestroyed()) return;
      labels = extractStateLabels(data);
    } else if (file.id === 'L3') {
      const data = await loadLabelData(file.path) as any;
      if (viewer.isDestroyed()) return;
      labels = extractCityLabels(data);
    } else if (file.id === 'L4') {
      // Rivers + seas (seas come from the already-loaded marine polys)
      const riverData = await loadLabelData(file.path) as any;
      if (viewer.isDestroyed()) return;
      labels = extractRiverLabels(riverData);
      if (marinePolysData) {
        labels = labels.concat(extractSeaLabels(marinePolysData));
      }
    }

    if (viewer.isDestroyed()) return;

    const collection = buildLabelCollection(viewer, labels, file.id);
    state.collection = collection;
    state.loaded = true;

    // Visibility is controlled entirely by distanceDisplayCondition (GPU-side).
    // No CPU-side alpha toggle — it used camera altitude while the GPU uses
    // camera-to-label distance, causing conflicts that made labels invisible.
    collection.show = true;

    viewer.scene.requestRender();
  } catch (err) {
    console.warn(`Failed to load label band ${file.id} (${file.label}):`, err);
    state.loaded = true; // Don't retry infinitely
  } finally {
    state.loading = false;
  }
}

/**
 * Add zoom-dependent geographic labels to the viewer.
 *
 * Call after terrain is ready (same pattern as addBorders).
 * L0 (continents + oceans) loads at startup; L1-L4 lazy-load as the
 * user zooms in. A single onTick listener handles lazy-loading and
 * visibility toggling.
 */
export function addLabels(viewer: Cesium.Viewer): void {
  const bandStates = new Map<LabelBandId, BandState>();
  for (const file of LABEL_FILES) {
    bandStates.set(file.id, {
      collection: null,
      loaded: false,
      loading: false,
    });
  }

  // L0 needs the marine polys data for ocean labels. We load it once
  // and reuse it for L4 (sea labels) too.
  let marinePolysData: any = null;

  // Load L0 at startup (continents + oceans)
  void (async () => {
    try {
      const data = await loadLabelData('/labels/ne_10m_geography_marine_polys.geojson') as any;
      if (!viewer.isDestroyed()) {
        marinePolysData = data;
        void loadLabelBand(LABEL_FILES[0], viewer, bandStates, marinePolysData);
      }
    } catch (err) {
      console.warn('Failed to load marine polys for ocean labels:', err);
      // Fall back to just continent labels (hardcoded, no file needed)
      if (!viewer.isDestroyed()) {
        void loadLabelBand(LABEL_FILES[0], viewer, bandStates, null);
      }
    }
  })();

  // Single onTick listener: lazy-load bands as camera zooms in.
  // Visibility is handled entirely by distanceDisplayCondition (GPU-side),
  // so no CPU-side visibility toggle is needed here.
  viewer.clock.onTick.addEventListener(() => {
    if (viewer.isDestroyed()) return;

    const height = viewer.camera.positionCartographic.height;

    // Lazy-load bands when camera crosses their threshold
    for (const file of LABEL_FILES) {
      if (file.loadAtStartup) continue;
      const state = bandStates.get(file.id);
      if (state && !state.loaded && !state.loading && height < file.loadBelowAltitude) {
        void loadLabelBand(file, viewer, bandStates, marinePolysData);
      }
    }
  });

  // Add Natural Earth attribution
  try {
    const scene = viewer.scene as unknown as {
      creditDisplay?: { addStaticCredit?: (text: string) => void };
    };
    scene.creditDisplay?.addStaticCredit?.('Geographic labels: Natural Earth (public domain), geoBoundaries (CC BY 4.0, William & Mary geoLab)');
  } catch {
    // Credit display API varies across Cesium versions
  }
}
