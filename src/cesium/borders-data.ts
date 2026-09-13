/**
 * Natural Earth GeoJSON data paths and feature classification.
 *
 * All four files are bundled locally in public/borders/ so the app
 * works offline (important for SIH demo/judging with no network).
 *
 * Data source: Natural Earth (public domain, CC0)
 * https://github.com/nvkelso/natural-earth-vector
 */

/** GeoJSON FeatureCollection (minimal typing — we only read what we need). */
export interface GeoJSONFeature {
  type: 'Feature';
  properties: {
    FEATURECLA?: string;
    SCALERANK?: number;
    MIN_ZOOM?: number;
    [key: string]: unknown;
  };
  geometry: {
    type: 'LineString' | 'MultiLineString';
    coordinates: number[][] | number[][][];
  };
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

/** The four border bands, ordered from coarsest to finest. */
export type BandId = 'L0' | 'L1' | 'L2' | 'L3';

export interface BandFile {
  id: BandId;
  label: string;
  path: string;
  /** When to start loading (camera altitude threshold in meters). */
  loadBelowAltitude: number;
}

export const BAND_FILES: BandFile[] = [
  {
    id: 'L0',
    label: 'Continents (110m)',
    path: 'borders/ne_110m_admin_0_boundary_lines_land.geojson',
    loadBelowAltitude: Number.MAX_VALUE, // always load at startup
  },
  {
    id: 'L1',
    label: 'Countries (50m)',
    path: 'borders/ne_50m_admin_0_boundary_lines_land.geojson',
    loadBelowAltitude: Number.MAX_VALUE, // always load at startup
  },
  {
    id: 'L2',
    label: 'Detailed countries (10m)',
    path: 'borders/ne_10m_admin_0_boundary_lines_land.geojson',
    loadBelowAltitude: 6_000_000, // lazy-load when zoomed below 6,000 km
  },
  {
    id: 'L3',
    label: 'States/provinces (10m)',
    path: 'borders/ne_10m_admin_1_states_provinces_lines.geojson',
    loadBelowAltitude: 1_500_000, // lazy-load when zoomed below 1,500 km
  },
];

/** Line style: solid or dashed/dotted. */
export interface BorderStyle {
  dash: 'solid' | 'dashed' | 'dotted';
  color: string; // hex, e.g. '#b0b0b0'
}

/**
 * Map Natural Earth's `featurecla` field to a border style.
 *
 * Note: 110m files use "verify" (no "d"), 10m files use "verified".
 * We handle both spellings.
 *
 * Google Earth convention:
 * - Solid gray = undisputed international boundaries
 * - Dashed gray = disputed / transitional boundaries
 * - Thin dotted light-gray = state/province internal borders
 */
export function classifyFeature(featurecla: string | undefined): BorderStyle {
  if (!featurecla) return { dash: 'solid', color: '#b0b0b0' };

  const fc = featurecla.toLowerCase();

  // Admin-1 (states/provinces) — always dotted
  if (fc.includes('admin-1')) {
    return { dash: 'dotted', color: '#c8c8c8' };
  }

  // Disputed / indefinite — dashed
  if (fc.includes('disputed') || fc.includes('indefinite')) {
    return { dash: 'dashed', color: '#b0b0b0' };
  }

  // Lease limits — short dashes
  if (fc.includes('lease')) {
    return { dash: 'dashed', color: '#9aa0a6' };
  }

  // Lines of separation — solid, slightly lighter
  if (fc.includes('separation')) {
    return { dash: 'solid', color: '#c8c8c8' };
  }

  // Default: verified international boundary — solid
  return { dash: 'solid', color: '#b0b0b0' };
}
