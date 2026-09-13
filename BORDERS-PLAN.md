# Borders & Administrative Boundaries — Implementation Plan

> Status: **IMPLEMENTING.**
> Scope: continent / country / state / province borders rendered on the Cesium globe, smoothly fading in/out by camera altitude — matching Google Earth's "Borders & Labels" layer behavior.
> Reference repo researched: [`google/earthenterprise`](https://github.com/google/earthenterprise) (archived Jan 2023, Apache-2.0).

---

## 1. What Google Earth Enterprise tells us

`google/earthenterprise` is the open-sourced server/fusion side of Google Earth. It does **not** ship Google's proprietary border vector data, but its documentation and architecture reveal how Google Earth's borders layer works:

- **Borders are a vector layer, not raster.** Fusion ingests vector resources (Shapefile/GeoJSON/KML) and fuses them into the published globe as a vector layer with display rules per layer.
- **Display rules are altitude/scale-dependent.** Each layer has filters and formatting keyed to viewing altitude — major borders show from far away, state/province borders only appear as you zoom in.
- **Borders are styled by status.** Google Earth renders:
  - Solid gray — undisputed international boundaries (e.g. US/Canada).
  - Dashed gray — disputed / transitional boundaries.
  - Thin dotted light-gray — state/province internal borders (e.g. New Jersey, Alberta).
- **Borders are streamed, not bundled.** Fusion tiles vector data so only what is in view is served.
- **Borders are clamped to terrain** (clampToGround / relative altitude 0) so they drape over mountains.
- **Borders fade smoothly** — they don't pop in/out. As you zoom in, coarser borders fade out while finer borders fade in, with a brief overlap.

Key takeaway: **we do not need, and cannot use, Google's proprietary border dataset.** We use the same open data Natural Earth that every major open map uses, and we replicate Google Earth's *rendering behavior* (hierarchical scale ranks, status-based styling, terrain clamping, smooth altitude-based fading).

---

## 2. Data source decision

### Selected: Natural Earth vector (public domain, CC0)

| Band | File | Scale | Size | Use |
|---|---|---|---|---|
| L0 Continents | `ne_110m_admin_0_boundary_lines_land.geojson` | 1:110m | ~200 KB | Coarse continent outlines at globe view |
| L1 Countries | `ne_50m_admin_0_boundary_lines_land.geojson` | 1:50m | ~800 KB | Country borders at continent zoom |
| L2 Detailed countries | `ne_10m_admin_0_boundary_lines_land.geojson` | 1:10m | ~3 MB | Full-resolution country borders with disputed styling |
| L3 States/Provinces | `ne_10m_admin_1_states_provinces_lines.geojson` | 1:10m | ~21 MB | Internal admin-1 borders, only when zoomed in |

Source: https://github.com/nvkelso/natural-earth-vector (GeoJSON) / https://www.naturalearthdata.com

**All files bundled locally in `public/borders/`** — works offline, no network dependency during SIH demo/judging.

### Why Natural Earth over alternatives

| Option | Verdict | Reason |
|---|---|---|
| Natural Earth 110m/50m/10m | **Use this** | Public domain, purpose-built for global borders, has `featurecla` status field, matches what Cesium's own Sandcastle samples use |
| OpenStreetMap (OSM) admin boundaries | Rejected for v1 | Higher detail but huge file size, requires server-side extraction, license/attribute overhead, no built-in scale rank |
| GADM | Rejected | Academic-only license, not redistributable in a deployed app |
| Google Earth Enterprise's own data | Not available | Proprietary, never open-sourced |
| Render borders into imagery tiles (WMS) | Rejected for v1 | Loses crisp vector look, can't restyle at runtime, the horizon-disappear problem |

---

## 3. Rendering approach decision

### Selected: `GroundPolylinePrimitive` via the Primitive API (not GeoJsonDataSource)

Two viable Cesium paths were considered:

#### Option A — `GeoJsonDataSource.load(..., { clampToGround: true })`
- Pros: 3 lines of code, built-in.
- Cons:
  - `strokeWidth` is **ignored** when `clampToGround: true` (Cesium forum-confirmed limitation). Borders render at a fixed width you cannot control.
  - Entity API has higher per-feature overhead — slow with thousands of admin-1 segments.
  - No per-instance `distanceDisplayCondition` on the geometry; you can only set it per-entity after load.
  - Polygon outlines on terrain are unsupported (Cesium issue #4659) — you only get polyline draping.

#### Option B — `GroundPolylinePrimitive` + `GroundPolylineGeometry` (Primitive API)  **← chosen**
- Pros:
  - Full control of `width` per geometry instance (Google Earth-like consistent pixel width).
  - Drapes over terrain correctly.
  - Per-instance `DistanceDisplayConditionGeometryInstanceAttribute` — borders appear/disappear by altitude on the GPU, no per-frame JS.
  - Per-instance color attribute — disputed vs undisputed vs state can be different colors in one draw call.
  - One `GroundPolylinePrimitive` per scale-rank bucket = very few draw calls.
  - Custom material with `alpha` uniform enables smooth altitude-based fading (same pattern as `clouds.ts`).
- Cons:
  - More setup code than Option A.
  - Width is in pixels and does not scale with altitude (this is actually what we want — Google Earth borders keep a constant screen width).
  - `asynchronous: true` means a one-time creation cost on a worker; we accept this and stage it after terrain.

We use **Option B** for production rendering.

---

## 4. Smooth altitude-based fading (the Google Earth behavior)

Google Earth borders don't pop in/out — they fade smoothly as you zoom. We replicate this with a **custom material per band** that has an `alpha` uniform, updated by a single `onTick` listener based on camera altitude. This is the exact same pattern as `clouds.ts`.

### Fade bands (with overlap to prevent hard transitions)

Each band has a fade-in and fade-out altitude. In the overlap zone, both bands are partially visible — the new one fades in as the old one fades out.

```
Camera altitude (meters, log scale):

  20M ───────────────────────────────────────────────────────
       │
  12M ─ │ L0 continents: fully visible ─────────────────────
       │   (alpha = 1.0)
  8M  ─ │   L0 starts fading out ────────────────────────────
       │   L1 starts fading in
  6M  ─ │   L0 fully invisible, L1 fully visible ────────────
       │   (L0 alpha = 0, L1 alpha = 1.0)
  3M  ─ │   L1 fully visible, L2 starts loading ─────────────
       │   L2 fades in as L1 holds
  2M  ─ │   L1 starts fading out, L2 fully visible ──────────
       │   L3 starts loading
  1.5M ─ │   L1 fully invisible, L2 holds, L3 fades in ──────
       │
  800K ─ │   L2 starts fading out, L3 fully visible ─────────
       │
  0   ─ │   L3 fully visible (states/provinces) ──────────────
```

### Alpha computation (per band, per frame)

```ts
function computeBandAlpha(height: number, fade: FadeBand): number {
  if (height >= fade.fullVisibleAbove && height <= fade.fullVisibleBelow) return 1.0;
  if (height > fade.fullVisibleAbove) {
    // Fading out as we zoom out
    return 1.0 - smoothstep(fade.fullVisibleAbove, fade.fadeOutComplete, height);
  }
  // Fading out as we zoom in
  return 1.0 - smoothstep(fade.fullVisibleBelow, fade.fadeInComplete, fade.fullVisibleBelow + (fade.fullVisibleBelow - height));
}
```

### Optimization: skip work when invisible

Same pattern as `clouds.ts`: if a band's alpha is 0, skip all uniform writes and set `primitive.show = false`. Only call `requestRender()` when any alpha actually changes from the previous frame.

---

## 5. Lazy loading (stream what's needed)

Loading all 4 files (~25 MB) at startup would block first paint. We load lazily:

| Band | When loaded | How |
|---|---|---|
| L0 (110m, ~200KB) | At startup, in idle callback after terrain ready | `fetch()` + parse |
| L1 (50m, ~800KB) | At startup, in idle callback after terrain ready | `fetch()` + parse |
| L2 (10m, ~3MB) | When camera first crosses below 6,000 km | `fetch()` + parse in idle callback |
| L3 (10m admin-1, ~21MB) | When camera first crosses below 1,500 km | `fetch()` + parse, `asynchronous: true` primitive build |

L0 + L1 total ~1 MB — trivial, loads instantly without impacting first paint.
L2 + L3 only download when the user actually zooms in — Google Earth's "stream what's visible" principle.

---

## 6. Status-based styling (disputed borders)

Natural Earth's `featurecla` field distinguishes border status. We map these to styles:

| `featurecla` value | Style | Color | Dash pattern |
|---|---|---|---|
| `International boundary (verify)` / `(verified)` | solid | `#b0b0b0` | none |
| `International boundary (disputed)` | dashed | `#b0b0b0` | `8,4` |
| `Indefinite (ground)` | dashed | `#b0b0b0` | `4,4` |
| `Line of separation (land)` | solid | `#c8c8c8` | none |
| `Lease limit` | dashed | `#9aa0a6` | `2,3` |
| `Admin-1 boundary` (L3) | dotted | `#c8c8c8` | `2,3` |
| `Admin-1 statistical boundary` | dotted | `#d0d0d0` | `2,3` |

Note: 110m files use "verify" (no "d"), 10m files use "verified" — we handle both spellings.

---

## 7. File / module plan

```
src/cesium/
  borders.ts            ← addBorders(viewer), lazy-load + build primitives + alpha fade onTick
  borders-data.ts       ← types + file paths + featurecla→style map
  borders-styling.ts    ← color/width/dash per band, fade band constants, alpha computation
public/
  borders/
    ne_110m_admin_0_boundary_lines_land.geojson
    ne_50m_admin_0_boundary_lines_land.geojson
    ne_10m_admin_0_boundary_lines_land.geojson
    ne_10m_admin_1_states_provinces_lines.geojson
```

Wiring (one call site change):
- `src/cesium/config.ts` — after `terrain.readyEvent` fires and the LOD refine timeout runs, call `addBorders(viewer)` in the same idle callback pattern as `addCloudLayer`.
- No changes to `CesiumViewer.tsx`, `App.tsx`, or any existing module.
- Borders are part of the viewer's `scene.groundPrimitives`, cleaned up automatically on `viewer.destroy()`.

---

## 8. Style constants (Google Earth-matched)

```ts
// borders-styling.ts
export const BORDER_BANDS = {
  L0_CONTINENTS: { width: 1.0, color: '#9aa0a6', fadeOutAbove: 8.0e6,  fadeOutComplete: 12.0e6 },
  L1_COUNTRIES:  { width: 1.2, color: '#b0b0b0', fadeInAbove: 6.0e6,   fadeInComplete: 8.0e6,  fadeOutBelow: 2.0e6, fadeOutComplete: 1.5e6 },
  L2_DETAILED:   { width: 1.2, color: '#b0b0b0', fadeInAbove: 3.0e6,   fadeInComplete: 2.0e6,  fadeOutBelow: 1.0e6, fadeOutComplete: 0.8e6 },
  L3_STATES:     { width: 0.8, color: '#c8c8c8', fadeInBelow: 1.5e6,   fadeInComplete: 1.0e6 },
} as const;
```

---

## 9. Implementation phases

### Phase 1 — Data acquisition (no rendering)
1. Download the four GeoJSON files from `nvkelso/natural-earth-vector` (110m + 50m + 10m admin-0 + 10m admin-1 lines).
2. Place under `public/borders/`.
3. Verify file integrity (valid JSON, feature count > 0).

### Phase 2 — L0 + L1 borders (continents + countries, loads at startup)
1. Implement `borders-styling.ts` constants + alpha computation.
2. Implement `borders-data.ts` types + featurecla→style map.
3. Implement `borders.ts` with `buildBand()` helper + `addBorders(viewer)`.
4. Custom material with `alpha` uniform per band (same pattern as `clouds.ts`).
5. Wire `addBorders(viewer)` into `config.ts` after terrain ready (idle callback).
6. Verify: at globe view, continent outlines visible; zoom to continent level, country borders fade in smoothly.

### Phase 3 — L2 detailed countries + disputed styling (lazy load)
1. Add lazy-loading for L2 when camera crosses below 6,000 km.
2. Add `PolylineDash` material path for disputed features.
3. Verify: zoom to India, see solid + dashed borders; disputed borders render dashed on terrain.

### Phase 4 — L3 states/provinces (lazy load, 21MB)
1. Add lazy-loading for L3 when camera crosses below 1,500 km.
2. Verify: zoom to Maharashtra, see state borders; zoom out, they fade away.

### Phase 5 — Polish
1. Anti-aliasing: confirm borders are crisp (contextOptions already has `antialias: true`).
2. Horizon check: ensure borders render near globe horizon.
3. Performance: profile — confirm borders add < 4 draw calls.
4. Attribution: add Natural Earth credit to `CreditDisplay`.
5. Update docs.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `strokeWidth` ignored on terrain (Entity API) | We use `GroundPolylinePrimitive`, which honors `width`. |
| Polygon outlines unsupported on terrain | We render **lines**, not polygon outlines — Natural Earth's `boundary_lines_land` is already line geometry. |
| Border flicker at band handoff | Smooth alpha fade with 500 km overlap zones — both bands partially visible during transition. |
| Disputed-border dash pattern breaks on terrain | Verified Cesium supports `PolylineDash` material on `GroundPolylinePrimitive`; fallback is a solid line if it fails. |
| 21MB admin-1 dataset slows startup | Lazy-loaded only when camera crosses 1,500 km; `asynchronous: true` primitive build on worker. |
| `requestRenderMode` breaks border visibility | `onTick` listener calls `requestRender()` only when any band's alpha actually changes. |
| Borders disappear near globe horizon | Ground primitives do not have the WMS scale-denominator problem; verify in testing. |
| Political sensitivity of disputed borders | Natural Earth provides POV variants (`_chn`, `_ind`, `_arg`) — we ship the default de facto version and document the choice. |
| License/attribute | Natural Earth is public domain (CC0); we add a credit string via `CreditDisplay`. |

---

## 11. Out of scope for v1

- **Labels** (country/state names) — separate plan; needs font/glyph atlas and declutter logic.
- **Roads, cities, points of interest** — separate layer system.
- **Per-country disputed-border POV selector** — ship default; add UI later if needed.
- **Server-side vector tiling** (MVT/VectorTiles) — only if profiling shows the in-memory set is too large.
- **Borders on the cloud shell** — borders are clamped to terrain, clouds are above; no interaction needed.

---

## 12. Acceptance criteria

1. At full-globe view, continent outlines are visible as thin gray lines.
2. Zooming in to continent level smoothly fades in country borders (no hard pop).
3. Zooming in below ~1,500 km smoothly fades in state/province borders.
4. Disputed borders render dashed; undisputed render solid.
5. Borders drape over terrain (no floating, no underground).
6. No visible artifact at the poles.
7. First paint time is unchanged (only L0+L1 load at startup, in idle time).
8. L2 and L3 data only downloads when the user actually zooms in.
9. A `CreditDisplay` entry attributes Natural Earth.
10. Borders respect `requestRenderMode` — no per-frame render requests when alpha is stable.
