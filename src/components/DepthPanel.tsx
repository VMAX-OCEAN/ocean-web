import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import {
  DEPTHS_M,
  TIMES,
  DEFAULT_TIME,
  showDepthLayers,
  clearDepthLayers,
  focusDepth,
} from '../cesium/depth-layers';
import type { Variable } from '../cesium/erddap';
import { toggleCurrents, clearCurrents } from '../cesium/currents';

interface DepthPanelProps {
  viewer: Cesium.Viewer | null;
  west: number;
  south: number;
  east: number;
  north: number;
  active: boolean;
}

/**
 * 4D controls: depth slider + TEMP/SAL toggle + 10-day time scrub + play.
 * One live slice at a time; ZarrCubeProvider slices dock into showDepthLayers.
 */
export function DepthPanel({ viewer, west, south, east, north, active }: DepthPanelProps) {
  const [depth, setDepth] = useState<number>(DEPTHS_M[0]);
  const [variable, setVariable] = useState<Variable>('TEMP');
  const [time, setTime] = useState<string>(DEFAULT_TIME);
  const [playing, setPlaying] = useState(false);
  const [stacked, setStacked] = useState(false);
  const stopRef = useRef(false);

  // Show the live slice as soon as 4D activates; tear down when leaving.
  useEffect(() => {
    if (!viewer || !active) return;
    showDepthLayers(viewer, west, south, east, north, DEPTHS_M[0], 'TEMP', DEFAULT_TIME);
    setDepth(DEPTHS_M[0]);
    setVariable('TEMP');
    setTime(DEFAULT_TIME);
    setStacked(true);
    return () => {
      stopRef.current = true;
      setPlaying(false);
      if (!viewer.isDestroyed()) clearDepthLayers(viewer);
    };
    // Re-stack per location only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, active, west, south, east, north]);

  if (!viewer || !active) return null;

  const render = (d: number, v: Variable, t: string) => {
    setStacked(true);
    showDepthLayers(viewer, west, south, east, north, d, v, t);
  };

  const pick = (d: number) => {
    stopRef.current = true;
    setPlaying(false);
    setDepth(d);
    render(d, variable, time);
  };

  const pickVar = (v: Variable) => {
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
    let i = DEPTHS_M.indexOf(depth);
    const step = () => {
      if (stopRef.current) return;
      i = (i + 1) % DEPTHS_M.length;
      const d = DEPTHS_M[i];
      setDepth(d);
      render(d, variable, time);
      if (i < DEPTHS_M.length - 1) {
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

  const [currentsOn, setCurrentsOn] = useState(false);
  const [currentsMsg, setCurrentsMsg] = useState<string | null>(null);

  const flipCurrents = async () => {
    setCurrentsMsg('Loading u/v…');
    const r = await toggleCurrents(viewer);
    setCurrentsOn(r.on);
    setCurrentsMsg(r.error);
  };

  return (
    <div className="depth-panel">
      <div className="depth-title">4D · depth layers</div>
      <input
        className="depth-slider"
        type="range"
        min={0}
        max={DEPTHS_M.length - 1}
        step={1}
        value={DEPTHS_M.indexOf(depth)}
        onChange={(e) => pick(DEPTHS_M[Number(e.target.value)])}
        aria-label="Depth layer"
      />
      <div className="depth-row">
        <span className="depth-value">{depth} m</span>
        <button
          className={`depth-button${variable === 'TEMP' ? ' active-var' : ''}`}
          onClick={() => pickVar('TEMP')}
          title="Temperature (°C)"
        >
          TEMP
        </button>
        <button
          className={`depth-button${variable === 'SAL' ? ' active-var' : ''}`}
          onClick={() => pickVar('SAL')}
          title="Salinity (PSU)"
        >
          SAL
        </button>
        <button
          className="depth-button"
          onClick={() => focusDepth(viewer, depth)}
          title="Focus camera on this layer"
        >
          Focus
        </button>
        <button
          className="depth-button"
          onClick={playing ? stop : play}
        >
          {playing ? 'Stop' : 'Play ↓'}
        </button>
        <button className="depth-button" onClick={clear}>
          Clear
        </button>
        <button
          className={`depth-button${currentsOn ? ' active-var' : ''}`}
          onClick={flipCurrents}
          title="GLORYS surface u/v particles 2019-05-02 (live Zarr)"
        >
          Currents
        </button>
      </div>
      {currentsMsg && <div className="location-meta">{currentsMsg}</div>}
      <div className="depth-row">
        <span className="depth-value time-value">{time.slice(0, 10)}</span>
        <input
          className="depth-slider"
          type="range"
          min={0}
          max={TIMES.length - 1}
          step={1}
          value={TIMES.indexOf(time)}
          onChange={(e) => pickTime(TIMES[Number(e.target.value)])}
          aria-label="Time step (10-day)"
        />
      </div>
      <div className="depth-ticks">
        {DEPTHS_M.map((d) => (
          <button
            key={d}
            className={`depth-tick${d === depth && stacked ? ' active' : ''}`}
            onClick={() => pick(d)}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}
