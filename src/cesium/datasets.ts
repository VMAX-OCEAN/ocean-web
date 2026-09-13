/**
 * Dataset catalog — defines all ocean datasets available for visualization.
 *
 * Each dataset specifies its grid dimensions, geographic bbox, variables,
 * time steps, depth levels, and the file pattern for locating .bin files.
 *
 * Time frequencies are categorized as:
 *   - 'daily'   — VAM 10-day intervals
 *   - 'monthly' — pH surface monthly means
 *   - 'static'  — pH trend (single map, no time axis)
 */

export type TimeFrequency = 'daily' | 'monthly' | 'static';

export interface DatasetVariable {
  id: string;
  label: string;
  units: string;
  min: number;
  max: number;
}

export type DatasetCategory = 'main' | 'advanced';

export interface DatasetConfig {
  id: string;
  label: string;
  source: string;
  doi: string;
  grid: { width: number; height: number };
  bbox: { west: number; south: number; east: number; north: number };
  depths: number[];
  times: string[];
  variables: DatasetVariable[];
  timeFrequency: TimeFrequency;
  dataPath: string;
  filePattern: string; // e.g. "{var}_d{depth}_t{time}.bin" or "{var}_t{time}.bin"
  hasDepth: boolean;
  metaFile?: string; // optional: load times from metadata JSON at runtime
  /** Sidebar grouping: 'main' = primary product card, 'advanced' = collapsed section */
  category: DatasetCategory;
  /** Short product name shown on the card (e.g. "Sea Surface Temperature") */
  product: string;
  /** Icon (emoji) shown on the card */
  icon: string;
  /** Coverage badge text (e.g. "Global", "Indian Ocean", "Arctic") */
  coverage: string;
}

/**
 * Generate monthly time steps from start to end (inclusive).
 * Used to avoid hardcoding 84+ time strings.
 */
function monthlyTimes(startYear: number, startMonth: number, endYear: number, endMonth: number): string[] {
  const times: string[] = [];
  let y = startYear, m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    const mm = String(m).padStart(2, '0');
    times.push(`${y}-${mm}-01T00:00:00Z`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return times;
}

/** All available datasets, keyed by id. */
export const DATASETS: Record<string, DatasetConfig> = {
  // ── VAM (Indian Ocean, 10-day, 24 depths) ──
  vam: {
    id: 'vam',
    label: 'VAM Temp/Sal (Indian Ocean)',
    source: 'INCOIS ERDDAP incois_argo_10d_VAM',
    doi: 'INCOIS',
    grid: { width: 90, height: 60 },
    bbox: { west: 30.5, south: -29.5, east: 119.5, north: 29.5 },
    depths: [5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500,
             600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000],
    times: [
      '2019-01-30T00:00:00Z', '2019-02-10T00:00:00Z', '2019-02-20T00:00:00Z',
      '2019-02-28T00:00:00Z', '2019-03-10T00:00:00Z', '2019-03-20T00:00:00Z',
      '2019-03-30T00:00:00Z', '2019-04-10T00:00:00Z', '2019-04-20T00:00:00Z',
      '2019-04-30T00:00:00Z', '2019-05-10T00:00:00Z',
    ],
    variables: [
      { id: 'temp', label: 'TEMP', units: '°C', min: 26, max: 30 },
      { id: 'sal', label: 'SAL', units: 'PSU', min: 34, max: 36 },
    ],
    timeFrequency: 'daily',
    dataPath: '/release-data/vam',
    filePattern: '{var}_d{depth}_t{time}.bin',
    hasDepth: true,
    category: 'advanced',
    product: 'Ocean Profiles (VAM)',
    icon: '🔬',
    coverage: 'Indian Ocean',
  },

  // ── pH Trend (Global, static, surface) ──
  ph_trend: {
    id: 'ph_trend',
    label: 'Ocean Acidification pH Trend (Global)',
    source: 'Copernicus Marine global_omi_health_carbon_ph_trend',
    doi: '10.48670/moi-00277',
    grid: { width: 1440, height: 713 },
    bbox: { west: -179.875, south: -88.125, east: 179.875, north: 89.875 },
    depths: [0],
    times: ['static'],
    variables: [
      { id: 'ph_trend', label: 'pH Trend', units: 'yr⁻¹', min: -0.003, max: 0.0005 },
      { id: 'ph_trend_unc', label: 'pH Trend Unc', units: 'yr⁻¹', min: 0, max: 0.0005 },
    ],
    timeFrequency: 'static',
    dataPath: '/release-data/ph',
    filePattern: '{var}_t{time}.bin',
    hasDepth: false,
    category: 'main',
    product: 'pH Trend (Global)',
    icon: '🧪',
    coverage: 'Global',
  },

  // ── pH Surface (Global, monthly, surface) ──
  ph_surface: {
    id: 'ph_surface',
    label: 'Surface Ocean pH (Global)',
    source: 'Copernicus Marine cmems_obs-mob_glo_bgc-car_my_irr-i',
    doi: '10.48670/moi-00047',
    grid: { width: 1440, height: 720 },
    bbox: { west: -179.875, south: -89.875, east: 179.875, north: 89.875 },
    depths: [0],
    times: monthlyTimes(2019, 1, 2024, 12),
    variables: [
      { id: 'ph', label: 'pH', units: 'pH', min: 7.75, max: 8.35 },
    ],
    timeFrequency: 'monthly',
    dataPath: '/release-data/ph',
    filePattern: '{var}_t{time}.bin',
    hasDepth: false,
    category: 'main',
    product: 'Surface pH',
    icon: '🧪',
    coverage: 'Global',
  },

  // ── Sea Level (Global, monthly, surface) ──
  sea_level: {
    id: 'sea_level',
    label: 'Sea Level (Global)',
    source: 'Copernicus Marine c3s_obs-sl_glo_phy-ssh_my_twosat-l4-duacs-0.25deg_P1M-m',
    doi: '10.48670/moi-00145',
    grid: { width: 1440, height: 720 },
    bbox: { west: -179.875, south: -89.875, east: 179.875, north: 89.875 },
    depths: [0],
    times: monthlyTimes(2019, 1, 2025, 12),
    variables: [
      { id: 'sla', label: 'Sea Level Anomaly', units: 'm', min: -0.3, max: 0.3 },
    ],
    timeFrequency: 'monthly',
    dataPath: '/release-data/sea-level',
    filePattern: '{var}_t{time}.bin',
    hasDepth: false,
    category: 'main',
    product: 'Sea Level',
    icon: '🌊',
    coverage: 'Global',
  },

  // ── Sea Surface Temperature (Global, monthly, surface) ──
  sst: {
    id: 'sst',
    label: 'Sea Surface Temperature (Global)',
    source: 'Copernicus Marine cmems_mod_glo_phy-all_my_0.25deg_P1M-m',
    doi: '10.48670/moi-00024',
    grid: { width: 1440, height: 681 },
    bbox: { west: -180.0, south: -80.0, east: 179.75, north: 90.0 },
    depths: [0],
    times: monthlyTimes(2019, 1, 2024, 12),
    variables: [
      { id: 'sst', label: 'SST', units: '°C', min: -2, max: 35 },
    ],
    timeFrequency: 'monthly',
    dataPath: '/release-data/sst',
    filePattern: '{var}_t{time}.bin',
    hasDepth: false,
    category: 'main',
    product: 'Sea Surface Temperature',
    icon: '🌡️',
    coverage: 'Global',
  },

  // ── Marine Heat Waves (Global, monthly, derived) ──
  mhw: {
    id: 'mhw',
    label: 'Marine Heat Waves (Global)',
    source: 'Copernicus Marine cmems_mod_glo_phy-all_my_0.25deg_P1M-m (derived)',
    doi: '10.48670/moi-00024',
    grid: { width: 1440, height: 681 },
    bbox: { west: -180.0, south: -80.0, east: 179.75, north: 90.0 },
    depths: [0],
    times: monthlyTimes(2019, 1, 2024, 12),
    variables: [
      { id: 'mhw', label: 'MHW Intensity', units: '°C', min: 0, max: 4 },
    ],
    timeFrequency: 'monthly',
    dataPath: '/release-data/mhw',
    filePattern: '{var}_t{time}.bin',
    hasDepth: false,
    category: 'main',
    product: 'Marine Heat Waves',
    icon: '🔥',
    coverage: 'Global',
  },

  // ── Arctic Sea Ice (Arctic, monthly, surface) ──
  sea_ice_arctic: {
    id: 'sea_ice_arctic',
    label: 'Arctic Sea Ice Extent',
    source: 'Copernicus Marine cmems_mod_glo_phy-all_my_0.25deg_P1M-m',
    doi: '10.48670/moi-00024',
    grid: { width: 1440, height: 121 },
    bbox: { west: -180.0, south: 60.0, east: 179.75, north: 90.0 },
    depths: [0],
    times: monthlyTimes(2019, 1, 2024, 12),
    variables: [
      { id: 'ice_arctic', label: 'Ice Concentration', units: 'fraction', min: 0, max: 1 },
    ],
    timeFrequency: 'monthly',
    dataPath: '/release-data/sea-ice',
    filePattern: '{var}_t{time}.bin',
    hasDepth: false,
    category: 'main',
    product: 'Arctic Sea Ice Extent',
    icon: '🧊',
    coverage: 'Arctic',
  },

  // ── Antarctic Sea Ice (Antarctic, monthly, surface) ──
  sea_ice_antarctic: {
    id: 'sea_ice_antarctic',
    label: 'Antarctic Sea Ice Extent',
    source: 'Copernicus Marine cmems_mod_glo_phy-all_my_0.25deg_P1M-m',
    doi: '10.48670/moi-00024',
    grid: { width: 1440, height: 81 },
    bbox: { west: -180.0, south: -80.0, east: 179.75, north: -60.0 },
    depths: [0],
    times: monthlyTimes(2019, 1, 2024, 12),
    variables: [
      { id: 'ice_antarctic', label: 'Ice Concentration', units: 'fraction', min: 0, max: 1 },
    ],
    timeFrequency: 'monthly',
    dataPath: '/release-data/sea-ice',
    filePattern: '{var}_t{time}.bin',
    hasDepth: false,
    category: 'main',
    product: 'Antarctic Sea Ice Extent',
    icon: '🧊',
    coverage: 'Antarctic',
  },
};

/** Get a dataset config by id. */
export function getDataset(id: string): DatasetConfig {
  return DATASETS[id] ?? DATASETS.vam;
}

/** List all dataset ids. */
export const DATASET_IDS = Object.keys(DATASETS);

/** Main product dataset ids (shown as cards in the primary list). */
export const MAIN_DATASET_IDS = DATASET_IDS.filter(
  id => DATASETS[id].category === 'main',
);

/** Advanced dataset ids (shown in collapsed Advanced section). */
export const ADVANCED_DATASET_IDS = DATASET_IDS.filter(
  id => DATASETS[id].category === 'advanced',
);

/** Build the .bin file path for a dataset slice. */
export function buildBinPath(
  dataset: DatasetConfig,
  variableId: string,
  depthIdx: number,
  timeIdx: number,
): string {
  const pattern = dataset.filePattern;
  const path = pattern
    .replace('{var}', variableId)
    .replace('{depth}', String(depthIdx))
    .replace('{time}', String(timeIdx).padStart(4, '0'));
  return `${dataset.dataPath}/${path}`;
}
