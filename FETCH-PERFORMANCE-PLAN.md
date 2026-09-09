# Fetch & Performance Plan — No Delay Loading

Plan for making tile/data fetching as fast and delay-free as possible, matching
Google Earth's "always loading ahead of you" feel. Covers both the base globe
(terrain/imagery) now, and ocean data (Zarr) later.

---

## The Core Problem (from Cesium community research)

By default, Cesium's `RequestScheduler` throttles requests to **18 per server**
(tuned for HTTP/1.1-era limits). During fast camera movement, this causes:

- Requests queue up for tiles you're flying *through*, not tiles you're
  flying *to*
- Many in-flight requests become irrelevant the moment the camera moves again
- The final view — where the camera settles — loads *last*, after wasted
  bandwidth on now-invisible tiles

**Real measured data from the Cesium team** (Sentinel-2 + World Terrain,
1920×1080 canvas):

| Metric | Default throttling (6/server) | HTTP/2-aware (18/server) |
|---|---|---|
| Time to render (Grand Canyon) | 3686 ms | Faster |
| Attempted requests | 8861 | Same workload |
| Cancelled requests | 3087 (35%) | Fewer wasted |
| Throttled % | 95.4% | Lower |

Cesium ion already serves over HTTP/2, so raising the per-server limit (rather
than leaving Cesium's older HTTP/1.1-era default) is a proven, low-risk win.

---

## Phase A: Base Globe (Terrain + Imagery) — Apply Now

### A1. Raise the request ceiling for HTTP/2 servers

```typescript
import * as Cesium from 'cesium';

// Cesium ion serves over HTTP/2 — no 6-connection browser limit applies.
// Default maximumRequestsPerServer (18) is tuned for older servers;
// raise it for our ion-hosted terrain/imagery.
Cesium.RequestScheduler.requestsByServer['assets.ion.cesium.com:443'] = 30;
Cesium.RequestScheduler.requestsByServer['tile.googleapis.com:443'] = 30;
```

### A2. Prioritize by screen-space error, not first-come-first-served

Cesium already does this internally for globe tiles (built into
`QuadtreePrimitive`) — no action needed for terrain/imagery. This becomes
relevant when we add our *own* custom data (Zarr chunks) in Phase B.

### A3. Foveated loading — center of view loads first

```typescript
const globe = viewer.scene.globe as any;
globe.foveatedScreenSpaceError = true;
globe.foveatedConeSize = 0.1;              // Narrow cone = center prioritized harder
globe.foveatedMinimumScreenSpaceErrorRelaxation = 0;
```

Perceived load time drops because the pixels the user is actually looking at
(center of screen) resolve before the periphery.

### A4. Preload ahead of the camera during flights

```typescript
viewer.scene.globe.preloadAncestors = true;   // Load parent tiles first (fast fallback)
viewer.scene.globe.preloadSiblings = true;    // Preload tiles beside the visible ones
```

This means when the user pans, adjacent tiles are often already cached,
eliminating the pop-in delay.

### A5. Debounce heavy recalculation during active drag

For our *own* future overlays (ocean data), only trigger expensive fetches
after the camera **settles**, not on every drag frame:

```typescript
let moveEndTimer: number | undefined;
viewer.camera.changed.addEventListener(() => {
  // Camera is actively moving — do nothing yet
});
viewer.camera.moveEnd.addEventListener(() => {
  // Camera has stopped — now it's safe to fetch high-cost data
  clearTimeout(moveEndTimer);
  moveEndTimer = window.setTimeout(() => {
    fetchVisibleOceanChunks();
  }, 100); // small debounce to avoid double-fires
});
```

This directly solves the community-reported problem: *"Cesium keeps sending
tile requests continuously during zoom, and only after the interaction
finishes does it load the tiles for the area I actually want."*

### A6. Cache headers for anything we host ourselves

Already planned for R2/Vercel (see `lakshya-research/vercel-deployment.md`):

```
Cache-Control: public, max-age=31536000, immutable
```

Applies to: Cesium static assets, cloud texture, and (later) Zarr chunks that
don't change once written.

---

## Phase B: Ocean Data (Zarr) — Apply When We Build It

### B1. Prefetch the next time-step while the current one displays

While the user watches frame *t*, fetch frame *t+1* in the background so
stepping forward in time feels instant:

```typescript
async function prefetchNextTimeStep(currentIndex: number) {
  const nextChunk = await zarrStore.get(['thetao', currentIndex + 1, ':', ':']);
  chunkCache.set(currentIndex + 1, nextChunk);
}
```

### B2. Only fetch chunks intersecting the current viewport + depth

Never fetch the whole global Zarr array. Compute the visible bounding box
from the camera, map it to Zarr chunk indices, and fetch only those:

```typescript
function getVisibleChunkIndices(viewer: Cesium.Viewer, chunkSizeDeg: number) {
  const rect = viewer.camera.computeViewRectangle();
  if (!rect) return [];
  // Convert rect (radians) to chunk row/col ranges
  // ... (implementation depends on Zarr chunk grid)
}
```

### B3. Network-aware quality (from Cesium community best practice)

```typescript
const connection = (navigator as any).connection;
if (connection && (connection.effectiveType === '2g' || connection.saveData)) {
  viewer.scene.globe.maximumScreenSpaceError = 8;   // Lower detail
  viewer.resolutionScale = 0.75;                     // Render at 75% res
} else {
  viewer.scene.globe.maximumScreenSpaceError = 1.5;  // High detail (current setting)
  viewer.resolutionScale = 1.0;
}
```

### B4. R2's zero-egress CDN removes the "slow origin server" bottleneck

Since Zarr chunks live on Cloudflare R2 (already planned), fetches hit
Cloudflare's edge network directly — no origin server round-trip, no egress
throttling, and effectively unlimited concurrent reads. This is the single
biggest advantage of the free-tier architecture over a Python backend proxy.

### B5. Cancel stale requests when the user scrubs the time slider quickly

```typescript
let activeController: AbortController | null = null;

async function fetchTimeStep(index: number) {
  activeController?.abort();          // Cancel the previous in-flight fetch
  activeController = new AbortController();
  const response = await fetch(chunkUrl(index), { signal: activeController.signal });
  return response.json();
}
```

Mirrors what Google Earth does internally (aggressive cancellation of
requests for content that's no longer relevant) — see
`GOOGLE-EARTH-ANALYSIS.md`.

---

## What We're Applying Right Now vs Later

| Optimization | When | Risk |
|---|---|---|
| Raise `maximumRequestsPerServer` for ion/HTTP2 | Now | Low |
| Foveated loading tuning | Now | Low |
| `preloadAncestors` / `preloadSiblings` | Now | Low |
| `moveEnd`-based fetch debouncing | Now (pattern), used later for Zarr | Low |
| 1-year cache headers | Now (Vercel/R2 config) | Low |
| Zarr chunk-range fetching | Phase B (ocean data) | Medium — needs real data to test |
| Network-aware quality switching | Phase B | Low |
| Request cancellation on fast scrubbing | Phase B | Low |

---

## Immediate Next Step

Apply A1, A3, A4 to `src/cesium/config.ts` now (base globe, no ocean data
dependency, safe to test today). A5/A6 patterns get reused verbatim once Zarr
overlays exist. B1–B5 are documented here so we don't have to re-research them
when Phase 2 (SST overlay) starts.
