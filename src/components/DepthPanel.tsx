import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import {
  DEPTHS_M,
  DEFAULT_TIME,
  showDepthLayers,
  showDatasetSlice,
  clearDepthLayers,
} from '../cesium/depth-layers';
import type { Variable } from '../cesium/binary-data';
import {
  DATASETS,
  MAIN_DATASET_IDS,
  ADVANCED_DATASET_IDS,
  type DatasetConfig,
  type TimeFrequency,
} from '../cesium/datasets';
import { toggleCurrents, clearCurrents } from '../cesium/currents';

interface DepthPanelProps {
  viewer: Cesium.Viewer | null;
  active: boolean;
  onDatasetChange?: (datasetId: string) => void;
}

const FREQ_LABEL: Record<TimeFrequency, string> = {
  daily: 'Daily',
  monthly: 'Monthly',
  static: 'Static',
};

/**
 * Ocean data controls — product-first layer browser.
 * Six primary product cards + contextual active-layer config.
 * All hooks are called unconditionally (Rules of Hooks).
 */
export function DepthPanel({ viewer, active, onDatasetChange }: DepthPanelProps) {
  // ALL hooks first — never after any early return
  const [datasetId, setDatasetId] = useState<string>('ph_trend');
  const [depth, setDepth] = useState<number>(0);
  const [variable, setVariable] = useState<string>('ph_trend');
  const [time, setTime] = useState<string>('static');
  const [playing, setPlaying] = useState(false);
  const [stacked, setStacked] = useState(false);
  const [opacity, setOpacity] = useState<number>(0.85);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [currentsOn, setCurrentsOn] = useState(false);
  const [currentsMsg, setCurrentsMsg] = useState<string | null>(null);
  const stopRef = useRef(false);

  const dataset: DatasetConfig = DATASETS[datasetId];

  // Auto-load default slice on mount
  useEffect(() => {
    if (!viewer || !active) return;
    if (datasetId === 'vam') {
      const dsVar = DATASETS.vam.variables[0];
      showDepthLayers(viewer, 0, 0, 0, 0, DEPTHS_M[0], 'TEMP', DEFAULT_TIME,
        { min: dsVar.min, max: dsVar.max });
      setDepth(DEPTHS_M[0]);
      setVariable('temp');
      setTime(DEFAULT_TIME);
    } else {
      const ds = DATASETS[datasetId];
      showDatasetSlice(viewer, datasetId, ds.variables[0].id, 0, 0);
      setVariable(ds.variables[0].id);
      setTime(ds.times[0]);
      setDepth(ds.depths[0]);
    }
    setStacked(true);
    return () => {
      stopRef.current = true;
      setPlaying(false);
      if (!viewer.isDestroyed()) clearDepthLayers(viewer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, active]);

  if (!viewer || !active) return null;

  const render = (d: number, v: string, t: string) => {
    setStacked(true);
    if (datasetId === 'vam') {
      const dsVar = dataset.variables.find(x => x.id === v);
      const range = dsVar ? { min: dsVar.min, max: dsVar.max } : undefined;
      showDepthLayers(viewer, 0, 0, 0, 0, d, v.toUpperCase() as Variable, t, range);
    } else {
      const ds = DATASETS[datasetId];
      const dIdx = ds.depths.indexOf(d);
      const tIdx = ds.times.indexOf(t);
      showDatasetSlice(viewer, datasetId, v, Math.max(0, dIdx), Math.max(0, tIdx));
    }
  };

  const pickDataset = (id: string) => {
    stopRef.current = true;
    setPlaying(false);
    setDatasetId(id);
    onDatasetChange?.(id);
    const ds = DATASETS[id];
    if (id === 'vam') {
      setDepth(DEPTHS_M[0]);
      setVariable('temp');
      setTime(DEFAULT_TIME);
      const dsVar = ds.variables[0];
      showDepthLayers(viewer, 0, 0, 0, 0, DEPTHS_M[0], 'TEMP', DEFAULT_TIME,
        { min: dsVar.min, max: dsVar.max });
    } else {
      setDepth(ds.depths[0]);
      setVariable(ds.variables[0].id);
      setTime(ds.times[0]);
      showDatasetSlice(viewer, id, ds.variables[0].id, 0, 0);
    }
    setStacked(true);
  };

  const pick = (d: number) => {
    stopRef.current = true;
    setPlaying(false);
    setDepth(d);
    render(d, variable, time);
  };

  const pickVar = (v: string) => {
    stopRef.current = true;
    setPlaying(false);
    setVariable(v);
    render(depth, v, time);
  };

  const pickTime = (t: string) => {
    stopRef.current = true;
    setPlaying(false);
    setTime(t);
    render(depth, variable, t);
  };

  const play = () => {
    stopRef.current = false;
    setPlaying(true);
    setStacked(true);
    const times = dataset.times;
    let i = times.indexOf(time);
    if (i < 0) i = 0;
    const step = () => {
      if (stopRef.current) return;
      i = (i + 1) % times.length;
      const t = times[i];
      setTime(t);
      render(depth, variable, t);
      if (i < times.length - 1) {
        window.setTimeout(step, 900);
      } else {
        setPlaying(false);
      }
    };
    step();
  };

  const stop = () => {
    stopRef.current = true;
    setPlaying(false);
  };

  const clear = () => {
    stop();
    setStacked(false);
    clearDepthLayers(viewer);
    clearCurrents(viewer);
    setCurrentsOn(false);
  };

  const flipCurrents = async () => {
    setCurrentsMsg('Loading u/v…');
    const r = await toggleCurrents(viewer);
    setCurrentsOn(r.on);
    setCurrentsMsg(r.error);
  };

  const dsDepths = dataset.depths;
  const dsTimes = dataset.times;
  const dsVars = dataset.variables;
  const showDepthSlider = dataset.hasDepth && dsDepths.length > 1;
  const showTimeSlider = dsTimes.length > 1;
  const showVarSelector = dsVars.length > 1;
  const currentVar = dsVars.find(v => v.id === variable);

  const renderCard = (id: string) => {
    const ds = DATASETS[id];
    const isActive = id === datasetId && stacked;
    return (
      <button
        key={id}
        className={`product-card${isActive ? ' active' : ''}`}
        onClick={() => pickDataset(id)}
        title={ds.label}
      >
        <span className="product-icon">{ds.icon}</span>
        <span className="product-info">
          <span className="product-name">{ds.product}</span>
          <span className="product-meta">
            {ds.coverage} · {FREQ_LABEL[ds.timeFrequency]}
          </span>
        </span>
        <span className={`product-dot${isActive ? ' on' : ''}`} />
      </button>
    );
  };

  return (
    <div className="depth-panel">
      <div className="depth-title">Ocean Layers</div>

      {/* Main product cards */}
      <div className="product-list">
        {MAIN_DATASET_IDS.map(renderCard)}
      </div>

      {/* Advanced section (collapsed) */}
      <button
        className="advanced-toggle"
        onClick={() => setShowAdvanced(s => !s)}
      >
        <span>Advanced</span>
        <span className="advanced-chevron">{showAdvanced ? '▾' : '▸'}</span>
      </button>
      {showAdvanced && (
        <div className="product-list">
          {ADVANCED_DATASET_IDS.map(renderCard)}
        </div>
      )}

      {/* Active layer configuration */}
      {stacked && (
        <div className="layer-config">
          <div className="layer-config-title">
            {dataset.icon} {dataset.product}
          </div>

          {/* Variable selector (only if multiple variables) */}
          {showVarSelector && (
            <div className="config-row">
              <span className="config-label">Variable</span>
              <div className="var-buttons">
                {dsVars.map(v => (
                  <button
                    key={v.id}
                    className={`depth-button${variable === v.id ? ' active-var' : ''}`}
                    onClick={() => pickVar(v.id)}
                    title={`${v.label} (${v.units})`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Current range display */}
          {currentVar && (
            <div className="config-row">
              <span className="config-label">Range</span>
              <span className="config-value">
                {currentVar.min}–{currentVar.max} {currentVar.units}
              </span>
            </div>
          )}

          {/* Depth slider (only if dataset has depth) */}
          {showDepthSlider && (
            <>
              <div className="config-row">
                <span className="config-label">Depth</span>
                <span className="config-value">{depth} m</span>
              </div>
              <input
                className="depth-slider"
                type="range"
                min={0}
                max={dsDepths.length - 1}
                step={1}
                value={dsDepths.indexOf(depth)}
                onChange={(e) => pick(dsDepths[Number(e.target.value)])}
                aria-label="Depth layer"
              />
              <div className="depth-ticks">
                {dsDepths.map((d) => (
                  <button
                    key={d}
                    className={`depth-tick${d === depth && stacked ? ' active' : ''}`}
                    onClick={() => pick(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Time slider (only if dataset has multiple times) */}
          {showTimeSlider && (
            <>
              <div className="config-row">
                <span className="config-label">Time</span>
                <span className="config-value">
                  {time === 'static' ? 'Static' : time.slice(0, 10)}
                </span>
              </div>
              <input
                className="depth-slider"
                type="range"
                min={0}
                max={dsTimes.length - 1}
                step={1}
                value={dsTimes.indexOf(time)}
                onChange={(e) => pickTime(dsTimes[Number(e.target.value)])}
                aria-label="Time step"
              />
            </>
          )}

          {/* Opacity slider */}
          <div className="config-row">
            <span className="config-label">Opacity</span>
            <span className="config-value">{Math.round(opacity * 100)}%</span>
          </div>
          <input
            className="depth-slider"
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(opacity * 100)}
            onChange={(e) => setOpacity(Number(e.target.value) / 100)}
            aria-label="Layer opacity"
          />

          {/* Legend gradient bar */}
          {currentVar && (
            <div className="legend-bar-container">
              <div
                className="legend-bar"
                style={{
                  background: `linear-gradient(to right, #440154, #3b528b, #21918c, #5ec962, #fde725)`,
                }}
              />
              <div className="legend-labels">
                <span>{currentVar.min}</span>
                <span>{currentVar.units}</span>
                <span>{currentVar.max}</span>
              </div>
            </div>
          )}

          {/* Playback + clear controls */}
          <div className="config-controls">
            <button className="depth-button" onClick={playing ? stop : play}>
              {playing ? '⏹ Stop' : '▶ Play'}
            </button>
            <button className="depth-button" onClick={clear}>Clear</button>
            {datasetId === 'vam' && (
              <button
                className={`depth-button${currentsOn ? ' active-var' : ''}`}
                onClick={flipCurrents}
                title="GLORYS surface u/v particles"
              >
                Currents
              </button>
            )}
          </div>
          {currentsMsg && <div className="location-meta">{currentsMsg}</div>}
        </div>
      )}
    </div>
  );
}
