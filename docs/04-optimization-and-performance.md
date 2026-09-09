# Optimization & Performance

Every performance/correctness problem found so far, its root cause,
and the fix. Ordered roughly by when each was found and by impact.

---

## 1. WebGL context leak → "Too many active WebGL contexts" (the dominant fix)

**Symptom:** the app never finished loading (30+ seconds, stuck), and
the browser console spammed `WARNING: Too many active WebGL contexts.
Oldest context will be lost.`

**Root cause:** `App.tsx` passed **inline** callbacks to
`CesiumViewer` (`onReady={(v) => {...}}`, `onError={(msg) => ...}`).
Every parent re-render created new function references for those
props. `CesiumViewer.tsx`'s viewer-initialization `useEffect` listed
those callbacks in its dependency array, so React re-ran the effect
on every render — destroying and recreating the Cesium `Viewer` (and
its WebGL context) in a loop. Calling `onReady` inside that effect
triggered a parent state update (`setLoading(false)`), which caused
another render, which created new callback references, which reran
the effect again — a self-sustaining loop.

**Fix:**
- Store the latest `onReady`/`onError` in refs (`onReadyRef.current =
  onReady` on every render, but the ref *object* is stable).
- Give the initialization `useEffect` an **empty dependency array**
  so it runs exactly once per mount; read callbacks from the refs
  inside it.
- Keep a `destroyed` flag so a viewer that finishes constructing
  asynchronously *after* unmount is destroyed immediately instead of
  leaking.

**Impact:** this was the single largest fix in the whole project —
everything else was incremental on top of an already-broken load
path. Without it, no other optimization mattered.

---

## 2. Terrain blocking first paint

**Symptom:** the globe didn't render at all until Cesium World
Terrain had finished its initial fetch — meaning the very first thing
the user saw was a blank/loading screen for as long as the terrain
request took.

**Root cause:** the viewer was originally constructed with
`terrain: Cesium.Terrain.fromWorldTerrain(...)` passed directly into
the `Viewer` constructor options, making terrain readiness a
precondition for the first render.

**Fix:** construct the `Viewer` with `terrain: undefined` (renders
the bare WGS84 ellipsoid + imagery immediately), then attach
`Cesium.Terrain.fromWorldTerrain()` to the scene **after** the viewer
exists, via `scene.setTerrain(terrain)`. Terrain data streams in over
`terrain.readyEvent` non-blocking; the globe is visibly interactive
long before any terrain tile has arrived.

**A related API-misuse bug found while doing this:** the installed
Cesium version's `Terrain.fromWorldTerrain()` returns a `Terrain`
object *synchronously*, not a `Promise` — code that called
`.then()` on it threw `Cesium.Terrain.fromWorldTerrain(...).then is
not a function`. Fixed by using the `readyEvent`/`errorEvent`
listeners instead of a promise chain. (This error resurfaced once
after the fix was already applied, because a stale Vite dev-server
process/cache was still serving the pre-fix bundle — resolved by
killing the dev server, clearing `node_modules/.vite`, and
restarting. Lesson recorded for future Cesium shader/material edits:
prefer a full dev-server restart over trusting HMR, since Cesium's
shader/material compilation doesn't always interact cleanly with
Vite's hot module replacement.)

---

## 3. Staged level-of-detail (screen-space error)

**What:** `maximumScreenSpaceError` starts at `4` (coarse — first
paint only needs a handful of low-detail tiles) and is lowered to `2`
(Cesium's normal default quality) 1.5 seconds after terrain becomes
ready, once the coarse tiles have had time to settle.

**Why the delay:** dropping SSE immediately on terrain-ready would
trigger a second wave of high-detail tile requests while the coarse
wave was still in flight, competing for the same request budget.
Letting the coarse pass finish first, then refining, avoids that
request-pressure spike.

**Related:** `preloadAncestors` / `preloadSiblings` are both enabled,
so navigating the camera doesn't produce visible gaps while adjacent
tiles catch up — a standard Cesium tuning knob, kept at its
recommended-for-smoothness setting rather than the bandwidth-optimized
default.

---

## 4. HTTP/2 request ceiling

**What:** `Cesium.RequestScheduler.requestsByServer['assets.ion.cesium.com:443']
= 30` (Cesium's default is 18 requests/server).

**Why:** Cesium's default concurrent-request limit per server was
tuned for HTTP/1.1's connection-per-request model. Cesium ion serves
over HTTP/2, which multiplexes many requests over one connection and
has no such practical ceiling — so the default was needlessly
throttling tile throughput during bursts (e.g. right after a large
camera move).

---

## 5. Cloud layer cost reduction

Three separate cuts, each independently measurable:

| Change | Before | After | Why |
|---|---|---|---|
| Texture resolution | 4096×2048 | 2048×1024 | ~4x fewer pixels to download+decode; imperceptible at cloud-visible altitudes (>8,000km), meaningfully faster on a connection that's simultaneously fetching terrain+imagery tiles. |
| Geometry tessellation | 64×64 (stack×slice) | 24×48 | A translucent shell has no hard silhouette to resolve — roughly halves vertex count and synchronous geometry-build cost. |
| Geometry build mode | synchronous | `asynchronous: true` | Moves tessellation onto a web worker instead of blocking the main thread during construction. |

**Also:** cloud-layer *creation itself* (not just its assets) is
deferred via `requestIdleCallback` (with a `setTimeout(…, 300)`
fallback for browsers without it) until after `onReady` fires — so
the critical first-paint path (globe + terrain + base imagery) gets
uncontested network and CPU priority, and clouds load in afterward
without the user perceiving a delay in the globe becoming usable.

---

## 6. Cloud shell lighting removed → fixed a real rendering artifact, not just a performance issue

**Symptom:** a dark blob with radiating streaks appeared in the cloud
layer, most visible at the poles.

**Root cause:** the cloud shell had per-fragment normal-based
(Lambertian) lighting enabled (`MaterialAppearance({ flat: false
})`) so clouds would visually darken on a night side. `EllipsoidGeometry`'s
stack/slice tessellation converges to a single vertex at each pole,
where adjacent triangles have degenerate/inconsistent normals — a
known UV-sphere singularity. Lighting math evaluated against those
broken normals produced the artifact.

**Fix, and its performance side-effect:** switched the cloud
appearance to `flat: true` (no lighting at all — consistent with
disabling lighting globally, see doc 01 §4) and dropped the `NORMAL`
vertex attribute from the geometry's `vertexFormat` entirely (only
`POSITION_AND_ST` is needed once nothing consumes normals). This
removes the artifact **and** trims per-vertex data and the
per-fragment lighting branch — a rare case where the correctness fix
and the performance win were the same change.

---

## 7. Build-time hygiene

**Found:** stray generated files committed to the working tree —
`vite.config.js`, `vite.config.d.ts`,
`vite.config.js.timestamp-*.mjs`, `tsconfig.tsbuildinfo`,
`tsconfig.node.tsbuildinfo` — artifacts of `tsc` being pointed at (or
including) `vite.config.ts` and emitting a compiled duplicate
alongside the real source, plus TypeScript's incremental build cache.

**Fix:** deleted the stray files and added patterns to `.gitignore`
(`*.tsbuildinfo`, `vite.config.js`, `vite.config.d.ts`,
`vite.config.js.timestamp-*.mjs`) so they can't be accidentally
committed again. `vite.config.ts` remains the single source of truth
for Vite configuration; `npm run build` (`tsc -b && vite build`) does
not need or use a compiled `.js` copy of it.

---

## Summary table

| # | Problem | Category | Status |
|---|---|---|---|
| 1 | WebGL context leak (React effect re-run loop) | Correctness + perf (blocking) | Fixed |
| 2 | Terrain blocking first paint / `.then()` API misuse | Perf (first paint) + correctness | Fixed |
| 3 | No staged LOD | Perf (perceived load time) | Fixed |
| 4 | HTTP/2 request ceiling too low | Perf (tile throughput) | Fixed |
| 5 | Oversized cloud texture/geometry, blocking creation | Perf (first paint contention) | Fixed |
| 6 | Cloud shell pole lighting artifact | Correctness (visual bug) + minor perf | Fixed |
| 7 | Stray build artifacts in the working tree | Repo hygiene | Fixed |
