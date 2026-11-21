/**
 * HistogramChart — simple SVG bar chart for spatial value distributions.
 *
 * Used for static datasets (no time dimension), e.g. pH Trend, where the
 * meaningful visualization is "how many ocean grid cells have this value"
 * rather than a time series.
 */

import { useRef, useState, useEffect, useMemo } from 'react';
import type { HistogramBin } from '../analytics/types';

interface HistogramChartProps {
  bins: HistogramBin[];
  unit: string;
  decimals: number;
  /** Color for bars whose range is below zero (e.g. acidifying). */
  negativeColor?: string;
  /** Color for bars whose range is at/above zero. */
  positiveColor?: string;
}

const MARGIN = { top: 12, right: 16, bottom: 28, left: 40 };

export function HistogramChart({
  bins,
  unit,
  decimals,
  negativeColor = '#f97316',
  positiveColor = '#38bdf8',
}: HistogramChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 200 });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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

  const plotW = Math.max(10, size.width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(10, size.height - MARGIN.top - MARGIN.bottom);

  const maxCount = useMemo(
    () => Math.max(1, ...bins.map(b => b.count)),
    [bins],
  );

  const barWidth = bins.length > 0 ? plotW / bins.length : 0;

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= 4; i++) ticks.push((i / 4) * maxCount);
    return ticks;
  }, [maxCount]);

  const hoverBin = hoverIdx !== null ? bins[hoverIdx] : null;

  return (
    <div className="chart-container" ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg width={size.width} height={size.height} style={{ display: 'block', overflow: 'visible' }}>
        {/* Grid lines */}
        {yTicks.map((tick, i) => {
          const y = MARGIN.top + plotH - (tick / maxCount) * plotH;
          return (
            <g key={`ygrid-${i}`}>
              <line
                x1={MARGIN.left} y1={y} x2={MARGIN.left + plotW} y2={y}
                stroke="rgba(255,255,255,0.06)" strokeWidth={1}
              />
              <text x={MARGIN.left - 6} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.4)" fontSize={9}>
                {Math.round(tick)}
              </text>
            </g>
          );
        })}

        {/* Zero reference line, if within range */}
        {bins.length > 0 && bins[0].rangeStart < 0 && bins[bins.length - 1].rangeEnd > 0 && (() => {
          const zeroIdx = bins.findIndex(b => b.rangeStart <= 0 && b.rangeEnd >= 0);
          if (zeroIdx < 0) return null;
          const x = MARGIN.left + zeroIdx * barWidth + barWidth / 2;
          return (
            <line
              x1={x} y1={MARGIN.top} x2={x} y2={MARGIN.top + plotH}
              stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="3 3"
            />
          );
        })()}

        {/* Bars */}
        {bins.map((bin, i) => {
          const h = (bin.count / maxCount) * plotH;
          const x = MARGIN.left + i * barWidth;
          const y = MARGIN.top + plotH - h;
          const isNegative = bin.rangeStart < 0;
          const isHovered = hoverIdx === i;
          return (
            <rect
              key={`bar-${i}`}
              x={x + 1}
              y={y}
              width={Math.max(1, barWidth - 2)}
              height={h}
              fill={isNegative ? negativeColor : positiveColor}
              opacity={isHovered ? 1.0 : 0.75}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            />
          );
        })}
      </svg>

      {hoverBin && (
        <div
          className="chart-tooltip"
          style={{
            position: 'absolute',
            left: MARGIN.left + (bins.indexOf(hoverBin) + 0.5) * barWidth,
            top: MARGIN.top,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
          }}
        >
          <div className="tooltip-row">
            <span className="tooltip-value">
              {hoverBin.rangeStart.toFixed(decimals)} to {hoverBin.rangeEnd.toFixed(decimals)} {unit}
            </span>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-label">{hoverBin.count.toLocaleString()} cells</span>
          </div>
        </div>
      )}
    </div>
  );
}
