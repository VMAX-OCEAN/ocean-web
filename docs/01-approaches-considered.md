# Approaches Considered

For each subsystem below: what alternatives we evaluated, which one we
picked, and why. "Currently used" marks the live implementation.

---

## 1. Globe rendering engine

| Approach | Description | Verdict |
|---|---|---|
| **Three.js custom globe** | Hand-built sphere + shaders (day/night texture blend, cloud shell, atmosphere rim) — the original prototype direction. | Rejected for the production path. No terrain, no imagery streaming/LOD, no camera controller — all would need to be built from scratch to match Google Earth's smoothness and geographic accuracy. Still useful as a reference for shader techniques (see doc 04). |
| **CesiumJS** ✅ currently used | Purpose-built geospatial engine: terrain, quadtree imagery streaming, LOD, camera controller, atmosphere, lighting — all built in. | **Chosen.** Directly solves the "accurate globe + smooth zoom + no reinventing geospatial infrastructure" requirement. Open source, works entirely in-browser, has a free tier (Cesium ion default token) sufficient for World Terrain + Bing imagery. |
| **Google Earth's own engine (Wasm/C++)** | Google Earth Web is C++ compiled to WebAssembly (originally Native Client), with quadtree imagery, octree 3D meshes, and clip-mapped "Universal Texture." Documented in `GOOGLE-EARTH-ANALYSIS.md`. | Not reusable — proprietary, not available as a library. Used only as the **behavioral reference** we compare against (smoothness, LOD strategy, imagery quality), not as something we could adopt directly. |

---

## 2. Land/ocean base imagery (what colors the globe's surface)

| Approach | Description | Verdict |
|---|---|---|
| **Cesium default (Bing Maps Aerial via ion)** | What `new Cesium.Viewer()` uses out of the box. | Rejected as the base layer. Cesium applies a `gamma = 1.3` correction to Bing Aerial by default (a long-standing Cesium default, tracked in Cesium issue #3279) which makes colors look flat/washed-out compared to Google Earth's natural saturation. |
| **Fix Bing's gamma manually** (`layer.gamma = 1.0`) | Keep Bing imagery, just cancel the washed-out correction. | Considered, not used. Would have kept Bing's very high resolution (down to 15cm in cities) but still uses a different visual dataset/processing pipeline than Google Earth, and doesn't address that we specifically wanted the "whole-Earth-from-space" natural-color look, not street-level aerial detail. |
| **Cesium ion "Google Maps 2D Satellite" (asset 3830183)** | Google's own satellite imagery, served through Cesium ion. | Considered, not used. Closest visual match to Google Earth since it's literally Google's imagery, but requires a Cesium ion account/token and consumes ion's request quota — an unnecessary dependency for a globe that's meant to run on free tiers. |
| **NASA GIBS `BlueMarble_NextGeneration`** ✅ currently used | A cloud-free, seasonal, true-color MODIS composite (500m/px), served as WMTS tiles directly from NASA — no API key, no token, no quota. Verified layer id from the live GIBS WMTS Capabilities XML. | **Chosen.** Free forever, no account needed, tile-based (progressive loading, correct pole handling — no giant single-texture download), and gives the natural blue-ocean / green-brown-land "Blue Marble" look that most whole-Earth visualizations (including the conceptual lineage of Google's own early basemaps) use. Trade-off: lower max resolution than Bing (500m vs down to 15cm), which is the right trade for a platform that's primarily a global/regional ocean viewer, not a street-level map. |
| **NASA GIBS daily `MODIS_Terra_CorrectedReflectance_TrueColor`** | The *daily* MODIS true-color feed (as opposed to the pre-processed monthly Blue Marble composite). | Rejected. Same GIBS infrastructure, but each day's pass has real clouds and occasional snow/cloud misclassification baked into the image — not suitable as a *base* layer (that's what our separate animated cloud layer is for). |
| **Hybrid (GIBS global + Bing at close zoom)** | Use GIBS from space, fade in Bing detail when zoomed close. | Deferred, not implemented. More complex (two providers, a fade transition) for a benefit (street-level detail) that isn't yet a requirement for an ocean-data platform. Worth revisiting if we ever need coastline/port-level zoom detail. |

---

## 3. Cloud layer

| Approach | Description | Verdict |
|---|---|---|
| **Translucent ellipsoid shell + equirectangular texture** ✅ currently used | A second, slightly-larger `EllipsoidGeometry` primitive, textured with a real cloud-alpha PNG (matteason/live-cloud-maps, refreshed every 3h), rotated independently of the Earth for a drift effect. | **Chosen** as the pragmatic starting point: one texture, one primitive, easy to alpha-fade by altitude. Known limitations (documented, partially mitigated — see below): equirectangular UV pinching at the poles, and no per-pixel LOD (it's one texture at one resolution regardless of zoom). |
| **Tiled cloud imagery layer** (NOAA GIBS cloud product as an `ImageryLayer`) | Treat clouds like any other quadtree-tiled imagery layer on the globe surface. | Considered for a future iteration (see `google-earth-darkside-clouds-research.md` in `ocean-docs`). Would fix pole pinching at the source (tiling schemes handle poles specially) and enable zoom-adaptive detail, but couples clouds to the terrain surface (loses the independent "cloud drift" rotation) and requires picking/validating the right GIBS layer. Not yet implemented. |
| **Custom globe `CustomShader` sampling clouds + casting shadows** | Sample a cloud density texture inside the globe's own fragment shader, so clouds can cast real shadows on the terrain below (what Google Earth Studio does). | Deferred — most implementation effort for a benefit (ground-shadow realism) that matters more for land than for an ocean-focused platform. Revisit if visual fidelity requirements grow. |

### Cloud sub-decisions actually shipped

- **Texture resolution:** 4096×2048 → **2048×1024**. ~4x fewer pixels
  to download/decode; imperceptible difference at the altitudes where
  clouds are visible, meaningfully faster first load.
- **Geometry tessellation:** 64×64 → **24×48** (stack×slice). A cloud
  shell has no hard silhouette to resolve, so it doesn't need dense
  tessellation — roughly halves vertex count.
- **Lighting on the cloud shell:** tried enabling per-fragment
  Lambertian lighting (`flat: false`) so clouds would darken on the
  night side realistically — **reverted**. `EllipsoidGeometry`'s
  pole vertex has degenerate normals, and lighting math on those
  normals produced a visible dark blob with radiating streaks at the
  pole. Now **flat-shaded** (`flat: true`, no lighting at all), which
  removes the artifact at its source and matches the rest of the
  globe (see section 4 below — lighting is off everywhere now).
- **Pole "pinwheel" *texture* artifact** (separate from the lighting
  artifact above — this is the equirectangular UV pinch itself):
  mitigated with a latitude-based alpha fade in the material shader
  (`|latitude| > ~80°` → alpha fades to 0), hiding the pinch rather
  than eliminating the underlying single-texture-on-a-sphere
  limitation. A full fix requires switching to tiled imagery (see
  above).
- **Load scheduling:** cloud layer creation deferred via
  `requestIdleCallback` (with a `setTimeout` fallback) so the globe,
  terrain, and base imagery get uncontested network/CPU priority
  during first paint; clouds load in afterward.

---

## 4. Day/night lighting and the sun-locked terminator

| Approach | Description | Verdict |
|---|---|---|
| **No lighting at all** (uniform brightness) — original Cesium default before we touched it | The globe is lit flat everywhere; no terminator, no dark side. | This is what we started with, then moved away from (to add realism), then **returned to** — see the final row below. |
| **`Globe.enableLighting = true` + real sun position** | Cesium's built-in sun-tracking Lambertian shading — physically accurate, sun direction fixed in space (ECEF), terminator stays fixed on the globe's surface as the camera orbits. | Implemented, then removed. It was *correct* (this is genuinely how Google Earth's own terminator behaves — camera orbits a globe with a sun-locked terminator, it doesn't rotate to follow the camera), but two problems made it read as broken rather than realistic: (1) the night side had no city-lights texture, so it was just a flat black region, which visually reads as a rendering bug rather than "nighttime"; (2) it exposed the cloud-shell pole-lighting artifact described in section 3. |
| **+ NASA GIBS `VIIRS_Black_Marble` night-lights layer** (`dayAlpha=0`/`nightAlpha=1`) | Compositing a city-lights texture that only shows on the night side, using Cesium's built-in day/night-alpha imagery blending — the same technique Google Earth Studio uses (its docs describe exactly this: a night texture that fades in at high altitude). | Implemented, then removed along with the lighting it depended on. Was working correctly in isolation, but became moot once lighting was turned off (a night-lights layer has nothing to attach to without a day/night split). Code (`night-lights.ts`) is left in the repo, unused, in case lighting is revisited. |
| **Animate the simulation clock so the terminator visibly sweeps the globe** | `clock.shouldAnimate = true`, `multiplier = 200` — since the sun is fixed in space, advancing simulated time advances the Earth's rotation relative to it, sweeping the terminator across the surface independent of camera movement (the "watch the Earth turn" effect). | Implemented, then reverted along with lighting. Was the right fix for the *specific* complaint "the dark side moves when I move the globe" (that complaint was actually describing correct sun-locked behavior, and animating time gives the intended visual instead). Reverted only because the decision was made to remove day/night lighting entirely, not because this approach itself was wrong. |
| **Lighting fully OFF everywhere** ✅ currently used | `enableLighting = false`, `dynamicAtmosphereLighting = false`, `dynamicAtmosphereLightingFromSun = false`. Globe and clouds both flat-shaded. Clock frozen (no terminator to animate). | **Chosen**, as an explicit simplification. Removes the pole-lighting artifact at its root (no lighting math run on the cloud shell's degenerate pole normals = no artifact), and removes the "why is half the globe dark" question entirely. Trade-off: gives up the physically-accurate day/night visual Google Earth has. This is a deliberate, revisitable decision — see `CLOUD-WEDGE-FIX-PLAN.md` for the full reasoning, and `night-lights.ts` / the git history of `config.ts` for how to bring it back if the artifact is fixed a different way (e.g. tiled cloud imagery from section 3, which has no pole singularity to begin with). |

---

## 5. Zoom / camera interaction

| Approach | Description | Verdict |
|---|---|---|
| **Cesium's default trackpad/wheel handling** | Out-of-the-box `ScreenSpaceCameraController` wheel zoom. | Insufficient alone: a trackpad pinch gesture arrives as a `wheel` event with `ctrlKey: true`, which browsers intercept by default as "zoom the whole webpage," never reaching Cesium's canvas handler. |
| **`event.preventDefault()` on all wheel events over the canvas** ✅ currently used | Explicitly block the browser's page-zoom interpretation so the gesture reaches Cesium's own camera controller. | **Chosen** — fixes the trackpad case without needing to hand-roll zoom math. |
| **On-screen +/− buttons** ✅ currently used (as a fallback) | `ZoomControls.tsx`, calling a small `zoomBy(viewer, factor)` helper (`camera.zoomIn`/`zoomOut` by a fraction of current altitude). | **Chosen as a safety net** — guarantees zoom always works regardless of trackpad/OS/browser gesture quirks we can't fully predict or test for across every user's hardware. |
