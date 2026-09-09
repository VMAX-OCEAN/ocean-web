# Load Performance & WebGL Context Leak — Plan

## Symptoms

1. **Console spam:** `WARNING: Too many active WebGL contexts. Oldest context will be lost.`
   repeated 20+ times.
2. **30+ second load:** the globe never reaches a usable state.

## Root causes

### A. WebGL context leak (critical — causes both symptoms)

`src/components/CesiumViewer.tsx` line 44:

```tsx
useEffect(() => { ...create viewer... }, [onReady, onError]);
```

`src/App.tsx` passes `onReady` and `onError` as **inline arrow functions**,
so every render of `App` produces new function references. The effect's
dependency array sees "new" deps on every render → the effect re-runs →
a new `Cesium.Viewer` is created → the old one is torn down. Worse,
`onReady` itself calls `setLoading(false)`, which re-renders `App`,
which creates new inline callbacks, which re-runs the effect — a
self-perpetuating loop that keeps spinning up new WebGL contexts and
never lets the globe settle.

This is the classic React inline-callback-in-deps anti-pattern.

### B. Slow first paint (compounds A)

`src/cesium/config.ts` lines 30-37 `await`s
`Cesium.Terrain.fromWorldTerrain()` **before** constructing the
`Cesium.Viewer`. The globe cannot render a single frame until the ion
terrain asset resolves over the network. On a cold cache this is several
seconds; combined with the context-leak loop restarting the viewer
repeatedly, it never converges.

### C. Aggressive initial tile budget

- `maximumScreenSpaceError = 1.5` (default is 2; lower = more tiles).
- `preloadAncestors = true` and `preloadSiblings = true` both on from
  frame zero, so Cesium loads far more than the visible tiles before
  the user has even seen the globe.

## Fixes

### Fix 1 — Stop the effect loop (critical)

Use the **ref pattern** so the effect runs exactly once on mount, while
still allowing the parent to update its callbacks without re-running the
effect:

```tsx
// In CesiumViewer.tsx
const onReadyRef = useRef(onReady);
const onErrorRef = useRef(onError);
onReadyRef.current = onReady;
onErrorRef.current = onError;

useEffect(() => {
  // use onReadyRef.current?.() inside the promise
  ...
}, []); // empty deps — run once
```

This is the standard React idiom for "call a prop callback from an
effect that should only run once."

### Fix 2 — Decouple terrain from viewer creation

Create the `Viewer` immediately with `terrain: undefined` (smooth
WGS84 ellipsoid), so the globe paints within a frame or two. Then kick
off `Terrain.fromWorldTerrain()` in the background and assign it via
`viewer.terrainProvider` once it resolves. The user sees a globe
instantly; terrain detail pops in as it arrives — exactly the
progressive-load behavior Google Earth uses.

### Fix 3 — Stage the LOD aggressiveness

- Start with `maximumScreenSpaceError = 4` (coarse but fast first paint).
- After the first real render, lower it to `2` (default quality).
- Keep `1.5` available as a "high quality" toggle for later, but not
  as the initial load setting.
- Leave `preloadAncestors`/`preloadSiblings` on (they help panning) but
  only after first paint — they're not the main culprit, Fix 1 + Fix 2
  are.

### Fix 4 — Guard against double-init in StrictMode (dev only)

React 18 StrictMode double-invokes effects in development. The existing
`destroyed` flag handles the async case, but we should also make the
cleanup robust: if a second effect run starts before the first viewer
resolves, the first viewer must still be destroyed when it resolves.
The existing code already does this; just ensure the ref pattern
preserves it.

## Files to change

| File | Change |
|---|---|
| `src/components/CesiumViewer.tsx` | Ref pattern for callbacks; empty deps; ensure cleanup destroys viewer |
| `src/cesium/config.ts` | Create viewer with `terrain: undefined`; attach terrain async; staged SSE |
| `src/App.tsx` | (Optional) wrap callbacks in `useCallback` for clarity, though the ref pattern makes this unnecessary |

## Verification

1. `npm run build` passes.
2. Hard-refresh `http://localhost:5173/`.
3. **No** "Too many active WebGL contexts" warnings in the console.
4. Globe becomes visible within ~1–2 seconds (ellipsoid first, terrain
   pops in).
5. Cloud layer still renders, fades with altitude, darkens on night side.
6. Touchpad zoom, wheel zoom, and on-screen zoom buttons still work.
7. No regressions in lighting or pole appearance.

## Addendum: stale dev-server bundle + further optimization pass

### The `.then is not a function` error was a stale-bundle artifact

After Fix 2 was implemented, a screenshot showed:
```
Cesium.Terrain.fromWorldTerrain(...).then is not a function
```
This looked like a regression, but it was actually the *previous*,
already-superseded version of `config.ts` (the one that briefly called
`.then()` directly on the `Terrain` object before being corrected to use
`.readyEvent`/`.errorEvent`). The **npm run dev** process (PID captured
via `netstat -ano | findstr :5173`) had not picked up the fix — Vite's
dependency pre-bundle cache (`node_modules/.vite`) and/or a long-lived
dev server process from earlier in the session was serving a stale
bundle. This also explains why the globe showed no visible night side in
that screenshot: the exception aborted `createOptimizedViewer` partway
through, and while `enableLighting` had already been set, the aborted
promise meant `onReady` never fired cleanly and the render loop was in
an inconsistent state.

**Fix:** killed the stale dev server process, cleared
`node_modules/.vite`, and restarted `npm run dev` fresh. Confirmed
`npm run build` (tsc + vite) passes with exit code 0 on the current
source before restarting, so the running server is now guaranteed to
match the file contents on disk.

**Lesson for future changes to `cesium/config.ts` or `cesium/clouds.ts`:**
after any edit, prefer restarting the dev server (or at least hard
verifying via `npm run build`) rather than trusting HMR for Cesium
material/shader changes — Cesium's shader compilation and material
caching don't always interact cleanly with Vite HMR.

### Further optimizations applied (extreme-fast-runtime pass)

| Change | File | Why |
|---|---|---|
| Cloud texture: 4096×2048 → 2048×1024 | `clouds.ts` | ~4x fewer pixels to download/decode; imperceptible difference at the altitudes where clouds are visible (>500km) |
| Cloud shell tessellation: 64×64 → 24×48 (stack×slice) | `clouds.ts` | Cloud shell has no hard silhouette; roughly halves vertex count for the geometry build |
| Cloud shell geometry: `asynchronous: false` → `true` | `clouds.ts` | Geometry tessellation now happens on a web worker instead of blocking the main thread |
| Cloud layer creation deferred via `requestIdleCallback` | `CesiumViewer.tsx` | `onReady` (which clears the loading UI) now fires as soon as the *globe* is ready; the cloud texture fetch + geometry build happen after the browser is idle, so they don't compete with critical terrain/imagery requests for bandwidth/CPU during first paint |

These are layered on top of the earlier Fix 1 (WebGL context leak — the
actual root cause of "Too many active WebGL contexts" and the 30s+
non-terminating load) and Fix 2/3 (async terrain attach + staged LOD).
Fix 1 was the dominant cost; these are incremental refinements on top of
an already-fixed load path.
