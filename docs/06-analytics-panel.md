# 06 — Analytics Panel & Right-Side Visualization

> **Status**: Implemented and building. Browser-tested.
> **Scope**: Right-side data visualization panel, variable-specific charts,
> globe↔graph synchronization, color-scale unification.
> **Reference UI**: [MyOcean Health](https://myoceanhealth.marine.copernicus.eu/)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [Files Created](#3-files-created)
4. [Files Modified](#4-files-modified)
5. [Analytics Module Architecture](#5-analytics-module-architecture)
6. [Chart Engine](#6-chart-engine)
7. [AnalyticsPanel Component](#7-analyticspanel-component)
8. [Globe ↔ Graph Synchronization](#8-globe--graph-synchronization)
9. [Variable-Specific Colormaps](#9-variable-specific-colormaps)
10. [Size Controls Overlay](#10-size-controls-overlay)
11. [Bug Fixes Applied](#11-bug-fixes-applied)
12. [CSS Styling](#12-css-styling)
13. [Data Sources Used](#13-data-sources-used)
14. [Chart Type Per Variable](#14-chart-type-per-variable)
15. [Remaining Limitations](#15-remaining-limitations)

---

## 1. Overview

The right-side panel was redesigned from a generic dashboard into a
scientific, information-dense visualization panel that closely follows
the MyOcean Health interface. The key changes:

- **Left sidebar is the ONLY layer selector** — the right panel has no
  duplicate variable tabs or layer navigation.
- **Variable-specific charts** — each ocean variable gets its own chart
  type, axis configuration, color scale, and interaction behavior.
- **Globe colors now match the legend** — the globe uses the same
  variable-specific colormap as the right-panel color scale.
- **User-controllable panel sizing** — width, height, and graph height
  are adjustable via a gear-button overlay with sliders.

---

## 2. Design Principles

| Principle | Implementation |
|-----------|---------------|
| Single source of truth | `currentDatasetId` in `App.tsx` drives everything |
| No duplicate selectors | Right panel derives `variableId` from `currentDatasetId` |
| Variable-specific | Each variable has its own `VariableConfig` in `configs.ts` |
| Real data only | Data adapter fetches actual `.bin` files from `public/data/` |
| No charting dependency | Custom SVG chart engine, no external library |
| Light theme | Glass-morphism dark overlay on light globe (matches existing design) |
| Compact scientific UI | Dense layout, small fonts, minimal padding — like MyOcean Health |

---

## 3. Files Created

### `src/analytics/types.ts`

Shared TypeScript types for the analytics system.

**Types defined:**

| Type | Purpose |
|------|---------|
| `VariableId` | Union: `'sst' \| 'mhw' \| 'sea_level' \| 'ocean_acidification' \| 'arctic_ice' \| 'antarctic_ice'` |
| `Resolution` | Union: `'daily' \| 'monthly' \| 'annual'` |
| `Mode` | Union: `'absolute' \| 'anomaly'` |
| `ChartType` | Union: `'seasonal' \| 'trend'` |
| `ChartPoint` | `{ x: number; y: number; date?: string; year?: number; month?: number }` |
| `ChartSeries` | `{ id: string; label: string; color: string; points: ChartPoint[]; dashed?: boolean }` |
| `ColorScaleConfig` | `{ stops: string[]; min: number; max: number; unit: string; ticks: number[]; categories?: string[] }` |
| `VariableConfig` | Full per-variable configuration (see below) |

**`VariableConfig` interface fields:**

```typescript
interface VariableConfig {
  id: VariableId;
  title: string;
  description: string;
  unit: string;
  chartType: ChartType;
  resolutions: Resolution[];
  supportsAnomalies: boolean;
  supportsYearComparison: boolean;
  referencePeriod: string;
  referenceYears: number[];
  availableYears: number[];
  defaultSelectedYears: number[];
  colorScale: ColorScaleConfig;
  yAxisFormat: 'decimal' | 'integer';
  decimals: number;
  hasUncertainty: boolean;
  trendStatement: string;
  uncertainty: string;
  datasetId: string;          // maps to DATASETS key
  datasetVariableId: string;  // maps to variable id within dataset
  aggregation: 'mean' | 'sum' | 'percentage';
  areaWeighted: boolean;
  yAxisRange: [number, number] | null;
}
```

---

### `src/analytics/configs.ts`

Per-variable visualization configurations for all 6 MyOcean Health variables.

**Constants:**

| Constant | Purpose |
|----------|---------|
| `REF_YEARS` | `[2019, 2020, 2021, 2022, 2023]` — reference climatology years |
| `ALL_YEARS` | `[2019, 2020, 2021, 2022, 2023, 2024]` — all available years |
| `SEA_LEVEL_YEARS` | `[2019, 2020, 2021, 2022, 2023, 2024, 2025]` |
| `YEAR_COLORS` | Maps year → hex color for chart lines |
| `VARIABLE_CONFIGS` | `Record<VariableId, VariableConfig>` — all 6 configs |
| `getYearColor(year)` | Returns color for a year, fallback `#cbd5e1` |

**Year color palette:**

| Year | Color |
|------|-------|
| 2024 | `#dc2626` (red) |
| 2023 | `#f97316` (orange) |
| 2022 | `#eab308` (yellow) |
| 2021 | `#22c55e` (green) |
| 2020 | `#06b6d4` (cyan) |
| 2019 | `#3b82f6` (blue) |

**Variable configurations summary:**

| Variable | Chart Type | Unit | Resolutions | Anomalies | Year Comparison | Reference Period |
|----------|-----------|------|-------------|-----------|-----------------|------------------|
| SST | seasonal | °C | monthly, annual | yes | yes | 2019–2023 |
| MHW | seasonal | % | monthly, annual | no | yes | 2019–2023 |
| Sea Level | trend | mm | monthly, annual | yes | no | 1993–2012 |
| Ocean Acidification | trend | pH | monthly, annual | yes | yes | 2019–2023 |
| Arctic Ice | seasonal | million km² | monthly, annual | yes | yes | 2019–2023 |
| Antarctic Ice | seasonal | million km² | monthly, annual | yes | yes | 2019–2023 |

---

### `src/analytics/data-adapter.ts`

Aggregates spatial binary data (`.bin` Float32Array rasters) into 1D time
series for charting. Uses real data only — no fabrication.

**Functions:**

| Function | Signature | Purpose |
|----------|-----------|---------|
| `getFullTimeSeries` | `(config, resolution, mode, selectedYears) → ChartSeries[]` | Loads binary slices and aggregates into chart series |
| `computeReferenceSeries` | `(config, resolution) → ChartSeries` | Computes multi-year reference climatology |
| `filterByYear` | `(points, year) → ChartPoint[]` | Filters time-series points by year |
| `toAnnual` | `(points) → ChartPoint[]` | Aggregates monthly points to annual means |
| `toAnomalies` | `(points, reference) → ChartPoint[]` | Converts absolute values to anomalies |
| `getLatestValue` | `(config) → { value, date, unit }` | Extracts the most recent value from data |
| `computeTrend` | `(points) → { slope, r2 }` | Linear regression for trend line |

**Aggregation methods per variable:**

| Variable | Aggregation | Description |
|----------|-------------|-------------|
| SST | `mean` (area-weighted) | Cosine-latitude-weighted global mean |
| MHW | `percentage` | % of ocean cells with MHW intensity > 0 |
| Sea Level | `mean` (area-weighted) | Global mean sea level anomaly |
| Ocean Acidification | `mean` (area-weighted) | Global mean surface pH |
| Arctic Ice | `sum` (extent) | Sum of cell areas where concentration > 15% |
| Antarctic Ice | `sum` (extent) | Sum of cell areas where concentration > 15% |

**Area weighting:**

For `areaWeighted: true` variables, each grid cell is weighted by
`cos(latitude * π/180)` to account for the convergence of meridians
toward the poles. This gives a true global mean rather than a
simple arithmetic average that overweights polar regions.

**Sea ice extent calculation:**

```
extent = Σ (cell_area) for all cells where concentration > 0.15
cell_area = (5km × 5km) = 25 km²  (for 0.25° grid)
result converted to million km²
```

---

### `src/components/TimeSeriesChart.tsx`

Custom responsive SVG chart engine — no external charting dependency.

**Features:**

- Two chart modes: `seasonal` (months on x-axis, multi-year lines) and
  `trend` (time on x-axis, single line)
- Responsive via `ResizeObserver` — chart width follows container
- Axes with tick marks and labels
- Horizontal grid lines
- Multiple series with distinct colors
- Dashed reference/average line support
- Vertical hover guide line (crosshair)
- Nearest-point detection on mouse move
- Custom HTML tooltip with edge repositioning (flips when near right edge)
- Multi-year tooltip aggregation (shows all years' values for the
  hovered month)
- `onPointSelect` callback

**Props:**

```typescript
interface TimeSeriesChartProps {
  series: ChartSeries[];
  chartType: ChartType;
  unit: string;
  yAxisFormat: 'decimal' | 'integer';
  decimals: number;
  yAxisRange: [number, number] | null;
  height?: number;
  onPointSelect?: (point: ChartPoint | null) => void;
}
```

**Rendering pipeline:**

1. `ResizeObserver` measures container width
2. SVG viewBox set to `[0, 0, width, height]`
3. Margins calculated: left=40, right=16, top=12, bottom=28
4. X-scale: linear from 0–11 (months) or date range
5. Y-scale: linear from data min/max or configured range
6. Grid lines drawn at y-tick positions
7. Each series rendered as `<path>` with `d` attribute
8. Reference series rendered with `stroke-dasharray`
9. Hover overlay: invisible `<rect>` capturing mouse events
10. On mouse move: nearest x computed, vertical guide drawn, tooltip
    positioned

---

### `src/components/AnalyticsPanel.tsx`

The right-side data visualization panel. Reactive to the left sidebar's
`currentDatasetId` — no independent layer selection.

**Props:**

```typescript
interface AnalyticsPanelProps {
  viewer: Cesium.Viewer | null;
  active: boolean;
  currentDatasetId: string | null;  // from left sidebar
  chartHeight?: number;               // user-controllable from size overlay
}
```

**Dataset → Variable mapping:**

```typescript
const DATASET_TO_VARIABLE: Record<string, VariableId> = {
  sst: 'sst',
  mhw: 'mhw',
  sea_level: 'sea_level',
  ph_surface: 'ocean_acidification',
  sea_ice_arctic: 'arctic_ice',
  sea_ice_antarctic: 'antarctic_ice',
};
```

> **Note**: `ph_trend` is not in this map. When `ph_trend` is selected,
> the panel shows an empty state: "Select an ocean health layer from the
> left panel to view its time series, trend, and color scale here."

**Internal state:**

| State | Type | Default | Purpose |
|-------|------|---------|---------|
| `resolution` | `Resolution` | `'monthly'` | Time resolution |
| `mode` | `Mode` | `'absolute'` | Absolute or anomaly |
| `selectedYears` | `number[]` | from config | Years to display |
| `showReference` | `boolean` | `true` | Show/hide reference line |
| `loading` | `boolean` | `false` | Data loading state |
| `chartSeries` | `ChartSeries[]` | `[]` | Computed chart data |
| `metricValue` | `string` | `''` | Latest value display |
| `trendValue` | `string` | `''` | Trend statement |

**Panel layout (top to bottom):**

```
┌─────────────────────────────────────┐
│ Layer title                         │
│ Current metric/value (large)        │
│ Trend / uncertainty (small)         │
├─────────────────────────────────────┤
│ TIME: [Daily] [Monthly] [Annual]    │
│ MODE: [Absolute] [Anomalies]         │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │     INTERACTIVE SVG CHART       │ │
│ │  curves / average / crosshair   │ │
│ │  tooltip                        │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ Year chips: [2024] [2023] [2022]    │
│ ☐ Show reference average            │
├─────────────────────────────────────┤
│ COLOR SCALE                         │
│ [gradient bar]                      │
│ min ──── ticks ──── max              │
│ unit                                │
└─────────────────────────────────────┘
```

**Data loading effect:**

When `currentDatasetId` or `resolution` or `mode` or `selectedYears`
changes, the panel:
1. Derives `variableId` from `DATASET_TO_VARIABLE[currentDatasetId]`
2. If no mapping → shows empty state, clears chart
3. Looks up `VARIABLE_CONFIGS[variableId]`
4. Calls `getFullTimeSeries(config, resolution, mode, selectedYears)`
5. If `showReference` → calls `computeReferenceSeries(config, resolution)`
6. Sets `chartSeries`, `metricValue`, `trendValue`
7. Sets `loading = false`

---

### `src/cesium/colormaps.ts`

Variable-specific colormaps for globe rendering. Mirrors the color
scales in `configs.ts` so the globe and legend always match.

**Colormap definitions:**

| Dataset ID | Stops | Range | Description |
|------------|-------|-------|-------------|
| `sst` | `#1e3a8a → #2563eb → #06b6d4 → #22c55e → #eab308 → #f97316 → #dc2626` | −2 to 35 °C | Blue (cold) → red (warm) |
| `mhw` | `#fbbf24 → #f97316 → #ef4444 → #991b1b` | 0 to 4 °C | Yellow → deep red (intensity) |
| `sea_level` | `#1e40af → #3b82f6 → #60a5fa → #93c5fd → #fbbf24 → #f97316 → #dc2626` | −0.3 to 0.3 m | Blue (low) → red (high) |
| `ph_surface` | `#dc2626 → #f97316 → #fbbf24 → #22c55e → #06b6d4 → #3b82f6` | 7.75 to 8.35 | Red (acidic) → blue (basic) |
| `ph_trend` | `#dc2626 → #f97316 → #fbbf24 → #f1f5f9 → #bae6fd → #38bdf8 → #1d4ed8` | −0.003 to 0.0005 | Diverging: red (decrease) → blue (increase) |
| `sea_ice_arctic` | `#0c4a6e → #0284c7 → #38bdf8 → #bae6fd → #f1f5f9` | 0 to 1 | Dark blue (water) → white (ice) |
| `sea_ice_antarctic` | `#0c4a6e → #0284c7 → #38bdf8 → #bae6fd → #f1f5f9` | 0 to 1 | Dark blue (water) → white (ice) |

**Functions:**

| Function | Signature | Purpose |
|----------|-----------|---------|
| `getColormap(datasetId)` | `(string) → Colormap` | Look up colormap by dataset ID, fallback to generic |
| `hexToRgb(hex)` | `(string) → [r, g, b]` | Convert `#rrggbb` to RGB 0–255 |
| `sampleColormap(stops, t)` | `(string[], number) → [r, g, b]` | Sample colormap at position t ∈ [0,1] |
| `valueToColor(colormap, value)` | `(Colormap, number) → [r, g, b]` | Map a data value to RGB |

**Colormap interface:**

```typescript
interface Colormap {
  stops: string[];  // hex colors, evenly spaced
  min: number;      // value at first stop
  max: number;      // value at last stop
}
```

**Color sampling algorithm:**

```
t = (value - min) / (max - min)   // normalize to [0,1]
t = clamp(t, 0, 1)
seg = t * (stops.length - 1)      // position in stop array
i = floor(seg)                    // lower stop index
frac = seg - i                    // interpolation fraction
color = lerp(stops[i], stops[i+1], frac)  // linear interpolation
```

**Safety guards added (after bug fix):**

- `stops` array checked for undefined/empty → returns gray `[128,128,128]`
- Individual stop strings checked for undefined → falls back to first/last
- `hexToRgb` handles malformed hex gracefully

---

## 4. Files Modified

### `src/App.tsx`

**Changes:**

1. Added `AnalyticsPanel` import
2. Added `currentDatasetId` state — the single source of truth for
   selected layer
3. Added right-side `analytics-sidebar` div with `AnalyticsPanel`
4. Added collapse toggle for analytics panel (✕ / 📊 buttons)
5. Added size control state: `analyticsWidth`, `analyticsHeightPct`,
   `chartHeight`, `sizePanelOpen`
6. Added `DEFAULT_SIZES` constant with user-confirmed values:
   - Width: 496px
   - Height: 54% of viewport
   - Chart height: 277px
7. Added ⚙ gear button and size overlay with three sliders + reset
8. Analytics sidebar `style` prop sets width/height inline from state
9. `chartHeight` passed to `AnalyticsPanel` as prop

**Layout state:**

```typescript
const [analyticsWidth, setAnalyticsWidth] = useState(496);
const [analyticsHeightPct, setAnalyticsHeightPct] = useState(54);
const [chartHeight, setChartHeight] = useState(277);
const [sizePanelOpen, setSizePanelOpen] = useState(false);
```

**Size overlay JSX:**

The overlay contains:
- Title: "Panel Size"
- Width slider: 280–720px
- Height slider: 40–100% (of viewport)
- Graph slider: 120–600px
- Reset button: restores defaults

---

### `src/components/DepthPanel.tsx`

**Changes:**

1. Added `onDatasetChange` optional callback prop:
   ```typescript
   onDatasetChange?: (id: string) => void;
   ```
2. `pickDataset` function now calls `onDatasetChange?.(id)` when a
   dataset card is clicked — this notifies `App.tsx` of the selection

---

### `src/cesium/binary-data.ts`

**Changes:**

1. Added import: `import { getColormap, valueToColor, type Colormap } from './colormaps';`
2. `dataToSmallCanvas` now accepts a `Colormap` parameter instead of
   using the hardcoded `threeColorMap` function
3. `fetchSliceCanvasForDataset` now:
   - Looks up colormap via `getColormap(dataset.id)`
   - Uses colormap min/max as the default range (instead of
     `variable.min` / `variable.max`)
   - Passes colormap to `dataToSmallCanvas`
4. `fetchSliceCanvas` (legacy VAM path) now passes a generic colormap
   to `dataToSmallCanvas`
5. Removed the dead `threeColorMap` function (35 lines deleted)
6. **Bug fix**: Replaced `Math.min(...finiteVals)` / `Math.max(...finiteVals)`
   with inline loops — the spread operator with 683K+ values caused
   `RangeError: Maximum call stack size exceeded`

**Before (broken):**

```typescript
const actualMin = Math.min(...finiteVals);  // stack overflow!
const actualMax = Math.max(...finiteVals);  // stack overflow!
```

**After (fixed):**

```typescript
let actualMin = Infinity, actualMax = -Infinity;
for (let i = 0; i < data.length; i++) {
  if (Number.isFinite(data[i])) {
    if (data[i] < actualMin) actualMin = data[i];
    if (data[i] > actualMax) actualMax = data[i];
  }
}
```

---

### `src/cesium/depth-layers.ts`

**Changes:**

1. `showDatasetSlice` now sets `layer.alpha = 0.85` on the added
   imagery layer to ensure the data overlay is visible
2. Removed debug logging (added during troubleshooting, then cleaned up)

---

### `src/cesium/config.ts`

**Changes:**

1. **Bug fix**: Wheel event handler now checks `!viewer.isDestroyed()`
   before calling `viewer.scene.requestRender()`. Previously, scrolling
   after the viewer was destroyed threw
   `TypeError: Cannot read properties of undefined (reading 'scene')`.

**Before (broken):**

```typescript
container.addEventListener('wheel', (event) => {
  event.preventDefault();
  viewer.scene.requestRender();  // crashes if viewer destroyed
}, { passive: false });
```

**After (fixed):**

```typescript
container.addEventListener('wheel', (event) => {
  event.preventDefault();
  if (!viewer.isDestroyed()) viewer.scene.requestRender();
}, { passive: false });
```

---

### `src/styles/light-theme.css`

**Changes:**

Added ~500 lines of analytics panel styles including:

| Style class | Purpose |
|-------------|---------|
| `.analytics-sidebar` | Right panel container (position, glass background, transition) |
| `.analytics-sidebar.collapsed` | Hidden state (translateX + opacity) |
| `.analytics-close-btn` | ✕ close button |
| `.analytics-size-btn` | ⚙ gear button (added in size overlay phase) |
| `.analytics-size-btn.active` | Gear button rotated 45° when overlay open |
| `.size-overlay` | Size controls dropdown (glass, blur, border) |
| `.size-overlay-title` | "Panel Size" label |
| `.size-row` | Slider row (label + slider + value) |
| `.size-label` | "Width" / "Height" / "Graph" labels |
| `.size-slider` | Range input styling (custom thumb) |
| `.size-value` | Numeric value display (e.g. "496px") |
| `.size-reset-btn` | Reset button |
| `.analytics-panel` | Inner panel content container |
| `.analytics-header` | Title section |
| `.analytics-title` | Variable title (large, bold) |
| `.analytics-metric` | Current value display |
| `.analytics-metric-value` | Large metric number |
| `.analytics-metric-unit` | Unit suffix |
| `.trend-row` | Trend + uncertainty on one row |
| `.analytics-trend` | Trend statement text |
| `.analytics-uncertainty` | Uncertainty text |
| `.analytics-description` | Variable description text |
| `.control-label` | Uppercase label above controls ("TIME", "MODE") |
| `.analytics-controls` | Segmented control container |
| `.control-group` | Single segmented control |
| `.control-btn` | Individual segment button |
| `.control-btn.active` | Active segment (highlighted) |
| `.analytics-chart-area` | Chart container (height set inline) |
| `.analytics-chart-empty` | Empty state message |
| `.analytics-loading` | Loading spinner state |
| `.year-chips` | Year selector container |
| `.year-chip` | Individual year chip |
| `.year-chip.active` | Selected year chip |
| `.reference-toggle` | Reference average checkbox |
| `.color-scale` | Color scale legend container |
| `.color-scale-bar` | Gradient bar |
| `.color-scale-ticks` | Tick marks under bar |
| `.color-scale-unit` | Unit label |

---

## 5. Analytics Module Architecture

```
src/analytics/
├── types.ts        # Shared TypeScript types
├── configs.ts      # Per-variable visualization configs
└── data-adapter.ts # Binary data → time series aggregation
```

**Data flow:**

```
User clicks layer in left sidebar
        ↓
App.tsx: setCurrentDatasetId(id)
        ↓
DepthPanel: showDatasetSlice(viewer, id, ...)  → globe renders with colormap
        ↓
AnalyticsPanel: derives variableId from DATASET_TO_VARIABLE[id]
        ↓
AnalyticsPanel: looks up VARIABLE_CONFIGS[variableId]
        ↓
data-adapter: getFullTimeSeries(config, resolution, mode, years)
        ↓
data-adapter: fetchBinData(buildBinPath(...))  → Float32Array
        ↓
data-adapter: aggregate (mean / sum / percentage)  → ChartPoint[]
        ↓
TimeSeriesChart: renders SVG with series, axes, tooltip
```

---

## 6. Chart Engine

The chart engine is a custom SVG renderer — no external dependency.

**Why custom SVG?**

- No bundle size increase (a charting library would add 50–200KB)
- Full control over tooltip positioning, crosshair, multi-year overlay
- SVG scales crisply at any DPI
- Sufficient performance for ≤100 data points per series

**Chart modes:**

| Mode | X-axis | Use case |
|------|--------|----------|
| `seasonal` | Months (Jan–Dec, 0–11) | SST, MHW, Arctic/Antarctic ice — multi-year comparison |
| `trend` | Time (year.fraction) | Sea level, pH — long-term evolution |

**Interaction:**

1. Mouse enters chart area → invisible `<rect>` captures events
2. Mouse moves → compute nearest x-index
3. Draw vertical guide line at nearest x
4. Find nearest point in each series
5. Show tooltip with date + all series values
6. Tooltip auto-repositions if near right edge
7. Mouse leaves → clear guide + tooltip

---

## 7. AnalyticsPanel Component

See [Section 3](#srccomponentsanalyticspaneltsx) for the full spec.

**Key behaviors:**

- **Reactive**: No internal variable selection. Derives everything from
  `currentDatasetId`.
- **Resolution-aware**: Monthly shows 12 points/year; Annual shows 1
  point/year.
- **Mode-aware**: Absolute shows raw values; Anomaly subtracts reference
  climatology.
- **Year-aware**: Selected years shown as colored lines; unselected
  years hidden.
- **Reference-aware**: Dashed line shows multi-year average when toggled.
- **Empty state**: Non-analytics datasets (ph_trend, vam) show a clear
  message instead of fake data.

---

## 8. Globe ↔ Graph Synchronization

**State flow:**

```
                    currentDatasetId (App.tsx)
                          │
              ┌───────────┼───────────────┐
              ▼                           ▼
    DepthPanel.tsx                AnalyticsPanel.tsx
    showDatasetSlice()            derives variableId
    → globe renders                → loads chart data
    with variable's                → renders chart
    specific colormap               → shows metric
                                   → shows color scale
```

**What synchronizes:**

| Element | Source | Updates when |
|---------|--------|-------------|
| Globe imagery | `showDatasetSlice(viewer, datasetId, ...)` | `currentDatasetId` changes |
| Globe colors | `getColormap(datasetId)` in `binary-data.ts` | `currentDatasetId` changes |
| Panel title | `VARIABLE_CONFIGS[variableId].title` | `currentDatasetId` changes |
| Metric value | `getLatestValue(config)` | `currentDatasetId` changes |
| Chart series | `getFullTimeSeries(config, ...)` | `currentDatasetId`, resolution, mode, years change |
| Color scale | `VARIABLE_CONFIGS[variableId].colorScale` | `currentDatasetId` changes |
| Year chips | `VARIABLE_CONFIGS[variableId].availableYears` | `currentDatasetId` changes |

---

## 9. Variable-Specific Colormaps

The globe previously used a single hardcoded `threeColorMap` function
(blue → green → red) for ALL variables. This meant SST, pH, sea ice,
and sea level all looked the same — just blue/green/red gradients with
no scientific meaning.

**After the fix:**

Each dataset ID maps to a specific `Colormap` in `colormaps.ts`. The
`fetchSliceCanvasForDataset` function looks up the colormap and passes
it to `dataToSmallCanvas`, which uses `valueToColor()` to map each data
value to the correct RGB.

**Color alignment verification:**

The colormap stops in `colormaps.ts` are identical to the `colorScale.stops`
in `configs.ts`. For example:

```
configs.ts (SST):   stops: ['#1e3a8a', '#2563eb', '#06b6d4', '#22c55e', '#eab308', '#f97316', '#dc2626']
colormaps.ts (SST): stops: ['#1e3a8a', '#2563eb', '#06b6d4', '#22c55e', '#eab308', '#f97316', '#dc2626']
```

This guarantees the globe and the right-panel legend show the same
colors for the same values.

---

## 10. Size Controls Overlay

A ⚙ gear button at the top-right of the analytics panel opens a small
overlay with three sliders:

| Control | Range | Default | Effect |
|---------|-------|---------|--------|
| Width | 280–720px | 496px | Panel width |
| Height | 40–100% | 54% | Panel height (% of viewport) |
| Graph | 120–600px | 277px | Chart area height |

**Implementation:**

- State lives in `App.tsx` (not AnalyticsPanel) so it persists across
  variable switches
- Values applied via inline `style` on the `.analytics-sidebar` div
  and the `.analytics-chart-area` div
- Reset button restores all three to `DEFAULT_SIZES`
- Gear button rotates 45° when overlay is open (visual feedback)

---

## 11. Bug Fixes Applied

### Bug 1: `RangeError: Maximum call stack size exceeded`

**Root cause**: `Math.min(...finiteVals)` and `Math.max(...finiteVals)`
used the spread operator to pass 683,000+ values as function arguments.
JavaScript engines have a call stack limit (~100K–1M arguments depending
on engine), so this overflowed.

**Fix**: Replaced with a simple `for` loop that tracks min/max inline.

**Affected files**: `src/cesium/binary-data.ts` (both
`fetchSliceCanvas` and `fetchSliceCanvasForDataset`)

---

### Bug 2: `TypeError: Cannot read properties of undefined (reading 'replace')`

**Root cause**: After the RangeError crashed `fetchSliceCanvasForDataset`,
the colormap stops array was in an undefined state, and `hexToRgb()`
tried to call `.replace()` on an undefined string.

**Fix**: Added safety guards in `sampleColormap()`:
- Check `stops` for undefined/empty → return gray
- Check individual stop strings for undefined → fall back to first/last

**Affected files**: `src/cesium/colormaps.ts`

---

### Bug 3: `TypeError: Cannot read properties of undefined (reading 'scene')`

**Root cause**: The wheel event handler in `config.ts` called
`viewer.scene.requestRender()` without checking if the viewer had been
destroyed. After the CesiumViewer component unmounted, the viewer was
destroyed but the event listener was still attached, so any scroll event
triggered the crash.

**Fix**: Added `if (!viewer.isDestroyed())` guard before accessing
`viewer.scene`.

**Affected files**: `src/cesium/config.ts`

---

### Bug 4: Globe ocean colors not changing

**Root cause**: The globe used a single hardcoded `threeColorMap`
function (blue → green → red) for ALL variables. Clicking different
layers loaded different data, but the colormap was identical, so the
visual difference was minimal — especially for variables like sea ice
(where the range 0–1 maps to nearly the same blue-green-red gradient as
SST's −2 to 35 range).

**Fix**: Created `src/cesium/colormaps.ts` with variable-specific
colormaps matching the right-panel legend. Modified `binary-data.ts`
to use `getColormap(dataset.id)` instead of the hardcoded function.

**Affected files**: `src/cesium/colormaps.ts` (new),
`src/cesium/binary-data.ts` (modified)

---

## 12. CSS Styling

All analytics styles are in `src/styles/light-theme.css`.

**Design language:**

- Glass-morphism: `rgba(15, 23, 42, 0.55)` background with
  `backdrop-filter: blur(20px) saturate(180%)`
- Compact typography: 11–13px body text, 10px labels
- Muted secondary text: `#94a3b8` / `#cbd5e1`
- Active states: white background with dark text
- Subtle borders: `rgba(255, 255, 255, 0.08)`
- Smooth transitions: `0.2s ease` for hover/active states
- Scientific feel: uppercase labels with letter-spacing, tabular-nums
  for numeric values

---

## 13. Data Sources Used

All data is real — fetched from local `.bin` files in `public/data/`.

| Dataset | Path | Grid | Size | Source |
|---------|------|------|------|--------|
| SST | `/data/sst/sst_t{NNNN}.bin` | 1440×681 | 3.9MB/slice | Copernicus Marine |
| MHW | `/data/mhw/mhw_t{NNNN}.bin` | 1440×681 | 3.9MB/slice | Copernicus (derived) |
| Surface pH | `/data/ph/ph_surface_t{NNNN}.bin` | 1440×720 | 4.1MB | Copernicus Marine |
| pH Trend | `/data/ph/ph_trend_t{NNNN}.bin` | 1440×713 | 4.1MB | Copernicus Marine |
| Sea Level | `/data/sea-level/sla_t{NNNN}.bin` | 1440×720 | 4.1MB | Copernicus Marine |
| Arctic Ice | `/data/sea-ice/ice_arctic_t{NNNN}.bin` | 1440×121 | 0.7MB | Copernicus Marine |
| Antarctic Ice | `/data/sea-ice/ice_antarctic_t{NNNN}.bin` | 1440×81 | 0.5MB | Copernicus Marine |

**Data format**: Raw `Float32Array` binary — each file is a 2D raster
(row-major, south-to-north, west-to-east). NaN = no data (land).

---

## 14. Chart Type Per Variable

| Variable | Chart Type | X-axis | Y-axis | Year Comparison | Reference | Color Scale |
|----------|-----------|--------|--------|-----------------|-----------|-------------|
| SST | Seasonal | Months (J–D) | °C | Yes (up to 6 years) | Dashed average | Blue→red (−2 to 35°C) |
| MHW | Seasonal | Months (J–D) | % | Yes (up to 6 years) | — | Yellow→red (0 to 4°C) |
| Sea Level | Trend | Time (years) | mm | No | — | Blue→red (−30 to 30 cm) |
| Surface pH | Trend | Time (years) | pH | Yes (up to 6 years) | Dashed average | Red→blue (7.75 to 8.35) |
| Arctic Ice | Seasonal | Months (J–D) | million km² | Yes (up to 6 years) | Dashed average | Dark blue→white (0 to 1) |
| Antarctic Ice | Seasonal | Months (J–D) | million km² | Yes (up to 6 years) | Dashed average | Dark blue→white (0 to 1) |

---

## 15. Remaining Limitations

1. **`ph_trend` has no analytics panel** — it's a static single-map
   dataset (no time series). The panel shows an empty state. Future
   work: add a trend-map analytics view.

2. **Daily resolution not implemented** — the data is monthly. The
   "Daily" control is shown but disabled for all variables. Daily data
   would require downloading higher-frequency Copernicus datasets.

3. **No uncertainty band in chart** — uncertainty is shown as text
   (`±0.04 °C`) but not as a shaded band around the curve. Future work:
   add `<path>` with fill for uncertainty range.

4. **No date navigation slider** — the chart shows the full time range.
   MyOcean Health has a date slider for selecting a specific date.
   Future work: add a date slider that updates both globe and chart.

5. **No globe↔chart click sync** — clicking a point on the chart
   doesn't fly the globe camera to that location. The `onPointSelect`
   callback exists but is not wired to camera movement.

6. **Arctic/Antarctic bbox only** — sea ice data only covers the polar
   regions (60°–90°N / −80° to −60°S). The globe shows data only in
   those bands, not globally.

7. **MHW max value exceeds configured range** — actual MHW data goes
   up to 5.8°C but the colormap max is 4°C. Values above 4°C are
   clamped to the darkest red. This is intentional (extreme events are
   rare) but could be adjusted.
