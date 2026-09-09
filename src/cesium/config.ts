import * as Cesium from 'cesium';
import { setNaturalBaseImagery } from './base-imagery';

/**
 * Create a minimal, robust CesiumJS Viewer — just the globe.
 *
 * This is the baseline: standard Cesium World Terrain + default imagery,
 * realistic space background (stars + atmosphere), no extra UI.
 *
 * Lighting: sun-based day/night shading is intentionally OFF. The
 * globe is uniformly lit everywhere — no terminator, no dark side, no
 * night-side city lights. This was a deliberate simplification: our
 * day/night implementation caused a rendering artifact (a dark blob
 * with radiating streaks in the cloud layer, at the poles — a classic
 * normal-lighting singularity on EllipsoidGeometry, see clouds.ts) and
 * the terminator's "which side is dark" behavior was confusing rather
 * than clarifying. Removing lighting entirely removes both problems at
 * once. See LAND-COLOR-AND-DAYNIGHT-PLAN.md and CLOUD-WEDGE-FIX-PLAN.md.
 */
export async function createOptimizedViewer(container: HTMLElement): Promise<Cesium.Viewer> {
  // Set Cesium Ion token if provided; otherwise Cesium's own default
  // grandfathered demo token is used (works for World Terrain + Bing Imagery).
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN;
  if (token) {
    Cesium.Ion.defaultAccessToken = token;
  }

  // Create the Viewer IMMEDIATELY with no terrain so the globe paints
  // within a frame or two (smooth WGS84 ellipsoid + default imagery).
  // Terrain is attached asynchronously below — the user sees a globe
  // instantly and terrain detail pops in as it arrives, exactly the
  // progressive-load behavior Google Earth uses.
  // See LOAD-PERF-PLAN.md Fix 2.
  const viewer = new Cesium.Viewer(container, {
    terrain: undefined,

    // Minimal UI — just the globe
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    selectionIndicator: false,
    infoBox: false,

    contextOptions: {
      webgl: {
        alpha: false,
        antialias: true,
        preserveDrawingBuffer: false,
      },
    },
  });

  // ─── Staged LOD: coarse first paint, refine after settle ─────────
  // Start coarse (SSE=4) so the first globe paint needs only a handful
  // of tiles. After the globe has rendered and the camera is stable,
  // drop to the default-quality SSE=2 for crisp terrain/imagery.
  // See LOAD-PERF-PLAN.md Fix 3.
  viewer.scene.globe.maximumScreenSpaceError = 4;
  viewer.scene.globe.preloadAncestors = true;
  viewer.scene.globe.preloadSiblings = true;

  // ─── Fetch speed: raise HTTP/2 request ceiling for ion servers ──
  // Cesium's default (18/server) is tuned for older HTTP/1.1 limits.
  // Cesium ion serves over HTTP/2, which has no such connection cap.
  // See FETCH-PERFORMANCE-PLAN.md (Phase A1).
  Cesium.RequestScheduler.requestsByServer['assets.ion.cesium.com:443'] = 30;

  // ─── Realistic space look: starfield + atmosphere glow ──────────
  if (viewer.scene.skyBox) {
    viewer.scene.skyBox.show = true;
  }
  if (viewer.scene.skyAtmosphere) {
    viewer.scene.skyAtmosphere.show = true;
  }
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.backgroundColor = Cesium.Color.BLACK;

  // ─── Natural land/ocean color (Google-Earth-like) ───────────────
  // Replaces the default Bing Maps Aerial base layer (which Cesium
  // renders with a gamma=1.3 "washed out" look, see Cesium issue
  // #3279) with NASA GIBS Blue Marble: Next Generation — a cloud-free,
  // seasonal, true-color mosaic. Gives natural blue oceans and
  // realistic green/brown land without the Bing gamma issue or the
  // cloud/snow artifacts of daily satellite imagery.
  // See LAND-COLOR-AND-DAYNIGHT-PLAN.md.
  setNaturalBaseImagery(viewer);

  // ─── Lighting: OFF — uniformly lit globe, no day/night (see note above) ─
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.dynamicAtmosphereLighting = false;
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = false;

  // Freeze the clock — there's no terminator to animate anymore, so
  // there's no reason to advance simulation time. Cloud drift (in
  // clouds.ts) runs on the render loop's onTick, which fires every
  // frame regardless of shouldAnimate, so it's unaffected.
  viewer.clock.shouldAnimate = false;

  // Initial camera position: full-globe view (like the reference screenshot)
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(78.0, 15.0, 20000000),
  });

  // ─── Touchpad zoom fix ────────────────────────────────────────────
  // A trackpad pinch gesture arrives as a `wheel` event with
  // `ctrlKey: true`. Browsers treat that combination as "zoom the
  // whole webpage" by default, intercepting it before Cesium's own
  // canvas handler gets a clean shot at it. We explicitly prevent
  // that default on every wheel event over the globe so the gesture
  // reaches Cesium's camera controller instead of the browser's page
  // zoom. See ZOOM-AND-CLOUD-FADE-PLAN.md.
  container.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
    },
    { passive: false }
  );

  // ─── Async terrain attach (non-blocking) ─────────────────────────
  // `Terrain.fromWorldTerrain()` returns a Terrain object synchronously;
  // the underlying provider resolves asynchronously via `readyEvent`.
  // We attach it to the scene immediately — Cesium streams terrain
  // tiles in the background while the ellipsoid globe is already
  // visible. See LOAD-PERF-PLAN.md Fix 2.
  const terrain = Cesium.Terrain.fromWorldTerrain({
    requestVertexNormals: true,
  });
  viewer.scene.setTerrain(terrain);

  terrain.readyEvent.addEventListener(() => {
    if (viewer.isDestroyed()) return;

    // Now that terrain is streaming, refine LOD to default quality.
    // A short delay lets the coarse tiles finish loading first so the
    // refinement doesn't trigger a second wave of high-detail requests
    // while coarse tiles are still in flight.
    window.setTimeout(() => {
      if (!viewer.isDestroyed()) {
        viewer.scene.globe.maximumScreenSpaceError = 2;
        viewer.scene.requestRender();
      }
    }, 1500);
  });

  terrain.errorEvent.addEventListener((err) => {
    console.warn('World terrain error, staying on ellipsoid:', err);
  });

  return viewer;
}

/** Zoom the camera in/out by a fraction of the current altitude. */
export function zoomBy(viewer: Cesium.Viewer, factor: number) {
  const height = viewer.camera.positionCartographic.height;
  const amount = height * factor;
  if (factor > 0) {
    viewer.camera.zoomIn(amount);
  } else {
    viewer.camera.zoomOut(-amount);
  }
  viewer.scene.requestRender();
}
