import { useState } from 'react';
import * as Cesium from 'cesium';
import { CesiumViewer } from './components/CesiumViewer';
import { DepthPanel } from './components/DepthPanel';
import { ProbePanel } from './components/ProbePanel';
import { AnalyticsPanel } from './components/AnalyticsPanel';

/** Default layout sizes for the right analytics sidebar. */
const DEFAULT_SIZES = {
  width: 496,      // px
  heightPct: 54,   // % of viewport height
  chartHeight: 277, // px
  min: { width: 280, chartHeight: 120 },
  max: { width: 720, chartHeight: 600 },
};

function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const [currentDatasetId, setCurrentDatasetId] = useState<string | null>(null);

  // Right sidebar sizing — user-controllable via the size overlay.
  const [analyticsWidth, setAnalyticsWidth] = useState(DEFAULT_SIZES.width);
  const [analyticsHeightPct, setAnalyticsHeightPct] = useState(DEFAULT_SIZES.heightPct);
  const [chartHeight, setChartHeight] = useState(DEFAULT_SIZES.chartHeight);
  const [sizePanelOpen, setSizePanelOpen] = useState(false);

  return (
    <div className="app">
      {/* Left sidebar — dataset selection + globe controls */}
      <div className="sidebar">
        <div className="sidebar-content">
          <DepthPanel
            viewer={viewer}
            active={!!viewer}
            onDatasetChange={setCurrentDatasetId}
          />
          <ProbePanel viewer={viewer} active={!!viewer} />
        </div>
      </div>

      {/* Right sidebar — analytics panel */}
      <div
        className="analytics-sidebar"
        style={{
          width: `${analyticsWidth}px`,
          height: `${analyticsHeightPct}vh`,
        }}
      >
        {/* Size controls toggle */}
        <button
          className={`analytics-size-btn${sizePanelOpen ? ' active' : ''}`}
          onClick={() => setSizePanelOpen(s => !s)}
          title="Resize panel"
        >
          ⚙
        </button>

        {/* Size overlay slider panel */}
        {sizePanelOpen && (
          <div className="size-overlay">
            <div className="size-overlay-title">Panel Size</div>

            <div className="size-row">
              <label className="size-label">Width</label>
              <input
                type="range"
                className="size-slider"
                min={DEFAULT_SIZES.min.width}
                max={DEFAULT_SIZES.max.width}
                value={analyticsWidth}
                onChange={(e) => setAnalyticsWidth(Number(e.target.value))}
              />
              <span className="size-value">{analyticsWidth}px</span>
            </div>

            <div className="size-row">
              <label className="size-label">Height</label>
              <input
                type="range"
                className="size-slider"
                min={40}
                max={100}
                value={analyticsHeightPct}
                onChange={(e) => setAnalyticsHeightPct(Number(e.target.value))}
              />
              <span className="size-value">{analyticsHeightPct}%</span>
            </div>

            <div className="size-row">
              <label className="size-label">Graph</label>
              <input
                type="range"
                className="size-slider"
                min={DEFAULT_SIZES.min.chartHeight}
                max={DEFAULT_SIZES.max.chartHeight}
                value={chartHeight}
                onChange={(e) => setChartHeight(Number(e.target.value))}
              />
              <span className="size-value">{chartHeight}px</span>
            </div>

            <button
              className="size-reset-btn"
              onClick={() => {
                setAnalyticsWidth(DEFAULT_SIZES.width);
                setAnalyticsHeightPct(DEFAULT_SIZES.heightPct);
                setChartHeight(DEFAULT_SIZES.chartHeight);
              }}
            >
              Reset
            </button>
          </div>
        )}

        <AnalyticsPanel
          viewer={viewer}
          active={!!viewer}
          currentDatasetId={currentDatasetId}
          chartHeight={chartHeight}
        />
      </div>

      <div className="globe-area">
        <CesiumViewer
          onReady={(v) => {
            setViewer(v);
            setLoading(false);
          }}
          onError={(msg) => setError(msg)}
        />

        {loading && !error && (
          <div className="loading-overlay">
            <div className="loading-spinner" />
            <div className="loading-text">Loading globe…</div>
          </div>
        )}

        {error && (
          <div className="error-overlay">
            <div className="error-text">⚠️ {error}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
