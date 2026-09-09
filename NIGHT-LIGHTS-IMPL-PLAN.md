# Night-Lights + Cloud Fade Implementation Plan

## Overview

Apply all researched changes to match Google Earth's day/night and cloud
behavior. Three files change; one new file is created.

## Changes

### 1. NEW: `src/cesium/night-lights.ts`

Creates the NASA GIBS Black Marble night-lights imagery layer.

- Ports the GIBS EPSG:4326 tiling scheme (non-standard tile counts per
  level: 2x1, 3x2, 5x3, 10x5, ...) from the official NASA GIBS Cesium
  example (`gibs.js`).
- Uses `WebMapTileServiceImageryProvider` with:
  - URL: `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?TIME=2016-01-01`
  - Layer: `VIIRS_Black_Marble` (verified from GIBS WMTS Capabilities XML)
  - TileMatrixSetID: `500m` (verified from Capabilities XML)
  - Format: `image/png`
  - MaximumLevel: 8
  - Custom tiling scheme (512px tile pixels for geo calculations)
- Sets `dayAlpha = 0.0` (invisible on day side) and `nightAlpha = 1.0`
  (visible on night side) — this uses Cesium's built-in
  `APPLY_DAY_NIGHT_ALPHA` shader path, no custom shader needed.
- Sets `brightness = 2.0` to boost city lights (per Cesium's own
  Earth-at-Night tutorial).

### 2. UPDATE: `src/cesium/config.ts`

After viewer creation, add:

- Call `addNightLightsLayer(viewer)` to add the Black Marble layer.
- Set `globe.nightFadeInDistance = 8_000_000` (8000 km — matches Google
  Earth Studio docs).
- Set `globe.nightFadeOutDistance = 3_000_000` (3000 km — matches Google
  Earth Studio docs).
- Set `globe.minimumBrightness` to a small value (e.g. 0.1) to prevent
  pitch-black night side (moonlight/airglow ambient).

### 3. UPDATE: `src/cesium/clouds.ts`

Change the cloud fade band to match Google Earth:

- `FADE_OUT_COMPLETE_HEIGHT`: 350,000 → 8,000,000 (8,000 km)
- `FADE_IN_COMPLETE_HEIGHT`: 500,000 → 20,000,000 (20,000 km)

Google Earth Studio docs: "When Time of Day is turned off, clouds begin
to fade out at 20,000 km. Below 8,000 km, they don't render at all."

### 4. UPDATE: `src/components/CesiumViewer.tsx`

No changes needed — the night-lights layer is added inside
`createOptimizedViewer` (in config.ts), so it's created as part of the
viewer setup. The cloud layer deferral via `requestIdleCallback` stays
as-is.

## Verification

1. `npm run build` — TypeScript + Vite must pass.
2. Hard-refresh `http://localhost:5173/`.
3. Check:
   - City lights visible on the night side of the globe.
   - Night side is not pitch black (ambient term).
   - Day side shows normal imagery (no city lights bleeding through).
   - Terminator is soft and sun-locked (stays fixed on the globe when
     orbiting the camera).
   - Clouds fade out between 8,000 km and 20,000 km (much earlier than
     before).
   - No shader compile errors in the console.
   - No "Too many active WebGL contexts" warnings.
