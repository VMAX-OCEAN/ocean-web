/**
 * AnalyticsPanel — right-side scientific data visualization panel.
 *
 * Inspired by MyOcean Health (https://myoceanhealth.marine.copernicus.eu/).
 *
 * IMPORTANT: This panel does NOT select layers. The LEFT sidebar is the
 * ONLY layer selector. This panel is purely reactive to `currentDatasetId`
 * and displays the selected layer's:
 *   - Title + large summary metric + uncertainty
 *   - Short scientific description
 *   - Monthly / Annual resolution controls
 *   - Absolute / Anomalies mode controls
 *   - Interactive SVG chart (seasonal comparison or long-term trend)
 *   - Year comparison chips (add/remove years)
 *   - Reference average toggle
 *   - Variable-specific color scale / legend
 *
 * Globe + graph share ONE state: `currentDatasetId` from the left sidebar.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import * as Cesium from 'cesium';
import { TimeSeriesChart } from './TimeSeriesChart';
import {
  getVariableConfig,
  getYearColor,
  REF_COLOR,
} from '../analytics/configs';
import {
  getFullTimeSeries,
  computeReferenceSeries,
  filterByYear,
  toAnnual,
  toAnomalies,
  getLatestValue,
  computeTrend,
} from '../analytics/data-adapter';
import type { VariableId, Resolution, Mode, ChartSeries, TimeSeriesPoint } from '../analytics/types';

interface AnalyticsPanelProps {
  viewer: Cesium.Viewer | null;
  active: boolean;
  /** Currently selected dataset ID from the LEFT sidebar (single source of truth) */
  currentDatasetId: string | null;
  /** Chart height in px (user-controllable from the size overlay) */
  chartHeight?: number;
}

/** Map dataset IDs from the left sidebar to analytics variable IDs. */
const DATASET_TO_VARIABLE: Record<string, VariableId> = {
  sst: 'sst',
  mhw: 'mhw',
  sea_level: 'sea_level',
  ph_surface: 'ocean_acidification',
  sea_ice_arctic: 'arctic_ice',
  sea_ice_antarctic: 'antarctic_ice',
};

export function AnalyticsPanel({ viewer, active, currentDatasetId, chartHeight = 220 }: AnalyticsPanelProps) {
  void viewer; // reserved for future globe↔graph hover sync
  // Derive the analytics variable from the left sidebar selection.
  const variableId: VariableId | null = currentDatasetId ? DATASET_TO_VARIABLE[currentDatasetId] ?? null : null;

  const [resolution, setResolution] = useState<Resolution>('monthly');
  const [mode, setMode] = useState<Mode>('absolute');
  const [selectedYears, setSelectedYears] = useState<number[]>([2024, 2023, 2022]);
  const [showReference, setShowReference] = useState(true);
  const [fullSeries, setFullSeries] = useState<TimeSeriesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<TimeSeriesPoint | null>(null);
  void selectedPoint; // reserved for future globe↔graph hover sync

  const config = useMemo(() => (variableId ? getVariableConfig(variableId) : null), [variableId]);

  // When the left-sidebar selection changes, reset state and load data.
  useEffect(() => {
    if (!active || !variableId || !config) {
      setFullSeries([]);
      return;
    }
    setLoading(true);
    setSelectedYears(config.defaultSelectedYears);
    setResolution(config.resolutions[0]);
    setMode('absolute');
    setShowReference(true);

    getFullTimeSeries(variableId, config)
      .then(series => {
        setFullSeries(series);
        setLoading(false);
      })
      .catch(() => {
        setFullSeries([]);
        setLoading(false);
      });
  }, [variableId, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Process data: apply anomalies if needed, aggregate to annual if needed.
  const processedSeries = useMemo(() => {
    if (fullSeries.length === 0 || !config) return [];
    let series = [...fullSeries];
    if (mode === 'anomalies' && config.supportsAnomalies) {
      series = toAnomalies(series, config);
    }
    if (resolution === 'annual') {
      series = toAnnual(series);
    }
    return series;
  }, [fullSeries, mode, resolution, config]);

  // Build chart series.
  const chartSeries = useMemo((): ChartSeries[] => {
    if (processedSeries.length === 0 || !config) return [];
    const result: ChartSeries[] = [];

    if (config.chartType === 'seasonal' && resolution === 'monthly') {
      // Seasonal: one line per selected year.
      for (const year of selectedYears) {
        const yearData = filterByYear(processedSeries, year);
        if (yearData.length > 0) {
          result.push({
            label: String(year),
            year,
            isReference: false,
            color: getYearColor(year),
            points: yearData,
            isCurrent: year === Math.max(...selectedYears),
          });
        }
      }
      // Reference average (dashed).
      if (showReference) {
        const refData = computeReferenceSeries(fullSeries, config);
        result.push({
          label: `Average ${config.referencePeriod}`,
          year: -1,
          isReference: true,
          color: REF_COLOR,
          points: refData,
          isCurrent: false,
        });
      }
    } else if (config.chartType === 'trend') {
      // Long-term trend: single line for all data.
      result.push({
        label: config.title,
        year: 0,
        isReference: false,
        color: '#e2e8f0',
        points: processedSeries,
        isCurrent: true,
      });
      // For pH trend with year comparison, add per-year seasonal lines.
      if (config.supportsYearComparison && resolution === 'monthly') {
        result.length = 0;
        for (const year of selectedYears) {
          const yearData = filterByYear(processedSeries, year);
          if (yearData.length > 0) {
            result.push({
              label: String(year),
              year,
              isReference: false,
              color: getYearColor(year),
              points: yearData,
              isCurrent: year === Math.max(...selectedYears),
            });
          }
        }
        if (showReference) {
          const refData = computeReferenceSeries(fullSeries, config);
          result.push({
            label: `Average ${config.referencePeriod}`,
            year: -1,
            isReference: true,
            color: REF_COLOR,
            points: refData,
            isCurrent: false,
          });
        }
      }
    }
    return result;
  }, [processedSeries, fullSeries, config, resolution, selectedYears, showReference]);

  // Summary metric.
  const summary = useMemo(() => {
    if (processedSeries.length === 0) return null;
    const latest = getLatestValue(processedSeries);
    const trend = computeTrend(fullSeries);
    return { latest, trend };
  }, [processedSeries, fullSeries]);

  const toggleYear = useCallback((year: number) => {
    setSelectedYears(prev =>
      prev.includes(year)
        ? prev.filter(y => y !== year)
        : [...prev, year].sort((a, b) => b - a)
    );
  }, []);

  const addYear = useCallback(() => {
    if (!config) return;
    const available = config.availableYears.filter(y => !selectedYears.includes(y));
    if (available.length > 0) {
      setSelectedYears(prev => [...prev, available[0]].sort((a, b) => b - a));
    }
  }, [config, selectedYears]);

  if (!active) return null;

  // No analytics-mapped dataset selected (e.g. VAM, ph_trend, or nothing).
  if (!variableId || !config) {
    return (
      <div className="analytics-panel">
        <div className="analytics-empty">
          <div className="analytics-empty-title">Ocean Analytics</div>
          <div className="analytics-empty-hint">
            Select an ocean health layer from the left panel to view its time series,
            trend, and color scale here.
          </div>
        </div>
      </div>
    );
  }

  const formatVal = (v: number) => {
    if (config.yAxisFormat === 'percentage') return `${v.toFixed(config.decimals)}%`;
    return `${v.toFixed(config.decimals)}`;
  };

  // Determine chart type for this resolution.
  const effectiveChartType = resolution === 'annual' ? 'trend' : config.chartType;
  const showYearChips = config.supportsYearComparison && resolution === 'monthly';

  return (
    <div className="analytics-panel">
      {/* ── Layer title + summary metric ── */}
      <div className="analytics-header">
        <div className="analytics-title">{config.title}</div>
        {summary?.latest && Number.isFinite(summary.latest.value) && (
          <div className="analytics-metric">
            <span className="metric-value">{formatVal(summary.latest.value)}</span>
            <span className="metric-unit">{config.unit}</span>
          </div>
        )}
        <div className="analytics-trend-row">
          {config.hasUncertainty && config.uncertainty && (
            <span className="analytics-uncertainty">± {config.uncertainty}</span>
          )}
          <span className="analytics-trend">Trend: {config.trendStatement}</span>
        </div>
        <div className="analytics-ref-period">Reference: {config.referencePeriod}</div>
      </div>

      {/* ── Description ── */}
      <div className="analytics-description">{config.description}</div>

      {/* ── Time controls: Daily / Monthly / Annual ── */}
      <div className="analytics-controls">
        <div className="control-label">Time</div>
        <div className="control-group">
          {config.resolutions.map(r => (
            <button
              key={r}
              className={`control-btn${resolution === r ? ' active' : ''}`}
              onClick={() => setResolution(r)}
            >
              {r === 'monthly' ? 'Monthly' : 'Annual'}
            </button>
          ))}
        </div>

        {/* Mode controls: Absolute / Anomalies */}
        {config.supportsAnomalies && (
          <>
            <div className="control-label">Mode</div>
            <div className="control-group">
              <button
                className={`control-btn${mode === 'absolute' ? ' active' : ''}`}
                onClick={() => setMode('absolute')}
              >
                Absolute
              </button>
              <button
                className={`control-btn${mode === 'anomalies' ? ' active' : ''}`}
                onClick={() => setMode('anomalies')}
              >
                Anomalies
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Interactive graph ── */}
      <div className="analytics-chart-area" style={{ height: `${chartHeight}px`, minHeight: '120px' }}>
        {loading ? (
          <div className="chart-loading">Loading data…</div>
        ) : chartSeries.length > 0 ? (
          <TimeSeriesChart
            series={chartSeries}
            chartType={effectiveChartType}
            unit={config.unit}
            decimals={config.decimals}
            yAxisFormat={config.yAxisFormat}
            yAxisRange={mode === 'anomalies' ? null : config.yAxisRange}
            onPointSelect={setSelectedPoint}
          />
        ) : (
          <div className="chart-loading">No data available</div>
        )}
      </div>

      {/* ── Year comparison chips ── */}
      {showYearChips && (
        <div className="year-chips">
          {[...selectedYears].sort((a, b) => b - a).map(year => (
            <button
              key={year}
              className={`year-chip${year === Math.max(...selectedYears) ? ' current' : ''}`}
              onClick={() => toggleYear(year)}
            >
              <span className="chip-dot" style={{ background: getYearColor(year) }} />
              {year}
              <span className="chip-remove">×</span>
            </button>
          ))}
          {showReference && (
            <span className="year-chip ref-chip">
              <span className="chip-dot" style={{ background: REF_COLOR }} />
              Avg {config.referencePeriod}
            </span>
          )}
          {selectedYears.length < config.availableYears.length && (
            <button className="year-chip add-chip" onClick={addYear}>+</button>
          )}
          <button
            className={`year-chip ref-toggle${showReference ? ' active' : ''}`}
            onClick={() => setShowReference(s => !s)}
            title="Toggle reference average"
          >
            Ref
          </button>
        </div>
      )}

      {/* ── Color scale / legend ── */}
      <div className="analytics-colorscale">
        <div
          className="colorscale-bar"
          style={{
            background: `linear-gradient(to right, ${config.colorScale.stops.join(', ')})`,
          }}
        />
        <div className="colorscale-labels">
          {config.colorScale.ticks.map((tick, i) => (
            <span key={i}>
              {config.colorScale.unit === 'pH' ? tick.toFixed(2) :
               config.colorScale.unit === '°C' ? `${tick}°` :
               config.colorScale.unit === 'cm' ? `${tick}` :
               config.colorScale.unit === 'fraction' ? tick.toFixed(2) :
               tick}
            </span>
          ))}
          <span className="colorscale-unit">{config.colorScale.unit}</span>
        </div>
        {config.colorScale.categories && (
          <div className="colorscale-categories">
            {config.colorScale.categories.map((cat, i) => (
              <span key={i} className="category-label">
                <span className="cat-dot" style={{ background: cat.color }} />
                {cat.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
