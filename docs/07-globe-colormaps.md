# 07 — Globe Colormap Unification & Bug Fixes

> **Status**: Implemented and building. Browser-tested.
> **Scope**: Variable-specific colormaps for the Cesium globe, stack
> overflow fix, wheel handler crash fix, colormap safety guards.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Root Cause Analysis](#2-root-cause-analysis)
3. [Solution: Variable-Specific Colormaps](#3-solution-variable-specific-colormaps)
4. [Files Changed](#4-files-changed)
5. [Colormap Definitions](#5-colormap-definitions)
6. [Color Sampling Algorithm](#6-color-sampling-algorithm)
7. [Bug Fix: Stack Overflow](#7-bug-fix-stack-overflow)
8. [Bug Fix: Wheel Handler Crash](#8-bug-fix-wheel-handler-crash)
9. [Bug Fix: hexToRgb Undefined](#9-bug-fix-hextorgb-undefined)
10. [Verification](#10-verification)

---

## 1. Problem Statement

The user reported two issues:

1. **"I don't see globe ocean color change at all"** — clicking
   different layers in the left sidebar (SST, MHW, pH, sea ice, sea
   level) did not visibly change the globe's ocean colors. Everything
   appeared as the same blue gradient.

2. **Console errors** after the colormap change was deployed:
   - `RangeError: Maximum call stack size exceeded`
   - `TypeError: Cannot read properties of undefined (reading 'replace')`
   - `TypeError: Cannot read properties of undefined (reading 'scene')`
   - `Error: <path> attribute d: Expected number, "M NaN ..."`

---

## 2. Root Cause Analysis

### Why the globe didn't change color

The globe rendering pipeline (`binary-data.ts`) used a single hardcoded
colormap function called `threeColorMap`:

```typescript
function threeColorMap(t: number): [number, number, number] {
  // Blue (t=0) → Green (t=0.5) → Red (t=1)
  // Same colors for ALL variables
}
```

This function was called for every pixel of every dataset. Whether you
loaded SST (−2 to 35°C), pH (7.75 to 8.35), or sea ice (0 to 1), the
globe always rendered the same blue→green→red gradient. The only
difference was which values mapped to which positions on the gradient,
but the visual effect was nearly identical — especially from a
distance.

The right-panel legend showed variable-specific color scales (e.g.
SST: blue→red, pH: red→blue, ice: dark blue→white), but the globe
ignored these entirely.

### Why the console errors appeared

**`RangeError: Maximum call stack size exceeded`**

The auto-scaling code used JavaScript's spread operator to find the
min/max of the data array:

```typescript
const actualMin = Math.min(...finiteVals);  // 683,008 values
const actualMax = Math.max(...finiteVals);  // 683,008 values
```

The spread operator (`...`) expands the array into individual function
arguments. JavaScript engines have a maximum argument count
(~65,536–1,048,576 depending on engine). With 683,008 finite values in
the SST dataset, this exceeded V8's limit and threw a RangeError.

**`TypeError: Cannot read properties of undefined (reading 'replace')`**

After the RangeError crashed the function, the colormap was in a
partially-initialized state. The `hexToRgb` function tried to call
`.replace('#', '')` on an undefined stop string, causing this
secondary error.

**`TypeError: Cannot read properties of undefined (reading 'scene')`**

The wheel event handler in `config.ts` was registered on the container
element with a closure over the `viewer` variable. When the
CesiumViewer component unmounted (e.g. during HMR), the viewer was
destroyed, but the event listener remained. Any subsequent scroll event
tried to access `viewer.scene` on the destroyed viewer, which returned
undefined.

**`Error: <path> attribute d: Expected number, "M NaN ..."`**

The TimeSeriesChart received NaN values in its chart data (because the
data adapter also used `Math.min(...finiteVals)` which could overflow),
causing SVG path coordinates to be NaN.

---

## 3. Solution: Variable-Specific Colormaps

Created a new module `src/cesium/colormaps.ts` that defines a specific
colormap for each dataset ID. The colormaps are identical to the color
scales in `src/analytics/configs.ts`, ensuring the globe and the
right-panel legend always show the same colors for the same values.

Modified `src/cesium/binary-data.ts` to:
1. Import `getColormap` and `valueToColor` from the new module
2. Pass a `Colormap` to `dataToSmallCanvas` instead of using
   `threeColorMap`
3. Look up the colormap via `getColormap(dataset.id)` in
   `fetchSliceCanvasForDataset`
4. Remove the dead `threeColorMap` function

---

## 4. Files Changed

| File | Change | Lines |
|------|--------|-------|
| `src/cesium/colormaps.ts` | **NEW** — Variable-specific colormaps + sampling functions | 119 |
| `src/cesium/binary-data.ts` | Import colormaps, pass to canvas renderer, remove `threeColorMap`, fix stack overflow | ~60 changed |
| `src/cesium/depth-layers.ts` | Set `layer.alpha = 0.85` on added imagery layer | +1 line |
| `src/cesium/config.ts` | Add `isDestroyed()` guard to wheel handler | +1 line |

---

## 5. Colormap Definitions

Each colormap is keyed by the dataset ID (the same ID used in
`datasets.ts` and selected in the left sidebar).

### SST (Sea Surface Temperature)

```
Stops: #1e3a8a → #2563eb → #06b6d4 → #22c55e → #eab308 → #f97316 → #dc2626
Range: -2°C to 35°C
Meaning: Dark blue (freezing) → cyan (cool) → green (moderate) → yellow (warm) → orange (hot) → red (very hot)
```

### MHW (Marine Heat Waves)

```
Stops: #fbbf24 → #f97316 → #ef4444 → #991b1b
Range: 0°C to 4°C (intensity above climatology)
Meaning: Yellow (moderate) → orange (strong) → red (severe) → dark red (extreme)
```

### Sea Level

```
Stops: #1e40af → #3b82f6 → #60a5fa → #93c5fd → #fbbf24 → #f97316 → #dc2626
Range: -0.3m to 0.3m (anomaly)
Meaning: Dark blue (below mean) → light blue (slightly below) → yellow (slightly above) → red (well above)
```

### Surface pH (Ocean Acidification)

```
Stops: #dc2626 → #f97316 → #fbbf24 → #22c55e → #06b6d4 → #3b82f6
Range: 7.75 to 8.35
Meaning: Red (acidic) → orange → yellow (moderate) → green (neutral) → cyan → blue (basic)
Note: Reversed from temperature — low pH (acidic) is red, high pH (basic) is blue
```

### pH Trend

```
Stops: #dc2626 → #f97316 → #fbbf24 → #f1f5f9 → #bae6fd → #38bdf8 → #1d4ed8
Range: -0.003 to 0.0005 (per year)
Meaning: Diverging colormap — red (decreasing pH, acidifying) → white (no change) → blue (increasing pH)
```

### Arctic Sea Ice

```
Stops: #0c4a6e → #0284c7 → #38bdf8 → #bae6fd → #f1f5f9
Range: 0 to 1 (concentration fraction)
Meaning: Dark blue (open water) → sky blue (partial ice) → light blue (mostly ice) → white (full ice)
```

### Antarctic Sea Ice

```
Stops: #0c4a6e → #0284c7 → #38bdf8 → #bae6fd → #f1f5f9
Range: 0 to 1 (concentration fraction)
Meaning: Same as Arctic — dark blue (water) → white (ice)
```

### Default (fallback)

```
Stops: #1e3a8a → #06b6d4 → #22c55e → #eab308 → #dc2626
Range: 0 to 1
Used for: VAM and any unknown dataset ID
```

---

## 6. Color Sampling Algorithm

The `sampleColormap` function maps a normalized position `t ∈ [0,1]`
to an RGB color by linearly interpolating between the two nearest
color stops.

```
Input: stops = ['#1e3a8a', '#2563eb', '#06b6d4', ...], t = 0.35

Step 1: Clamp t to [0, 1] → t = 0.35
Step 2: seg = t * (stops.length - 1) = 0.35 * 6 = 2.1
Step 3: i = floor(2.1) = 2 (lower stop index)
Step 4: frac = 2.1 - 2 = 0.1 (interpolation fraction)
Step 5: c0 = stops[2] = '#06b6d4' (cyan)
Step 6: c1 = stops[3] = '#22c55e' (green)
Step 7: r = lerp(r0, r1, 0.1) = lerp(6, 34, 0.1) = 8.8 → 9
Step 8: g = lerp(g0, g1, 0.1) = lerp(182, 197, 0.1) = 183.5 → 184
Step 9: b = lerp(b0, b1, 0.1) = lerp(212, 94, 0.1) = 200.2 → 200
Output: [9, 184, 200] (mostly cyan, slightly toward green)
```

The `valueToColor` function wraps `sampleColormap` by first
normalizing a raw data value to `t`:

```
t = (value - colormap.min) / (colormap.max - colormap.min)
```

---

## 7. Bug Fix: Stack Overflow

**Error**: `RangeError: Maximum call stack size exceeded`

**Location**: `src/cesium/binary-data.ts`, functions
`fetchSliceCanvas` and `fetchSliceCanvasForDataset`

**Root cause**:

```typescript
// finiteVals can contain 683,008+ values for global datasets
const actualMin = Math.min(...finiteVals);
const actualMax = Math.max(...finiteVals);
```

The spread operator (`...`) expands the array into individual function
arguments. V8's maximum argument count is approximately 65,536. With
683,008 values, the call stack overflowed.

**Fix**: Replaced with a single-pass loop:

```typescript
let actualMin = Infinity, actualMax = -Infinity;
for (let i = 0; i < data.length; i++) {
  if (Number.isFinite(data[i])) {
    if (data[i] < actualMin) actualMin = data[i];
    if (data[i] > actualMax) actualMax = data[i];
  }
}
```

This also eliminates the separate `finiteVals` array allocation (minor
memory improvement).

**Performance**: O(n) single pass vs O(n) spread + O(n) min/max = same
complexity, but no stack overflow.

---

## 8. Bug Fix: Wheel Handler Crash

**Error**: `TypeError: Cannot read properties of undefined (reading 'scene')`

**Location**: `src/cesium/config.ts`, wheel event listener

**Root cause**:

```typescript
container.addEventListener('wheel', (event) => {
  event.preventDefault();
  viewer.scene.requestRender();  // crashes if viewer destroyed
}, { passive: false });
```

The event listener is registered once during viewer creation but is
never removed. When the CesiumViewer component unmounts (e.g. during
Vite HMR), `viewer.destroy()` is called, which sets internal
properties to undefined. Any subsequent wheel event over the container
tries to access `viewer.scene` → undefined → crash.

**Fix**:

```typescript
container.addEventListener('wheel', (event) => {
  event.preventDefault();
  if (!viewer.isDestroyed()) viewer.scene.requestRender();
}, { passive: false });
```

`viewer.isDestroyed()` returns `true` after `viewer.destroy()` is
called, preventing the crash.

---

## 9. Bug Fix: hexToRgb Undefined

**Error**: `TypeError: Cannot read properties of undefined (reading 'replace')`

**Location**: `src/cesium/colormaps.ts`, `hexToRgb` function

**Root cause**: This was a secondary error triggered by the stack
overflow (Bug 7). When `fetchSliceCanvasForDataset` crashed, the
colormap lookup returned a partially-constructed object with undefined
stops. The `sampleColormap` function tried to access `stops[i]` which
was undefined, then passed it to `hexToRgb` which called
`hex.replace('#', '')` on undefined.

**Fix**: Added safety guards in `sampleColormap`:

```typescript
export function sampleColormap(stops: string[], t: number): [number, number, number] {
  if (!stops || stops.length === 0) return [128, 128, 128];
  // ...
  const c0 = stops[i] ?? stops[0];
  const c1 = stops[i + 1] ?? stops[stops.length - 1];
  // ...
}
```

Even though the primary cause (stack overflow) is fixed, these guards
prevent any future undefined-stop issues from cascading.

---

## 10. Verification

### Build verification

```
npx tsc --noEmit → Exit code 0 (no errors)
npm run build → ✓ built in 3.80s (no errors)
```

### Data verification

All `.bin` files verified to contain valid Float32Array data:

| Dataset | Total cells | Finite cells | NaN cells | Min | Max |
|---------|------------|---------------|-----------|-----|-----|
| SST t0000 | 980,640 | 683,008 | 297,632 | −2.29 | 31.74 |
| MHW t0000 | 980,640 | 683,008 | 297,632 | 0.00 | 5.80 |
| pH surface t0000 | 1,036,800 | 585,680 | 451,120 | 7.75 | 8.33 |
| pH trend t0000 | 1,026,720 | 585,704 | 441,016 | −0.003 | 0.0004 |
| Sea level t0000 | 1,036,800 | 588,788 | 448,012 | −1.20 | 0.84 |
| Ice arctic t0000 | 174,240 | 114,502 | 59,738 | 0.00 | 1.00 |
| Ice antarctic t0000 | 116,640 | 65,834 | 50,806 | 0.00 | 1.00 |

### HTTP verification

All data files served with HTTP 200:

```
/data/sst/sst_t0000.bin           → 200, 3,922,560 bytes
/data/mhw/mhw_t0000.bin           → 200, 3,922,560 bytes
/data/ph/ph_surface_t0000.bin     → 200, 4,147,200 bytes
/data/ph/ph_trend_t0000.bin       → 200, 4,147,200 bytes
/data/sea-level/sla_t0000.bin     → 200, 4,147,200 bytes
/data/sea-ice/ice_arctic_t0000.bin → 200, 696,960 bytes
/data/sea-ice/ice_antarctic_t0000.bin → 200, 466,560 bytes
/masks/ne_110m_land.geojson       → 200, 138,160 bytes
```

### Colormap alignment verification

Confirmed that `colormaps.ts` stops match `configs.ts` colorScale
stops for all 7 datasets:

```
sst:               7 stops, matches ✓
mhw:               4 stops, matches ✓
sea_level:          7 stops, matches ✓
ph_surface:         6 stops, matches ✓
ph_trend:           7 stops, matches ✓
sea_ice_arctic:     5 stops, matches ✓
sea_ice_antarctic:  5 stops, matches ✓
```
