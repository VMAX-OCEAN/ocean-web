# Current Architecture

What is actually running today, file by file.

```
src/
├── main.tsx                    React entry point
├── App.tsx                     Top-level layout: globe + zoom controls + loading/error overlays
├── vite-env.d.ts                Vite/TS env typing
├── styles/
│   └── light-theme.css          Light-theme UI chrome (overlays, buttons)
├── components/
│   ├── CesiumViewer.tsx          Owns the Cesium <Viewer> lifecycle inside React
│   └── ZoomControls.tsx          Fallback on-screen +/− zoom buttons
└── cesium/
    ├── config.ts                 Viewer creation + all global scene settings
    ├── base-imagery.ts            NASA GIBS Blue Marble base layer (replaces Bing)
    ├── clouds.ts                  Animated cloud shell (ellipsoid + custom material)
    ├── gibs-tiling-scheme.ts      Shared NASA GIBS EPSG:4326 tiling-scheme math
    └── night-lights.ts            NASA Black Marble night-lights layer (currently unused)
```

## Module responsibilities

### `cesium/config.ts` — `createOptimizedViewer(container)`

The single place that constructs the Cesium `Viewer` and configures the
scene. Called once, from `CesiumViewer.tsx`. Responsibilities, in the
order they happen:

1. Set the Cesium ion access token (from `VITE_CESIUM_ION_TOKEN` if
   provided, otherwise Cesium's own grandfathered demo token).
2. Create the `Viewer` **immediately, with `terrain: undefined`** —
   the globe (as a bare WGS84 ellipsoid + default imagery) paints
   within a frame or two, before terrain has loaded anything.
3. Configure staged level-of-detail (`maximumScreenSpaceError`),
   HTTP/2 request concurrency, sky/atmosphere visuals.
4. Replace the base imagery layer with NASA GIBS Blue Marble
   (`setNaturalBaseImagery`, see below).
5. Disable all lighting (`enableLighting = false` and friends) and
   freeze the clock — see doc 01 section 4 for why.
6. Set the initial camera position (78°E, 15°N, 20,000 km — a
   full-globe framing).
7. Install a `wheel` listener that calls `preventDefault()` so
   trackpad pinch-zoom isn't hijacked by the browser as page-zoom.
8. Attach `Cesium.Terrain.fromWorldTerrain()` **asynchronously** —
   the terrain object is returned synchronously and handed to
   `scene.setTerrain()` immediately, but the actual tile data streams
   in over `readyEvent`/`errorEvent`, non-blocking.
9. On terrain becoming ready, wait 1.5s (let the coarse tiles settle)
   then lower `maximumScreenSpaceError` from 4 to 2 for crisper detail.

Also exports `zoomBy(viewer, factor)`, used by `ZoomControls`.

### `cesium/base-imagery.ts` — `setNaturalBaseImagery(viewer)`

Removes whatever is at `imageryLayers.get(0)` (Cesium's default Bing
Maps Aerial) and replaces it with a `WebMapTileServiceImageryProvider`
pointed at NASA GIBS's `BlueMarble_NextGeneration` layer (EPSG:4326,
`500m` tile matrix set, `image/jpeg`), using the shared GIBS tiling
scheme. No API key, no token, no time parameter (it's a static
dataset).

### `cesium/gibs-tiling-scheme.ts` — `createGibsTilingScheme()`

NASA GIBS's EPSG:4326 endpoint uses a **non-standard geographic tiling
scheme**: tile counts per zoom level are not powers of 2 (2×1, 3×2,
5×3, 10×5, 20×10, ...) and tiles are 512px, unlike the standard
`GeographicTilingScheme`'s power-of-2 quadtree assumption. This module
overrides `getNumberOfXTilesAtLevel`, `getNumberOfYTilesAtLevel`,
`tileXYToRectangle`, and `positionToTileXY` to match GIBS's actual
layout (ported from NASA's own official Cesium example,
`nasa-gibs/gibs-web-examples`). Shared by `base-imagery.ts` and
`night-lights.ts` so both GIBS layers tile correctly.

### `cesium/clouds.ts` — `addCloudLayer(viewer)`

Adds a translucent `EllipsoidGeometry` primitive slightly larger than
the WGS84 ellipsoid (+15,000m), textured with a live cloud-alpha map,
flat-shaded (no lighting — see doc 01 §4). On every clock tick:
rotates the shell slightly (independent cloud drift), recomputes
altitude-based alpha (fades out between 8,000km and 20,000km,
matching Google Earth Studio's documented cloud-fade thresholds), and
hides the primitive entirely once alpha reaches 0 (skips the draw
call when clouds would be invisible anyway).

### `cesium/night-lights.ts` — `addNightLightsLayer(viewer)` (currently unused)

Adds a NASA GIBS `VIIRS_Black_Marble` imagery layer configured with
`dayAlpha = 0` / `nightAlpha = 1` so it would only render on the night
side, using Cesium's built-in day/night-alpha blending. Not called
from `config.ts` anymore since lighting is off — kept in the repo for
when day/night lighting is revisited.

### `components/CesiumViewer.tsx`

The React/Cesium lifecycle boundary. Key property: the initialization
`useEffect` has an **empty dependency array**, so it runs exactly once
per mount, and reads the `onReady`/`onError` callback props through
refs (updated every render, but not effect dependencies) rather than
depending on the callback identities directly. This was a fix for a
real bug — see doc 04 §1. On mount, it calls `createOptimizedViewer`,
calls `onReady` as soon as the viewer exists (so the loading UI clears
immediately, without waiting on clouds), then defers
`addCloudLayer(viewer)` to the next idle period via
`requestIdleCallback` (or a `setTimeout` fallback). On unmount, it
destroys the viewer, guarding against the case where unmount happens
while the async viewer creation is still in flight.

### `components/ZoomControls.tsx`

A tiny fallback UI: two buttons that call `zoomBy(viewer, ±0.3)`.
Exists because trackpad/OS/browser wheel-gesture quirks can't be fully
predicted or tested for on every user's hardware — this guarantees
zoom always works.

### `App.tsx`

Wires it all together: renders `CesiumViewer`, passes it callbacks
that flip `loading`/`error` state; renders `ZoomControls` once a
viewer exists; renders a loading spinner overlay until `onReady`
fires, or an error overlay if `onError` fires.

## Dependencies (`package.json`)

- `cesium` — the globe/rendering engine.
- `react` / `react-dom` — UI framework.
- `zarrita` — Zarr array reader, present for the planned ocean-data
  ingestion work (not yet wired into the rendering path described
  here).
- `vite` + `vite-plugin-cesium` — build tooling; the plugin handles
  copying Cesium's static assets (workers, widgets CSS, textures)
  into the build output and externalizing the `cesium` module
  correctly for Vite/Rollup.
- `@vitejs/plugin-react`, `typescript` — standard React+TS tooling.

## What is explicitly *not* in this baseline yet

Per the project roadmap (see the `ocean-docs` repo), the following are
planned but not implemented in this rendering baseline: SST/salinity/
water-level overlays, depth slices, current-direction particles,
Argo/glider/CTD/BGC observation layers, Zarr data streaming into the
scene, backend APIs, and production deployment.
