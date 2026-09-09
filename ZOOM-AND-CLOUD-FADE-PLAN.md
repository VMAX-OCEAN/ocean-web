# Touchpad Zoom Fix + Altitude-Based Cloud Fade — Plan

## Bug 1: Touchpad can rotate but not zoom

### Root cause

A laptop **touchpad** (not a touchscreen) never sends real multi-touch
`touchstart`/`touchmove` events to the browser. The OS translates trackpad
gestures into **synthetic mouse/wheel events** instead:

| Gesture | What the browser actually receives |
|---|---|
| Click + drag | Real mouse `mousedown`/`mousemove` — this is why rotation works |
| Two-finger scroll | `wheel` event, `deltaY` set, `ctrlKey: false` |
| Pinch (zoom gesture) | `wheel` event, `deltaY` set, **`ctrlKey: true`** (Chrome/Edge/Firefox convention on both Windows precision touchpads and MacBook trackpads) |

Cesium's camera controller listens for `CameraEventType.WHEEL` (mouse wheel)
and `CameraEventType.PINCH` (real multi-touch). Since a touchpad pinch is
**not** a real multi-touch event, it never matches `PINCH`. It *should* still
arrive as a `wheel` event and match `WHEEL` — but browsers treat
`ctrlKey + wheel` as **"zoom the whole webpage"** by default. Unless that
default is explicitly prevented, the browser intercepts the gesture before
Cesium's canvas ever sees it — which matches exactly what you're
experiencing (rotation via mouse-emulated drag works, zoom via the
gesture-only path does not).

### Fix (3 parts, applied together)

1. **`touch-action: none` on the Cesium canvas container** — tells the
   browser "don't apply any of your own default touch/gesture handling
   here, let JavaScript handle it." This is the same fix used by Mapbox,
   Leaflet, and Google Maps for exactly this class of trackpad issue.

2. **Explicit `wheel` listener that always calls `preventDefault()`**,
   including the `ctrlKey: true` case — stops the browser's native
   page-zoom from intercepting the gesture, so it reaches Cesium's own
   handler cleanly.

3. **Fallback on-screen +/- zoom buttons** — guarantees zoom always works
   regardless of OS/browser/trackpad-driver quirks we can't fully predict
   or test for from here. Low-risk, always-available safety net.

### Verification step

If, after this fix, touchpad pinch still doesn't zoom, we'll add a temporary
console log of raw `wheel` event properties (`deltaY`, `deltaMode`,
`ctrlKey`) so we can see exactly what your specific hardware/OS/browser
combination is sending, rather than guessing further.

---

## Bug 2: Hide clouds when zoomed in (below ~500 km altitude)

### Behavior

- **Above 500 km altitude:** clouds fully visible (space/orbital view,
  matches the Google Earth reference)
- **Below 500 km altitude:** clouds fade out for a clear, unobstructed
  surface view
- **Transition band (500 km → 350 km):** smooth opacity fade rather than an
  abrupt on/off pop, so it feels polished rather than glitchy

### Implementation approach

- Check `viewer.camera.positionCartographic.height` every frame (cheap — a
  single number read, no extra computation)
- Map altitude to opacity:
  - `height >= 500,000 m` → `alpha = 1.0`
  - `height <= 350,000 m` → `alpha = 0.0`
  - in between → linear interpolation
- Update the cloud primitive's material `color.alpha` uniform directly
  (no geometry rebuild, just a cheap uniform write) — reuses the existing
  per-tick update loop already driving the cloud rotation

### Why 500 km / 350 km

- Matches your selected threshold (~500 km)
- 150 km transition band is wide enough to avoid a visible "pop," narrow
  enough that it doesn't feel laggy or delayed

---

## Files to change

| File | Change |
|---|---|
| `src/styles/light-theme.css` | Add `touch-action: none` to `.cesium-container` |
| `src/cesium/config.ts` | Add explicit wheel `preventDefault` handler; enable on-screen zoom buttons |
| `src/cesium/clouds.ts` | Add altitude-based alpha fade logic to the existing tick handler |

Implementing all three now.

---

## Addendum: Two accuracy bugs found after testing

After the first pass, screenshots revealed two real problems (not the plan
above — separate issues) with the cloud shell:

### A. Clouds stayed bright on the night side

**Cause:** the cloud shell's `MaterialAppearance` used `flat: true`, which
means "fully unlit — always show the raw material color." So clouds were
always full brightness, even directly over the pitch-black night side of the
globe, creating an obviously fake mismatch (bright white clouds floating
over solid black ocean/land).

**Fix:** switched the shell to normal-based lighting (`flat: false`,
`vertexFormat: POSITION_NORMAL_AND_ST`). Cesium's standard per-fragment
Lambertian shading now uses the same `scene.light` (the sun) that lights
the globe terrain, so clouds darken on the night side exactly like the
ground beneath them — consistent, physically coherent shading matching
Google Earth / NASA imagery.

### B. Pinwheel/starburst artifact at the poles

**Cause:** classic equirectangular-to-sphere UV pinching. At the poles, an
entire row of texture pixels collapses to a single 3D point, but adjacent
triangles still sample different longitude (U) values there — this
produces a radiating fan/starburst pattern wherever the texture has
high-frequency detail near the pole (exactly what a cloud/swirl texture
has). This is *why* Google Earth, NASA, and other production systems use
tiled quadtree imagery instead of one equirectangular texture stretched
over a raw sphere — their tiling schemes special-case the poles.

**Fix (pragmatic, not a full re-architecture):** fade the cloud alpha to
zero as latitude approaches ±90° (implemented as a `smoothstep` in the
material's fragment shader, based on the `st.t` texture coordinate, which
maps directly to latitude on our sphere). This removes the artifact at its
source — no cloud texture is sampled close enough to the pole singularity
to produce the fan pattern — while keeping the simpler shell-primitive
approach (which also gives us the independent rotation/"living" look) as
opposed to rebuilding clouds as a full custom `ImageryProvider`.

**Why not switch to an ImageryProvider instead?** That's the "fully
correct" architecture (same tiling Cesium uses for terrain/imagery, no pole
artifacts by construction) but imagery layers are UV-locked to the globe's
own surface — they'd rotate *with* the Earth, not independently, sacrificing
the drift/movement effect. Given the pole fade fully resolves the visible
artifact with much less risk and effort, we're keeping the shell-primitive
approach for now. If we need true tiled cloud imagery later (e.g., to layer
Argo/Glider data at the same fidelity as terrain), the same tiling pattern
can be revisited then.
