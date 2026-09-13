/**
 * TimeSeriesChart — custom SVG chart engine for scientific visualization.
 *
 * Supports two chart types:
 *   'seasonal' — x = months (Jan–Dec), multiple year lines + reference
 *   'trend'    — x = time, single line + optional trend line
 *
 * Features:
 *   - Vertical hover guide line
 *   - Highlighted data point on hover
 *   - Custom HTML tooltip (not browser default)
 *   - Tooltip edge repositioning
 *   - Subtle grid lines
 *   - Thin chart lines
 *   - Selected year emphasis, others subdued
 *   - Reference line dashed
 *   - Responsive (ResizeObserver)
 */

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { ChartSeries, ChartType, TimeSeriesPoint } from '../analytics/types';

interface TimeSeriesChartProps {
  series: ChartSeries[];
  chartType: ChartType;
  unit: string;
  decimals: number;
  yAxisFormat: 'decimal' | 'integer' | 'percentage';
  yAxisRange: [number, number] | null;
  /** Called when user hovers/clicks a point */
  onPointSelect?: (point: TimeSeriesPoint | null) => void;
}

const MARGIN = { top: 12, right: 16, bottom: 28, left: 48 };
const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

function formatValue(v: number, decimals: number, format: 'decimal' | 'integer' | 'percentage'): string {
  if (format === 'percentage') return `${v.toFixed(decimals)}%`;
  if (format === 'integer') return Math.round(v).toString();
  return v.toFixed(decimals);
}

function formatYAxis(v: number, format: 'decimal' | 'integer' | 'percentage'): string {
  if (format === 'percentage') return `${v.toFixed(0)}%`;
  if (format === 'integer') return Math.round(v).toString();
  return v.toFixed(Math.abs(v) < 10 ? 1 : 0);
}

export function TimeSeriesChart({
  series,
  chartType,
  unit,
  decimals,
  yAxisFormat,
  yAxisRange,
  onPointSelect,
}: TimeSeriesChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 200 });
  const [hover, setHover] = useState<{ x: number; y: number; point: TimeSeriesPoint; series: ChartSeries } | null>(null);

  // Responsive sizing
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width: Math.max(200, width), height: Math.max(150, height) });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Compute y-axis range
  const yRange = useMemo(() => {
    if (yAxisRange) return yAxisRange;
    let min = Infinity, max = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (Number.isFinite(p.value)) {
          min = Math.min(min, p.value);
          max = Math.max(max, p.value);
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1] as [number, number];
    const padding = (max - min) * 0.1 || 0.1;
    return [min - padding, max + padding] as [number, number];
  }, [series, yAxisRange]);

  const plotW = Math.max(10, size.width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(10, size.height - MARGIN.top - MARGIN.bottom);

  // X-axis mapping (for trend, computed via trendXDomain below)
  const trendXDomain = useMemo(() => {
    if (chartType !== 'trend') return null;
    let minTime = Infinity, maxTime = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        const t = new Date(p.date).getTime();
        if (Number.isFinite(t)) {
          minTime = Math.min(minTime, t);
          maxTime = Math.max(maxTime, t);
        }
      }
    }
    if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) return null;
    return { min: minTime, max: maxTime };
  }, [series, chartType]);

  const yScale = useCallback((value: number): number => {
    const [min, max] = yRange;
    const t = (value - min) / (max - min || 1);
    return MARGIN.top + plotH - t * plotH;
  }, [yRange, plotH]);

  const xForPoint = useCallback((point: TimeSeriesPoint): number => {
    if (chartType === 'seasonal') {
      return MARGIN.left + ((point.month - 1) / 11) * plotW;
    }
    if (trendXDomain) {
      const t = new Date(point.date).getTime();
      const frac = (t - trendXDomain.min) / (trendXDomain.max - trendXDomain.min || 1);
      return MARGIN.left + frac * plotW;
    }
    return MARGIN.left;
  }, [chartType, trendXDomain, plotW]);

  // Y-axis ticks
  const yTicks = useMemo(() => {
    const [min, max] = yRange;
    const ticks: number[] = [];
    const count = 5;
    for (let i = 0; i <= count; i++) {
      ticks.push(min + (i / count) * (max - min));
    }
    return ticks;
  }, [yRange]);

  // X-axis labels
  const xLabels = useMemo(() => {
    if (chartType === 'seasonal') {
      return MONTH_LABELS.map((label, i) => ({
        label,
        x: MARGIN.left + (i / 11) * plotW,
      }));
    }
    // trend: show year labels
    if (!trendXDomain) return [];
    const labels: { label: string; x: number }[] = [];
    const allYears = new Set<number>();
    for (const s of series) {
      for (const p of s.points) {
        allYears.add(p.year);
      }
    }
    const years = [...allYears].sort((a, b) => a - b);
    for (const year of years) {
      const t = new Date(`${year}-06-01T00:00:00Z`).getTime();
      if (t >= trendXDomain.min && t <= trendXDomain.max) {
        const frac = (t - trendXDomain.min) / (trendXDomain.max - trendXDomain.min || 1);
        labels.push({ label: String(year), x: MARGIN.left + frac * plotW });
      }
    }
    return labels;
  }, [chartType, trendXDomain, plotW, series]);

  // Build SVG path for a series
  const pathForSeries = useCallback((s: ChartSeries): string => {
    const pts = s.points.filter(p => Number.isFinite(p.value));
    if (pts.length === 0) return '';
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      const x = xForPoint(pts[i]);
      const y = yScale(pts[i].value);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    return d;
  }, [xForPoint, yScale]);

  // Mouse handling
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    // Find nearest data point across all series
    let nearest: { x: number; y: number; point: TimeSeriesPoint; series: ChartSeries } | null = null;
    let minDist = Infinity;

    for (const s of series) {
      for (const p of s.points) {
        if (!Number.isFinite(p.value)) continue;
        const px = xForPoint(p);
        const dist = Math.abs(px - mouseX);
        if (dist < minDist) {
          minDist = dist;
          nearest = {
            x: px,
            y: yScale(p.value),
            point: p,
            series: s,
          };
        }
      }
    }

    if (nearest && minDist < 30) {
      setHover(nearest);
      onPointSelect?.(nearest.point);
    } else {
      setHover(null);
      onPointSelect?.(null);
    }
  }, [series, xForPoint, yScale, onPointSelect]);

  const handleMouseLeave = useCallback(() => {
    setHover(null);
    onPointSelect?.(null);
  }, [onPointSelect]);

  // Tooltip position (keep inside chart)
  const tooltipPos = useMemo(() => {
    if (!hover) return null;
    const tooltipW = 140;
    const tooltipH = 80;
    let tx = hover.x + 12;
    let ty = hover.y - tooltipH - 8;
    if (tx + tooltipW > size.width) tx = hover.x - tooltipW - 12;
    if (ty < 0) ty = hover.y + 12;
    return { x: tx, y: ty };
  }, [hover, size.width]);

  // Collect all points at the hovered x position (for multi-year tooltip)
  const hoverPoints = useMemo(() => {
    if (!hover) return [];
    const targetMonth = hover.point.month;
    const results: { series: ChartSeries; point: TimeSeriesPoint }[] = [];
    for (const s of series) {
      if (chartType === 'seasonal') {
        const p = s.points.find(pt => pt.month === targetMonth && Number.isFinite(pt.value));
        if (p) results.push({ series: s, point: p });
      } else {
        // trend: find nearest by date
        const p = s.points.find(pt =>
          Math.abs(new Date(pt.date).getTime() - new Date(hover.point.date).getTime()) < 86400000 * 15
          && Number.isFinite(pt.value)
        );
        if (p) results.push({ series: s, point: p });
      }
    }
    return results;
  }, [hover, series, chartType]);

  return (
    <div className="chart-container" ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        width={size.width}
        height={size.height}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Grid lines (horizontal) */}
        {yTicks.map((tick, i) => (
          <g key={`ygrid-${i}`}>
            <line
              x1={MARGIN.left}
              y1={yScale(tick)}
              x2={MARGIN.left + plotW}
              y2={yScale(tick)}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
            <text
              x={MARGIN.left - 6}
              y={yScale(tick) + 3}
              textAnchor="end"
              fill="rgba(255,255,255,0.4)"
              fontSize={9}
              fontFamily="inherit"
            >
              {formatYAxis(tick, yAxisFormat)}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {xLabels.map((xl, i) => (
          <text
            key={`xlabel-${i}`}
            x={xl.x}
            y={size.height - 8}
            textAnchor="middle"
            fill="rgba(255,255,255,0.4)"
            fontSize={9}
            fontFamily="inherit"
          >
            {xl.label}
          </text>
        ))}

        {/* Series lines */}
        {series.map((s, i) => {
          const path = pathForSeries(s);
          const isEmphasis = s.isCurrent;
          const opacity = s.isReference ? 0.7 : (isEmphasis ? 1.0 : 0.5);
          const strokeWidth = s.isReference ? 1.2 : (isEmphasis ? 2.0 : 1.2);
          const dashArray = s.isReference ? '4 3' : undefined;
          return (
            <path
              key={`series-${i}`}
              d={path}
              fill="none"
              stroke={s.color}
              strokeWidth={strokeWidth}
              strokeOpacity={opacity}
              strokeDasharray={dashArray}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {/* Hover guide line */}
        {hover && (
          <line
            x1={hover.x}
            y1={MARGIN.top}
            x2={hover.x}
            y2={MARGIN.top + plotH}
            stroke="rgba(255,255,255,0.3)"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        )}

        {/* Hover points */}
        {hoverPoints.map((hp, i) => (
          <circle
            key={`hover-pt-${i}`}
            cx={xForPoint(hp.point)}
            cy={yScale(hp.point.value)}
            r={hp.series.isCurrent ? 4 : 3}
            fill={hp.series.color}
            stroke="rgba(15,23,42,0.8)"
            strokeWidth={1}
          />
        ))}

        {/* Mouse capture rect */}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
      </svg>

      {/* Custom tooltip */}
      {hover && tooltipPos && (
        <div
          className="chart-tooltip"
          style={{
            position: 'absolute',
            left: tooltipPos.x,
            top: tooltipPos.y,
            pointerEvents: 'none',
          }}
        >
          {chartType === 'seasonal' ? (
            <>
              <div className="tooltip-date">
                {hover.point.month === 0 ? '' : new Date(hover.point.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </div>
              {hoverPoints
                .sort((a, b) => {
                  // Current year first, then by year descending
                  if (a.series.isCurrent) return -1;
                  if (b.series.isCurrent) return 1;
                  return b.point.year - a.point.year;
                })
                .map((hp, i) => (
                  <div key={i} className="tooltip-row">
                    <span className="tooltip-dot" style={{ background: hp.series.color }} />
                    <span className="tooltip-label">{hp.series.label}</span>
                    <span className="tooltip-value">
                      {formatValue(hp.point.value, decimals, yAxisFormat)} {unit}
                    </span>
                  </div>
                ))}
            </>
          ) : (
            <>
              <div className="tooltip-date">
                {new Date(hover.point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <div className="tooltip-row">
                <span className="tooltip-dot" style={{ background: hover.series.color }} />
                <span className="tooltip-label">{hover.series.label}</span>
                <span className="tooltip-value">
                  {formatValue(hover.point.value, decimals, yAxisFormat)} {unit}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
