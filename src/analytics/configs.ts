/**
 * Variable-specific visualization configurations.
 *
 * Each of the 6 ocean health variables has its own config:
 * - Chart type (seasonal comparison vs long-term trend)
 * - Available resolutions
 * - Color scale
 * - Reference period
 * - Aggregation method
 * - Y-axis format
 *
 * Data sources (from datasets.ts):
 *   sst:             72 monthly, 2019-2024, global, °C
 *   mhw:             72 monthly, 2019-2024, global, °C intensity
 *   sea_level:       84 monthly, 2019-2025, global, meters (anomaly)
 *   ph_surface:      72 monthly, 2019-2024, global, pH
 *   sea_ice_arctic:  72 monthly, 2019-2024, Arctic, fraction
 *   sea_ice_antarctic: 72 monthly, 2019-2024, Antarctic, fraction
 */

import type { VariableConfig, VariableId } from './types';

const ALL_YEARS = [2019, 2020, 2021, 2022, 2023, 2024];
const SEA_LEVEL_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const REF_YEARS = [2019, 2020, 2021, 2022, 2023];

/** Year colors — current year white, others subdued blues. */
const YEAR_COLORS: Record<number, string> = {
  2019: '#64748b',
  2020: '#7dd3fc',
  2021: '#38bdf8',
  2022: '#0ea5e9',
  2023: '#0284c7',
  2024: '#e2e8f0',
  2025: '#f1f5f9',
};
export const REF_COLOR = '#94a3b8';

export function getYearColor(year: number): string {
  return YEAR_COLORS[year] ?? '#cbd5e1';
}

export const VARIABLE_CONFIGS: Record<VariableId, VariableConfig> = {
  // ── Sea Surface Temperature ──
  sst: {
    id: 'sst',
    title: 'Sea Surface Temperature',
    description:
      'Global ocean surface temperature. SST has increased ~0.5°C since the 1980s, ' +
      'driving marine heatwaves and ecosystem shifts.',
    unit: '°C',
    chartType: 'seasonal',
    resolutions: ['monthly', 'annual'],
    supportsAnomalies: true,
    supportsYearComparison: true,
    referencePeriod: '2019–2023',
    referenceYears: REF_YEARS,
    availableYears: ALL_YEARS,
    defaultSelectedYears: [2024, 2023, 2022],
    colorScale: {
      stops: ['#1e3a8a', '#2563eb', '#06b6d4', '#22c55e', '#eab308', '#f97316', '#dc2626'],
      min: -2,
      max: 35,
      unit: '°C',
      ticks: [-2, 5, 12, 20, 28, 35],
    },
    yAxisFormat: 'decimal',
    decimals: 2,
    hasUncertainty: true,
    trendStatement: '+0.04 °C/decade',
    uncertainty: '±0.04 °C',
    datasetId: 'sst',
    datasetVariableId: 'sst',
    aggregation: 'mean',
    areaWeighted: true,
    yAxisRange: null,
  },

  // ── Marine Heat Waves ──
  mhw: {
    id: 'mhw',
    title: 'Marine Heat Waves',
    description:
      'Percentage of global ocean experiencing marine heat wave conditions. ' +
      'MHW occurs when SST exceeds the 90th percentile of the seasonal climatology.',
    unit: '%',
    chartType: 'seasonal',
    resolutions: ['monthly', 'annual'],
    supportsAnomalies: false,
    supportsYearComparison: true,
    referencePeriod: '2019–2023',
    referenceYears: REF_YEARS,
    availableYears: ALL_YEARS,
    defaultSelectedYears: [2024, 2023, 2022],
    colorScale: {
      stops: ['#fbbf24', '#f97316', '#ef4444', '#991b1b'],
      min: 0,
      max: 4,
      unit: '°C',
      ticks: [0, 1, 2, 3, 4],
      categories: [
        { label: 'Moderate', color: '#fbbf24' },
        { label: 'Strong', color: '#f97316' },
        { label: 'Severe', color: '#ef4444' },
        { label: 'Extreme', color: '#991b1b' },
      ],
    },
    yAxisFormat: 'percentage',
    decimals: 1,
    hasUncertainty: false,
    trendStatement: 'Increasing',
    datasetId: 'mhw',
    datasetVariableId: 'mhw',
    aggregation: 'percentage',
    areaWeighted: true,
    yAxisRange: [0, 40],
  },

  // ── Sea Level ──
  sea_level: {
    id: 'sea_level',
    title: 'Sea Level',
    description:
      'Global mean sea level anomaly (SLA) relative to the 1993–2012 reference. ' +
      'Sea level rises ~3.4 mm/year due to thermal expansion and ice melt.',
    unit: 'mm',
    chartType: 'trend',
    resolutions: ['monthly', 'annual'],
    supportsAnomalies: false,
    supportsYearComparison: false,
    referencePeriod: '1993–2012',
    referenceYears: [],
    availableYears: SEA_LEVEL_YEARS,
    defaultSelectedYears: [2025],
    colorScale: {
      stops: ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#fbbf24', '#f97316', '#dc2626'],
      min: -30,
      max: 30,
      unit: 'cm',
      ticks: [-30, -15, 0, 15, 30],
    },
    yAxisFormat: 'decimal',
    decimals: 1,
    hasUncertainty: true,
    trendStatement: '+3.4 mm/year',
    uncertainty: '±0.4 mm/year',
    datasetId: 'sea_level',
    datasetVariableId: 'sla',
    aggregation: 'mean',
    areaWeighted: true,
    yAxisRange: null,
  },

  // ── Ocean Acidification ──
  ocean_acidification: {
    id: 'ocean_acidification',
    title: 'Ocean Acidification',
    description:
      'Surface ocean pH. The ocean absorbs ~30% of CO₂ emissions, lowering pH ' +
      '(acidification) and threatening marine organisms, especially calcifiers.',
    unit: 'pH',
    chartType: 'trend',
    resolutions: ['monthly', 'annual'],
    supportsAnomalies: true,
    supportsYearComparison: true,
    referencePeriod: '2019–2023',
    referenceYears: REF_YEARS,
    availableYears: ALL_YEARS,
    defaultSelectedYears: [2024, 2023],
    colorScale: {
      stops: ['#dc2626', '#f97316', '#fbbf24', '#22c55e', '#06b6d4', '#3b82f6'],
      min: 7.75,
      max: 8.35,
      unit: 'pH',
      ticks: [7.75, 7.90, 8.05, 8.20, 8.35],
    },
    yAxisFormat: 'decimal',
    decimals: 3,
    hasUncertainty: true,
    trendStatement: '−0.0017 pH/year',
    uncertainty: '±0.0002 pH/year',
    datasetId: 'ph_surface',
    datasetVariableId: 'ph',
    aggregation: 'mean',
    areaWeighted: true,
    yAxisRange: [7.75, 8.35],
  },

  // ── Arctic Sea Ice Extent ──
  arctic_ice: {
    id: 'arctic_ice',
    title: 'Arctic Sea Ice Extent',
    description:
      'Arctic sea ice extent — area with ice concentration > 15%. ' +
      'Arctic ice is declining ~12% per decade, with record lows in recent years.',
    unit: 'million km²',
    chartType: 'seasonal',
    resolutions: ['monthly', 'annual'],
    supportsAnomalies: true,
    supportsYearComparison: true,
    referencePeriod: '2019–2023',
    referenceYears: REF_YEARS,
    availableYears: ALL_YEARS,
    defaultSelectedYears: [2024, 2023, 2022],
    colorScale: {
      stops: ['#0c4a6e', '#0284c7', '#38bdf8', '#bae6fd', '#f1f5f9'],
      min: 0,
      max: 1,
      unit: 'fraction',
      ticks: [0, 0.25, 0.5, 0.75, 1.0],
    },
    yAxisFormat: 'decimal',
    decimals: 2,
    hasUncertainty: false,
    trendStatement: '−12% per decade',
    datasetId: 'sea_ice_arctic',
    datasetVariableId: 'ice_arctic',
    aggregation: 'extent',
    areaWeighted: false,
    extentThreshold: 0.15,
    yAxisRange: null,
  },

  // ── Antarctic Sea Ice Extent ──
  antarctic_ice: {
    id: 'antarctic_ice',
    title: 'Antarctic Sea Ice Extent',
    description:
      'Antarctic sea ice extent — area with ice concentration > 15%. ' +
      'Antarctic ice shows high variability, with record lows in 2023.',
    unit: 'million km²',
    chartType: 'seasonal',
    resolutions: ['monthly', 'annual'],
    supportsAnomalies: true,
    supportsYearComparison: true,
    referencePeriod: '2019–2023',
    referenceYears: REF_YEARS,
    availableYears: ALL_YEARS,
    defaultSelectedYears: [2024, 2023, 2022],
    colorScale: {
      stops: ['#0c4a6e', '#0284c7', '#38bdf8', '#bae6fd', '#f1f5f9'],
      min: 0,
      max: 1,
      unit: 'fraction',
      ticks: [0, 0.25, 0.5, 0.75, 1.0],
    },
    yAxisFormat: 'decimal',
    decimals: 2,
    hasUncertainty: false,
    trendStatement: 'High variability',
    datasetId: 'sea_ice_antarctic',
    datasetVariableId: 'ice_antarctic',
    aggregation: 'extent',
    areaWeighted: false,
    extentThreshold: 0.15,
    yAxisRange: null,
  },
};

/** Get config for a variable. */
export function getVariableConfig(id: VariableId): VariableConfig {
  return VARIABLE_CONFIGS[id];
}

/** All variable IDs in display order. */
export const VARIABLE_IDS: VariableId[] = [
  'sst',
  'mhw',
  'sea_level',
  'ocean_acidification',
  'arctic_ice',
  'antarctic_ice',
];
