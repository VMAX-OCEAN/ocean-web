/**
 * Variable-specific colormaps for globe rendering.
 *
 * These mirror the color scales in src/analytics/configs.ts so the globe
 * and the right-panel legend always show the same colors for the same values.
 *
 * Each colormap is keyed by dataset id (the same id used in datasets.ts and
 * selected in the left sidebar). Stops are hex colors; min/max are the
 * value range that maps to the first/last stop.
 */

export interface Colormap {
  /** Hex color stops, evenly spaced from min to max. */
  stops: string[];
  /** Value at the first stop. */
  min: number;
  /** Value at the last stop. */
  max: number;
}

/** Per-dataset colormaps (must match configs.ts colorScale entries). */
export const COLORMAPS: Record<string, Colormap> = {
  // Sea Surface Temperature — blue (cold) → red (warm)
  sst: {
    stops: ['#1e3a8a', '#2563eb', '#06b6d4', '#22c55e', '#eab308', '#f97316', '#dc2626'],
    min: -2,
    max: 35,
  },
  // Marine Heat Waves — yellow → deep red (intensity)
  mhw: {
    stops: ['#fbbf24', '#f97316', '#ef4444', '#991b1b'],
    min: 0,
    max: 4,
  },
  // Sea Level — blue (low) → red (high), data in meters
  sea_level: {
    stops: ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#fbbf24', '#f97316', '#dc2626'],
    min: -0.3,
    max: 0.3,
  },
  // Surface pH — red (acidic) → blue (basic)
  ph_surface: {
    stops: ['#dc2626', '#f97316', '#fbbf24', '#22c55e', '#06b6d4', '#3b82f6'],
    min: 7.75,
    max: 8.35,
  },
  // pH Trend — diverging: red (decreasing) → white → blue (increasing)
  ph_trend: {
    stops: ['#dc2626', '#f97316', '#fbbf24', '#f1f5f9', '#bae6fd', '#38bdf8', '#1d4ed8'],
    min: -0.003,
    max: 0.0005,
  },
  // Arctic Sea Ice — dark blue (open water) → white (full ice)
  sea_ice_arctic: {
    stops: ['#0c4a6e', '#0284c7', '#38bdf8', '#bae6fd', '#f1f5f9'],
    min: 0,
    max: 1,
  },
  // Antarctic Sea Ice — same as Arctic
  sea_ice_antarctic: {
    stops: ['#0c4a6e', '#0284c7', '#38bdf8', '#bae6fd', '#f1f5f9'],
    min: 0,
    max: 1,
  },
};

/** Default fallback colormap (generic blue → green → red). */
const DEFAULT_COLORMAP: Colormap = {
  stops: ['#1e3a8a', '#06b6d4', '#22c55e', '#eab308', '#dc2626'],
  min: 0,
  max: 1,
};

/** Get the colormap for a dataset id. Falls back to a generic scale. */
export function getColormap(datasetId: string): Colormap {
  return COLORMAPS[datasetId] ?? DEFAULT_COLORMAP;
}

/** Convert a hex color (#rrggbb) to [r, g, b] in 0–255. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Sample a colormap at a normalized position t ∈ [0, 1].
 * Returns [r, g, b] in 0–255. Clamps t to [0, 1].
 */
export function sampleColormap(stops: string[], t: number): [number, number, number] {
  if (!stops || stops.length === 0) return [128, 128, 128];
  const tc = Math.max(0, Math.min(1, t));
  if (stops.length === 1) return hexToRgb(stops[0]);

  const seg = tc * (stops.length - 1);
  const i = Math.min(Math.floor(seg), stops.length - 2);
  const frac = seg - i;

  const c0 = stops[i] ?? stops[0];
  const c1 = stops[i + 1] ?? stops[stops.length - 1];

  const [r0, g0, b0] = hexToRgb(c0);
  const [r1, g1, b1] = hexToRgb(c1);

  return [
    Math.round(r0 + (r1 - r0) * frac),
    Math.round(g0 + (g1 - g0) * frac),
    Math.round(b0 + (b1 - b0) * frac),
  ];
}

/**
 * Map a data value to RGB using a colormap's stops + range.
 * NaN/Infinity → transparent (caller checks).
 */
export function valueToColor(colormap: Colormap, value: number): [number, number, number] {
  const t = (value - colormap.min) / (colormap.max - colormap.min);
  return sampleColormap(colormap.stops, t);
}
