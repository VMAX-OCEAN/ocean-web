# Land Color & Day/Night Behavior — Research & Plan

## Issue 1: Day/night behavior when moving the globe

### What the user sees
"when i move the globe i can see a dark side and white side which move
along the globe when i move it it is not fixed in one side"

### What's actually happening (this is CORRECT behavior)

When you drag the globe in Cesium (or Google Earth), you are **orbiting
the camera** around a fixed globe. The globe itself does NOT rotate.
The sun direction is fixed in space (ECEF). The terminator (day/night
boundary) stays on the same geographic locations.

As you orbit the camera, you see different parts of the Earth. The
dark side appears to "move with the globe" because it IS on the globe
— it's painted on the same geographic locations. This is exactly how
Google Earth works too.

### Why it might look wrong

The user expects the dark side to stay "fixed in one side" (screen
space), like a studio light that stays on the left of the screen no
matter how you rotate the globe. That would only happen if:
1. The globe itself rotated (not the camera) — not standard in Cesium
2. OR the lighting followed the camera — a bug we don't want

Google Earth uses the same model as Cesium: camera orbit + sun-locked
lighting. When you drag in Google Earth, the terminator stays on the
same geographic locations too.

### Options

**Option A: Keep as-is (correct, matches Google Earth)**
The current behavior is physically correct. The terminator is
sun-locked — it stays on the same geographic locations. When you
orbit, you see different parts of the Earth. This is how Google Earth
works.

**Option B: Animate the clock so the Earth rotates under a fixed sun**
If the user wants to see the Earth "rotate" with a fixed sun, we can
enable clock animation (`shouldAnimate = true`, `multiplier = 100`).
Time advances, the sun direction changes in ECEF, and the terminator
sweeps across the surface. This gives the visual of "Earth rotating
under a fixed sun."

**Option C: Disable lighting entirely**
Remove `enableLighting` and show the globe without day/night. The
whole globe is lit uniformly. This loses the day/night effect but
removes the "dark side moves with the globe" perception.

### Recommendation
Keep as-is (Option A) — it's correct. If the user wants to see the
Earth rotate, offer Option B (animate the clock) as a toggle.

---

## Issue 2: Land color not matching Google Earth

### What the user sees
"the land in the globe is not according to the google.earth at all"
"make the land color accurate and neat"

### Root causes (from research)

1. **Cesium applies gamma 1.3 to Bing Maps Aerial** — this is the
   default for the "aerial" and "aerial with labels" map styles. It
   makes the imagery look "washed out" compared to Google Earth. This
   was confirmed in Cesium GitHub issue #3279: "Cesium applies a gamma
   of 1.3 to Bing Maps satellite layers. It probably made sense at one
   point, but IMO it doesn't anymore."

2. **Google Earth uses proprietary imagery** — Google retains the
   highest quality level of their satellite data for their own use.
   The data available via APIs (including Cesium ion's Bing Maps) is
   lower quality than what Google Earth shows internally.

3. **SSE=2 default means less detail** — Cesium's default
   `maximumScreenSpaceError = 2` means image texels map to between 1
   and 2 screen pixels, so there's less detail compared to a 2D map
   where SSE is effectively 1.

4. **Web Mercator → Geographic reprojection** — Cesium reprojects
   imagery from Web Mercator to Geographic, then unprojects it onto
   the globe. This extra step introduces some blurring.

### Options to fix

#### Option A: Fix the gamma on the existing Bing layer (quick win)

Set the base imagery layer's gamma to 1.0 (instead of the default 1.3
that Bing Maps Aerial uses). This immediately removes the "washed out"
look.

```js
const baseLayer = viewer.imageryLayers.get(0);
baseLayer.gamma = 1.0;
baseLayer.brightness = 1.1;  // slight brightness boost
baseLayer.contrast = 1.1;    // slight contrast boost
```

**Pros:** one-line change, immediate visual improvement, keeps the
existing Bing Maps imagery (which is high-resolution satellite data).
**Cons:** still uses Bing Maps, which is different from Google Earth's
proprietary imagery.

#### Option B: Replace with NASA GIBS MODIS Terra True Color

Use NASA GIBS MODIS Terra Corrected Reflectance True Color as the base
imagery layer. This is the "NASA Blue Marble" look — natural colors,
blue oceans, green/brown land. Free, no API key, no token, CORS-enabled,
tile-based.

```js
const provider = new Cesium.WebMapTileServiceImageryProvider({
  url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?TIME=2024-06-15',
  layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
  style: 'default',
  format: 'image/jpeg',
  tileMatrixSetID: '250m',
  maximumLevel: 8,
  tilingScheme: createGibsTilingScheme(), // same as night-lights.ts
});
```

**Pros:** natural satellite colors (blue oceans, realistic land),
free, no token, matches the "NASA Blue Marble" aesthetic that many
globe visualizations use.
**Cons:** lower resolution than Bing Maps at close zoom (250m/pixel
max vs Bing's 15cm/pixel in urban areas). Better for the space/global
view, worse for street-level detail. For an ocean-focused platform
that primarily shows the globe from space, this is actually fine.

#### Option C: Use Cesium ion "Google Maps 2D Satellite with Labels"

Cesium ion asset 3830183 — Google Maps satellite imagery with labels.
This is closer to Google Earth's look since it uses Google's own
imagery.

```js
const viewer = new Cesium.Viewer(container, {
  baseLayer: Cesium.ImageryLayer.fromProviderAsync(
    Cesium.IonImageryProvider.fromAssetId(3830183)
  ),
});
```

**Pros:** uses Google's own imagery, closest to Google Earth.
**Cons:** requires a Cesium ion account/token, uses ion request quota.

#### Option D: Combine — GIBS for the global view, Bing for close zoom

Use GIBS MODIS as the base layer (great from space) and add Bing Maps
as a higher-detail layer that fades in as you zoom closer.

**Pros:** best of both worlds — natural colors from space, high
detail when zoomed in.
**Cons:** more complex, two layers to manage.

### Recommendation

For an ocean-focused platform:
1. **Immediate:** Option A (fix gamma) — removes the washed-out look
   with minimal change.
2. **Next:** Option B (GIBS MODIS Terra) — gives the natural NASA Blue
   Marble look with blue oceans, which is ideal for an ocean
   visualization platform. The 250m resolution is fine for the
   global/regional views we'll be using.
3. **Optional:** Option D (hybrid) if we need both global beauty and
   close-zoom detail later.

---

## Decisions made (implemented)

- **Land color:** NASA GIBS `BlueMarble_NextGeneration` (Option B),
  found via the GIBS EPSG:4326 WMTS Capabilities XML — a dedicated,
  cloud-free, seasonal true-color layer (separate from the daily MODIS
  feed), tile matrix set `500m`, format `image/jpeg`, no `TIME`
  parameter needed (static dataset). This replaces the default Bing
  Maps Aerial base layer entirely (removed at index 0, GIBS layer
  added in its place) — see `src/cesium/base-imagery.ts`.
- **Day/night:** Option B (animate clock) — `shouldAnimate = true`,
  `multiplier = 200` (~72 real minutes per simulated day). The sun
  direction stays fixed in space; the Earth's simulated rotation
  advances, sweeping the terminator across the surface over time,
  independent of camera movement — see `src/cesium/config.ts`.
- Extracted the shared GIBS EPSG:4326 tiling scheme (non-power-of-2
  tile grid) into `src/cesium/gibs-tiling-scheme.ts` so both the
  night-lights layer and the new base imagery layer use the same
  verified implementation.

## Implementation plan

### Phase 1: Fix the gamma (immediate, Option A)

In `config.ts`, after viewer creation:
```js
const baseLayer = viewer.imageryLayers.get(0);
if (baseLayer) {
  baseLayer.gamma = 1.0;    // remove the 1.3 washed-out gamma
  baseLayer.brightness = 1.1;
  baseLayer.contrast = 1.1;
}
```

### Phase 2: Replace base imagery with NASA GIBS MODIS Terra (Option B)

Create `src/cesium/base-imagery.ts`:
- GIBS MODIS Terra Corrected Reflectance True Color
- Same GIBS tiling scheme as night-lights.ts
- Remove the default Bing Maps layer
- Add GIBS as the new base layer

### Phase 3: Day/night — keep as-is, offer clock animation toggle

The current behavior is correct. If the user wants to see the Earth
rotate under a fixed sun, we can add a toggle that enables clock
animation (`shouldAnimate = true`, `multiplier = 100`).

---

## Sources

- Cesium issue #3279 (gamma 1.3 on Bing Maps):
  https://github.com/CesiumGS/cesium/issues/3279
- Cesium BingMapsImageryProvider docs (defaultGamma = 1.3 for aerial):
  https://cesium.com/learn/cesiumjs/ref-doc/BingMapsImageryProvider.html
- Cesium ImageryLayer docs (gamma, brightness, contrast):
  https://cesium.com/learn/cesiumjs/ref-doc/ImageryLayer.html
- NASA GIBS access basics:
  https://nasa-gibs.github.io/gibs-api-docs/access-basics/
- NASA GIBS Cesium examples:
  https://github.com/nasa-gibs/gibs-web-examples
- Cesium blog: NASA GIBS integration:
  https://cesium.com/blog/2015/06/30/nasa-gibs
- Google Earth navigation docs (camera orbit, not globe rotation):
  https://developers.google.com/maps/documentation/earth/navigate-the-globe
- Google Earth Studio docs (Time of Day):
  https://earth.google.com/studio/docs/advanced-features/special-attributes/
