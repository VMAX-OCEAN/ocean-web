/**
 * Natural Earth label data: file paths, property filters, and label
 * extraction helpers.
 *
 * All data is Natural Earth (public domain, CC0).
 * https://www.naturalearthdata.com/
 *
 * Files are bundled locally in public/labels/ to avoid runtime fetch
 * from a third-party CDN.
 */

/** Label band identifier — matches the zoom hierarchy. */
export type LabelBandId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

/** A single label point to be rendered. */
export interface LabelPoint {
  lon: number;
  lat: number;
  text: string;
  /** Font size in pixels at 1:1 scale. */
  fontSize: number;
  /** Whether to show a halo (outline) around the text. */
  showHalo: boolean;
}

/** Metadata for a label band's data file. */
export interface LabelFile {
  id: LabelBandId;
  label: string;
  path: string;
  /** Load this band at startup (small file). If false, lazy-load. */
  loadAtStartup: boolean;
  /** Camera altitude below which to lazy-load this band (meters). */
  loadBelowAltitude: number;
}

/** Label data files, ordered by zoom level (far → near).
 *  Hierarchy matches Google Earth:
 *    Far:   Continents + Oceans (L0)
 *    ↓      + Countries (L1)
 *    ↓      + States/Provinces (L2)
 *    ↓      + Cities (L3)
 *    Near:  + Rivers + Seas (L4)
 */
export const LABEL_FILES: LabelFile[] = [
  {
    id: 'L0',
    label: 'Continents + Oceans',
    path: '/labels/ne_10m_geography_marine_polys.geojson',
    loadAtStartup: true,
    loadBelowAltitude: Number.MAX_VALUE,
  },
  {
    id: 'L1',
    label: 'Country names',
    path: '/labels/ne_10m_admin_0_label_points.geojson',
    loadAtStartup: false,
    loadBelowAltitude: 8_000_000,
  },
  {
    id: 'L2',
    label: 'State/province names',
    path: '/labels/geoboundaries_adm1_labels.json',
    loadAtStartup: false,
    loadBelowAltitude: 3_000_000,
  },
  {
    id: 'L3',
    label: 'Cities',
    path: '/labels/ne_10m_populated_places_simple.geojson',
    loadAtStartup: false,
    // Cities load AFTER states — staggered, not simultaneous
    loadBelowAltitude: 1_500_000,
  },
  {
    id: 'L4',
    label: 'Rivers + Seas',
    path: '/labels/ne_10m_rivers_lake_centerlines.geojson',
    loadAtStartup: false,
    loadBelowAltitude: 800_000,
  },
];

/** Altitude fade ranges for label bands (meters).
 *  Google Earth hierarchy: each band fades in as you zoom past its
 *  threshold, and fades out when the next-lower band takes over.
 *  Bands are staggered so they don't all appear at once.
 *
 *  IMPORTANT: No labels appear at high altitude (where clouds are
 *  visible, above 8,000 km). Labels only appear AFTER clouds fade
 *  out, so the text isn't obscured by the cloud layer. */
export const LABEL_FADE_RANGES: Record<LabelBandId, { fadeInStart: number; fadeInEnd: number; fadeOutStart: number; fadeOutEnd: number }> = {
  // L0 Continents + Oceans: fade in below 8M (after clouds gone),
  // fade out below 3M as countries appear
  L0: {
    fadeInStart: 8_000_000,
    fadeInEnd: 6_000_000,
    fadeOutStart: 3_000_000,
    fadeOutEnd: 1_500_000,
  },
  // L1 Countries: fade in below 6M (after continents), fade out below 1.5M
  L1: {
    fadeInStart: 6_000_000,
    fadeInEnd: 4_000_000,
    fadeOutStart: 1_500_000,
    fadeOutEnd: 800_000,
  },
  // L2 States: fade in below 3M, fade out below 800K as cities appear
  L2: {
    fadeInStart: 3_000_000,
    fadeInEnd: 2_000_000,
    fadeOutStart: 800_000,
    fadeOutEnd: 400_000,
  },
  // L3 Cities: fade in below 1.5M (AFTER states), stay visible at close zoom
  L3: {
    fadeInStart: 1_500_000,
    fadeInEnd: 1_000_000,
    fadeOutStart: 0,
    fadeOutEnd: 0,
  },
  // L4 Rivers + Seas: fade in below 800K (closest), stay visible
  L4: {
    fadeInStart: 800_000,
    fadeInEnd: 400_000,
    fadeOutStart: 0,
    fadeOutEnd: 0,
  },
};

/** Hardcoded continent label points (7 continents).
 *  Natural Earth doesn't have a dedicated continent label points file,
 *  so we hardcode the 7 canonical continent names at their centers. */
export const CONTINENT_LABELS: LabelPoint[] = [
  { lon: 20, lat: 5, text: 'Africa', fontSize: 28, showHalo: true },
  { lon: 0, lat: -85, text: 'Antarctica', fontSize: 22, showHalo: true },
  { lon: 95, lat: 45, text: 'Asia', fontSize: 28, showHalo: true },
  { lon: 135, lat: -25, text: 'Australia', fontSize: 22, showHalo: true },
  { lon: 15, lat: 52, text: 'Europe', fontSize: 24, showHalo: true },
  { lon: -100, lat: 50, text: 'North America', fontSize: 26, showHalo: true },
  { lon: -60, lat: -15, text: 'South America', fontSize: 26, showHalo: true },
];

/** Extract ocean labels from the marine polys GeoJSON. */
export function extractOceanLabels(geojson: any): LabelPoint[] {
  const labels: LabelPoint[] = [];
  if (!geojson || !Array.isArray(geojson.features)) return labels;
  for (const feature of geojson.features) {
    const featurecla = (feature.properties?.featurecla || feature.properties?.FEATURECLA || '').toLowerCase();
    if (featurecla !== 'ocean') continue;
    const name = feature.properties?.name || feature.properties?.NAME || feature.properties?.label;
    if (!name) continue;
    const geom = feature.geometry;
    if (!geom || !geom.coordinates) continue;
    if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;
    // Use the polygon centroid (approximate — first coordinate ring average)
    const coords = geom.type === 'Polygon'
      ? geom.coordinates[0]
      : geom.coordinates[0]?.[0];
    if (!Array.isArray(coords) || coords.length === 0) continue;
    let lonSum = 0, latSum = 0;
    for (const pt of coords) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      lonSum += pt[0];
      latSum += pt[1];
    }
    labels.push({ lon: lonSum / coords.length, lat: latSum / coords.length, text: name, fontSize: 24, showHalo: true });
  }
  return labels;
}

/** Extract country labels from admin_0_label_points GeoJSON.
 *  Show ALL countries (no scalerank filter — every country matters). */
export function extractCountryLabels(geojson: any): LabelPoint[] {
  const labels: LabelPoint[] = [];
  if (!geojson || !Array.isArray(geojson.features)) return labels;
  for (const feature of geojson.features) {
    const props = feature.properties ?? {};
    const name = props.name || props.NAME || props.label || props.LABEL;
    if (!name) continue;

    if (feature.geometry?.type !== 'Point') continue;
    const coords = feature.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    labels.push({ lon: coords[0], lat: coords[1], text: name, fontSize: 16, showHalo: true });
  }
  return labels;
}

/** Extract state/province labels from geoBoundaries ADM1 data.
 *  Data source: geoBoundaries CGAZ ADM1 (CC BY 4.0, William & Mary geoLab)
 *  Format: array of { name, country, lon, lat } — one per state/province,
 *  deduplicated by (name, country). Centroids computed from polygon
 *  bounding box centers (see scripts/extract-geoboundaries-labels.cjs).
 *
 *  This replaces Natural Earth's ne_10m_admin_1_label_points which had
 *  11,291 duplicate points for only 4,598 unique states. */
export function extractStateLabels(data: unknown): LabelPoint[] {
  const labels: LabelPoint[] = [];
  const entries = data as Array<{ name: string; country: string; lon: number; lat: number }>;
  if (!Array.isArray(entries)) return labels;

  for (const entry of entries) {
    if (!entry.name || typeof entry.lon !== 'number' || typeof entry.lat !== 'number') continue;
    labels.push({
      lon: entry.lon,
      lat: entry.lat,
      text: entry.name,
      fontSize: 14,
      showHalo: true,
    });
  }
  return labels;
}

/** Extract city labels from populated_places_simple GeoJSON.
 *  Show ALL cities — no scalerank filter. Capitals get larger font. */
export function extractCityLabels(geojson: any): LabelPoint[] {
  const labels: LabelPoint[] = [];
  if (!geojson || !Array.isArray(geojson.features)) return labels;
  for (const feature of geojson.features) {
    const props = feature.properties ?? {};
    const name = props.name || props.NAME || props.nameascii;
    if (!name) continue;

    if (feature.geometry?.type !== 'Point') continue;
    const coords = feature.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const isCapital = props.adm0cap === 1 || String(props.featurecla || '').toLowerCase().includes('capital');
    labels.push({
      lon: coords[0],
      lat: coords[1],
      text: name,
      fontSize: isCapital ? 14 : 12,
      showHalo: true,
    });
  }
  return labels;
}

/** Extract river labels from rivers_lake_centerlines GeoJSON.
 *  Show ALL named rivers (no scalerank filter). Uses the midpoint
 *  of each river line as the label position. */
export function extractRiverLabels(geojson: any): LabelPoint[] {
  const labels: LabelPoint[] = [];
  if (!geojson || !Array.isArray(geojson.features)) return labels;

  for (const feature of geojson.features) {
    const props = feature.properties ?? {};
    const name = props.name || props.NAME || props.name_en;
    if (!name) continue;

    const geom = feature.geometry;
    if (!geom || !geom.coordinates) continue;

    let coords: number[][] | undefined;
    if (geom.type === 'LineString') {
      coords = geom.coordinates;
    } else if (geom.type === 'MultiLineString') {
      // Use the first (longest) line in the multi-line
      coords = geom.coordinates[0];
    } else {
      continue;
    }

    if (!Array.isArray(coords) || coords.length < 2) continue;
    const midIdx = Math.floor(coords.length / 2);
    const point = coords[midIdx];
    if (!point || typeof point[0] !== 'number' || typeof point[1] !== 'number') continue;
    labels.push({ lon: point[0], lat: point[1], text: name, fontSize: 12, showHalo: true });
  }
  return labels;
}

/** Extract sea/gulf/bay/strait/channel labels from marine polys GeoJSON.
 *  Includes ALL marine features except oceans (which are in L0). */
export function extractSeaLabels(geojson: any): LabelPoint[] {
  const labels: LabelPoint[] = [];
  if (!geojson || !Array.isArray(geojson.features)) return labels;
  // All marine feature types in Natural Earth (excluding 'ocean' which
  // is handled separately in L0).
  const seaTypes = ['sea', 'gulf', 'bay', 'strait', 'channel', 'sound',
                    'reach', 'lagoon', 'harbour', 'cove', 'inlet'];
  for (const feature of geojson.features) {
    const props = feature.properties ?? {};
    const featurecla = String(props.featurecla || props.FEATURECLA || '').toLowerCase();
    if (featurecla === 'ocean') continue;
    if (!seaTypes.includes(featurecla)) continue;

    const name = props.name || props.NAME || props.label;
    if (!name) continue;

    const geom = feature.geometry;
    if (!geom || !geom.coordinates) continue;
    if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;

    const coords = geom.type === 'Polygon'
      ? geom.coordinates[0]
      : geom.coordinates[0]?.[0];
    if (!Array.isArray(coords) || coords.length === 0) continue;
    let lonSum = 0, latSum = 0;
    for (const pt of coords) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      lonSum += pt[0];
      latSum += pt[1];
    }
    labels.push({
      lon: lonSum / coords.length,
      lat: latSum / coords.length,
      text: name,
      fontSize: 13,
      showHalo: true,
    });
  }
  return labels;
}
