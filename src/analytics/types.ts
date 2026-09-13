/**
 * Analytics module types — shared visualization state and data shapes.
 *
 * One source of truth for globe + graph + sidebar.
 */

/** The 6 primary ocean health variables (matches MyOcean Health). */
export type VariableId =
  | 'sst'
  | 'mhw'
  | 'sea_level'
  | 'ocean_acidification'
  | 'arctic_ice'
  | 'antarctic_ice';

/** Time resolution. Daily not available in our monthly data. */
export type Resolution = 'monthly' | 'annual';

/** Absolute = measured value. Anomalies = deviation from reference. */
export type Mode = 'absolute' | 'anomalies';

/** Chart type per variable. */
export type ChartType = 'seasonal' | 'trend';

/** A single point in a time series. */
export interface TimeSeriesPoint {
  /** ISO date string, e.g. "2019-01-01T00:00:00Z" */
  date: string;
  /** Year, e.g. 2019 */
  year: number;
  /** Month 1-12 (0 for annual) */
  month: number;
  /** Aggregated value (global mean, extent, percentage, etc.) */
  value: number;
}

/** A named series for the chart (one year, or reference average). */
export interface ChartSeries {
  /** Label, e.g. "2024" or "Average 2019–2023" */
  label: string;
  /** Year number, or -1 for reference */
  year: number;
  /** Whether this is the reference/climatology line */
  isReference: boolean;
  /** Color */
  color: string;
  /** Data points */
  points: TimeSeriesPoint[];
  /** Whether this series is the "current/selected" year (stronger emphasis) */
  isCurrent: boolean;
}

/** Color scale definition per variable. */
export interface ColorScaleConfig {
  /** Gradient stops as CSS color values */
  stops: string[];
  /** Min value label */
  min: number;
  /** Max value label */
  max: number;
  /** Unit string */
  unit: string;
  /** Intermediate tick labels */
  ticks: number[];
  /** Optional category labels (for MHW severity) */
  categories?: { label: string; color: string }[];
}

/** Per-variable visualization configuration. */
export interface VariableConfig {
  id: VariableId;
  /** Display title */
  title: string;
  /** Short description shown in panel */
  description: string;
  /** Unit for the summary metric and y-axis */
  unit: string;
  /** Chart type */
  chartType: ChartType;
  /** Available resolutions */
  resolutions: Resolution[];
  /** Whether anomalies mode is supported */
  supportsAnomalies: boolean;
  /** Whether year comparison is supported */
  supportsYearComparison: boolean;
  /** Reference period label, e.g. "2019–2023" */
  referencePeriod: string;
  /** Reference years for climatology */
  referenceYears: number[];
  /** All available years in the data */
  availableYears: number[];
  /** Default selected years for comparison */
  defaultSelectedYears: number[];
  /** Color scale */
  colorScale: ColorScaleConfig;
  /** Y-axis format: 'decimal' | 'integer' | 'percentage' */
  yAxisFormat: 'decimal' | 'integer' | 'percentage';
  /** Number of decimal places for values */
  decimals: number;
  /** Whether uncertainty is available */
  hasUncertainty: boolean;
  /** Trend statement for the summary */
  trendStatement: string;
  /** Uncertainty value (if available) */
  uncertainty?: string;
  /** Maps to the dataset ID in datasets.ts */
  datasetId: string;
  /** Variable ID within the dataset */
  datasetVariableId: string;
  /** Aggregation method for spatial → time series */
  aggregation: 'mean' | 'extent' | 'percentage';
  /** Whether to area-weight the aggregation */
  areaWeighted: boolean;
  /** Threshold for extent calculation (ice concentration > threshold) */
  extentThreshold?: number;
  /** Y-axis range override [min, max] or null for auto */
  yAxisRange: [number, number] | null;
}
