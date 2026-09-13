import * as Cesium from 'cesium';
import { setNaturalBaseImagery } from './base-imagery';
import { addBorders } from './borders';
import { addLabels } from './labels';

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
  // No Cesium ion token needed — we use Re:Earth Terrain (free, open)
  // and Esri World Imagery (free, no key). No ion dependency at all.

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

    // Render at full device resolution for crisp labels. Without this,
    // Cesium caps to browser-recommended resolution (often 1x on high-DPI
    // displays), making text blurry/pixelated. Cesium forum confirms this
    // fixes label rendering quality.
    useBrowserRecommendedResolution: false,

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

  // ─── Fetch speed: raise HTTP/2 request ceiling for terrain + imagery ──
  // Cesium's default (18/server) is tuned for older HTTP/1.1 limits.
  // Re:Earth Terrain and Esri both serve over HTTP/2.
  Cesium.RequestScheduler.requestsByServer['terrain.reearth.land:443'] = 30;
  Cesium.RequestScheduler.requestsByServer['server.arcgisonline.com:443'] = 30;

  // ─── Render mode: only render on demand (biggest idle GPU win) ──
  // Without this, Cesium renders at 60fps even when the globe is
  // completely static. With it, Cesium only renders when something
  // changes (camera move, tile load, explicit requestRender call).
  // Cloud drift (clouds.ts) and current particles (currents.ts) call
  // requestRender() per frame they actually animate; everything else
  // is static and costs zero GPU. See Cesium blog on scene rendering
  // performance.
  viewer.scene.requestRenderMode = true;
  // Re-render if simulation time advances more than this many seconds
  // (allows background tile loading to trigger periodic refreshes).
  viewer.scene.maximumRenderTimeChange = Infinity;

  // ─── Depth test: terrain occludes ground primitives ──────────────
  // Required for borders (GroundPolylinePrimitive) and any clamped
  // overlays to be correctly hidden behind mountains instead of
  // showing through terrain. Must be true before borders work.
  viewer.scene.globe.depthTestAgainstTerrain = true;

  // ─── Realistic space look: starfield + atmosphere glow ──────────
  if (viewer.scene.skyBox) {
    viewer.scene.skyBox.show = true;
  }
  if (viewer.scene.skyAtmosphere) {
    viewer.scene.skyAtmosphere.show = true;
  }
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.backgroundColor = Cesium.Color.BLACK;

  // ─── Sharp base imagery (Google-Earth-like) ─────────────────────
  // Esri World Imagery — high-res satellite, no key. Async provider,
  // fire-and-forget so first paint isn't blocked.
  // See LAND-COLOR-AND-DAYNIGHT-PLAN.md.
  setNaturalBaseImagery(viewer).catch((err) =>
    console.warn('Esri base imagery failed, keeping default:', err),
  );

  // ─── Pole fill: ice-white base color ─────────────────────────────
  // Esri World Imagery uses Web Mercator (EPSG:3857), which cuts off at
  // ~±85° latitude. Cesium stretches the last tile row to the pole, but
  // the base color shows through where imagery is thin. Set it to an
  // ice-white so the poles read as ice rather than black/blue void.
  // (GIBS polar stereographic overlays were removed: GIBS blocks CORS
  //  from localhost, so the images can't load in the browser. The
  //  cloud pole fade + ice-white base color are the effective fixes.)
  viewer.scene.globe.baseColor = Cesium.Color.fromBytes(240, 245, 250, 255);

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

  // ─── Touchpad/mouse wheel zoom ────────────────────────────────────
  // A trackpad pinch gesture arrives as a `wheel` event with
  // `ctrlKey: true`. Browsers treat that combination as "zoom the
  // whole webpage" by default, intercepting it before Cesium's own
  // canvas handler gets a clean shot at it. We explicitly prevent
  // that default on every wheel event over the globe so the gesture
  // reaches Cesium's camera controller instead of the browser's page
  // zoom.
  //
  // CRITICAL: With requestRenderMode=true, Cesium only re-renders when
  // it detects a significant scene change. Trackpad scroll generates
  // tiny deltaY values (±1-5) vs mouse wheel (±100-120). Cesium may not
  // detect these tiny camera movements as significant enough to trigger
  // a render — the zoom happens but the globe doesn't visually update.
  // We explicitly call requestRender() after every wheel event to fix
  // this. See ZOOM-AND-CLOUD-FADE-PLAN.md.
  container.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      // Ensure the scene re-renders after Cesium processes the wheel
      // event. Our handler fires after Cesium's (bubbling: canvas →
      // container), so Cesium has already moved the camera by the time
      // we call this.
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    },
    { passive: false }
  );

  // ─── Async terrain attach (non-blocking) ─────────────────────────
  // Re:Earth Terrain — free, open, no token, no signup, no key.
  // Serves quantized-mesh-1.0 tiles with vertex normals + water mask,
  // covers the whole globe (zoom 0-14). Replaces Cesium ion World
  // Terrain so we have no ion dependency (no "Upgrade for commercial
  // use" branding, no ToS restrictions).
  // https://terrain.reearth.land/
  const terrainProvider = Cesium.CesiumTerrainProvider.fromUrl(
    'https://terrain.reearth.land/cesium-mesh/ellipsoid',
    {
      requestVertexNormals: true,
      requestWaterMask: true,
    },
  );
  const terrain = new Cesium.Terrain(terrainProvider);
  viewer.scene.setTerrain(terrain);

  // Terrain is ready immediately (provider was awaited). Refine LOD
  // after a short delay so coarse tiles finish loading first.
  window.setTimeout(() => {
    if (!viewer.isDestroyed()) {
      viewer.scene.globe.maximumScreenSpaceError = 2;
      viewer.scene.requestRender();
    }
  }, 1500);

  // ─── Borders + Labels: load after terrain, in idle time ──────────
  // L0 (continents) + L1 (countries) load immediately in the idle
  // callback — ~1 MB total, no impact on first paint. L2 + L3
  // lazy-load as the user zooms in. See BORDERS-PLAN.md.
  const scheduleIdle =
    window.requestIdleCallback ??
    ((cb: () => void) => window.setTimeout(cb, 300));
  scheduleIdle(() => {
    if (!viewer.isDestroyed()) {
      addBorders(viewer);
      addLabels(viewer);
    }
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
