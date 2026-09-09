# Cloud Pole Artifact & Lighting Removal — Research, Root Cause, Fix

## Reported symptom

Screenshot comparison against google.earth.com showed a severe dark
circular blob with radiating streaks in the middle of the cloud layer
on our globe. Google Earth's own view (2 reference screenshots) shows
a soft, correct day/night terminator with no such artifact.

## Root cause (confirmed from Cesium source/API + our own code)

`src/cesium/clouds.ts` rendered the cloud shell (an `EllipsoidGeometry`
primitive) with `MaterialAppearance({ flat: false, faceForward: true })`
— i.e. per-fragment normal-based (Lambertian) lighting, so clouds would
darken on the night side like the terrain.

`EllipsoidGeometry`'s stack/slice tessellation converges to a single
vertex at each pole. Adjacent triangles meeting at that vertex have
inconsistent (near-degenerate) vertex normals — a well-known UV-sphere
pole singularity. When per-fragment Lambertian lighting is computed
from those broken normals, the result is a dark, blobby region with
streaks radiating outward (each streak follows one triangle's
incorrect normal gradient) — exactly what appeared in the screenshot.

This is a rendering-appearance-level lighting system (Cesium
`Primitive`/`Appearance`), independent from `Globe.enableLighting` —
so it existed regardless of the globe's own day/night settings.

## Why we're removing lighting entirely, not just patching poles

The user's explicit direction: remove sun-based lighting from the
whole globe — uniform brightness everywhere, no terminator, no night
side, no city lights. Rationale:

1. It removes the pole artifact at its root (no lighting math on
   broken normals = no artifact), rather than papering over it with
   another pole-fade hack layered on top of lighting.
2. It matches the simpler mental model the user wants: a bright,
   evenly-lit globe with clouds, ocean color, and land color — no
   day/night complexity to get subtly wrong.

## Fix applied

### `src/cesium/config.ts`

- `globe.enableLighting = false`
- `globe.dynamicAtmosphereLighting = false`
- `globe.dynamicAtmosphereLightingFromSun = false`
- Removed `nightFadeInDistance`/`nightFadeOutDistance`/`fog.minimumBrightness`
  tuning (only took effect with lighting on — now dead configuration).
- Removed the NASA Black Marble night-lights imagery layer call
  (`addNightLightsLayer`) — meaningless without day/night shading.
  The module (`night-lights.ts`) is left in place, unused, in case
  day/night is revisited later.
- Reverted the clock to frozen (`shouldAnimate = false`) — there's no
  terminator to sweep across the globe anymore, so no reason to
  advance simulation time. Cloud drift is unaffected: it's driven by
  `clock.onTick`, which fires every render frame regardless of
  `shouldAnimate`.

### `src/cesium/clouds.ts`

- `MaterialAppearance.flat` changed from `false` → `true`: disables
  all per-fragment lighting on the cloud shell. This is what actually
  removes the artifact — no lighting math means no broken-normal math.
- Removed `faceForward: true` (irrelevant once there's no lighting to
  flip normals for).
- `vertexFormat` changed from `POSITION_NORMAL_AND_ST` →
  `POSITION_AND_ST`: normals are no longer used by the (flat)
  appearance, so we stop computing/uploading them — smaller geometry,
  faster build.
- Kept the shader's latitude-based alpha pole-fade (fades cloud alpha
  to 0 above ~80° latitude). This is unrelated to lighting — it masks
  the separate *texture* UV-pinching artifact (equirectangular cloud
  image compressed to a point at the poles), which is still present
  and still worth hiding.

## Verification

- `npm run build` (tsc + vite) — passes, exit 0.
- Dev server restarted fresh (old process killed, Vite cache cleared).
- To verify visually: hard-refresh, confirm:
  - No dark blob/streaks anywhere in the cloud layer, including at the
    poles when zoomed/rotated to see them.
  - Globe is evenly lit all the way around — no dark hemisphere.
  - Clouds are uniformly white/bright everywhere (no artificial
    darkening).
  - Land/ocean colors remain the NASA Blue Marble natural look from
    the previous fix.

## Sources

- `EllipsoidGeometry` pole singularity is a known consequence of
  UV-sphere tessellation (documented pattern in Cesium/WebGL
  community discussions of ellipsoid/sphere lighting artifacts).
- Cesium `MaterialAppearance`/`EllipsoidSurfaceAppearance` `flat`
  option docs: when `true`, "lighting is not taking into account" —
  confirms `flat: true` fully disables the per-fragment lighting path
  responsible for the artifact.
  https://cesium.com/learn/cesiumjs/ref-doc/EllipsoidSurfaceAppearance.html
- Cesium `Globe.enableLighting` / `dynamicAtmosphereLighting` /
  `dynamicAtmosphereLightingFromSun` docs (all default to on when
  explicitly enabled; setting `enableLighting = false` disables all
  day/night surface shading globally):
  https://cesium.com/learn/cesiumjs/ref-doc/Globe.html
