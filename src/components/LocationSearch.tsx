import { useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { PRESETS, flyToPreset, showLocationVolume } from '../cesium/presets';
import { searchBbox, flyToBbox, showSearchVolume, clearLocationVolume } from '../cesium/search';
import { clearDepthLayers } from '../cesium/depth-layers';
import { DepthPanel } from './DepthPanel';
import { ProbePanel } from './ProbePanel';

interface LocationSearchProps {
  viewer: Cesium.Viewer | null;
}

type Mode = 'globe' | 'location';

interface ActiveBox {
  id: string;
  label: string;
  mandate: string;
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Any-area search + presets + Globe/Location toggle.
 * Free text (Nominatim bbox) and Draw box share the preset render path.
 * Empty bbox = blocked message, never a blank fetch.
 */
export function LocationSearch({ viewer }: LocationSearchProps) {
  const [mode, setMode] = useState<Mode>('globe');
  const [active, setActive] = useState<ActiveBox | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const drawHandler = useRef<Cesium.ScreenSpaceEventHandler | null>(null);

  if (!viewer) return null;

  const enterLocation = (box: ActiveBox) => {
    setActive(box);
    setMode('location');
    setError(null);
  };

  const selectPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    stopDraw();
    flyToPreset(viewer, p);
    showLocationVolume(viewer, p);
    enterLocation({ ...p });
  };

  const runSearch = async () => {
    stopDraw();
    setBusy(true);
    setError(null);
    try {
      const b = await searchBbox(query);
      flyToBbox(viewer, b);
      showSearchVolume(viewer, b);
      enterLocation({ west: b.west, south: b.south, east: b.east, north: b.north, id: `search-${Date.now()}`, label: b.label, mandate: 'Custom search' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  };

  const stopDraw = () => {
    drawHandler.current?.destroy();
    drawHandler.current = null;
    setDrawing(false);
  };

  /** Drag on globe → bbox → live volume. Abort-safe: replaces prior box. */
  const startDraw = () => {
    stopDraw();
    setError(null);
    setDrawing(true);
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    drawHandler.current = handler;
    let start: Cesium.Cartographic | null = null;
    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pickPosition(click.position);
      if (!picked) return;
      start = Cesium.Cartographic.fromCartesian(picked);
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction((move: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (!start) return;
      const picked = viewer.scene.pickPosition(move.endPosition);
      if (!picked) return;
      const end = Cesium.Cartographic.fromCartesian(picked);
      const b = {
        west: Cesium.Math.toDegrees(Math.min(start.longitude, end.longitude)),
        east: Cesium.Math.toDegrees(Math.max(start.longitude, end.longitude)),
        south: Cesium.Math.toDegrees(Math.max(-1.45, Math.min(start.latitude, end.latitude))),
        north: Cesium.Math.toDegrees(Math.min(1.45, Math.max(start.latitude, end.latitude))),
      };
      if (b.east - b.west < 0.5 || b.north - b.south < 0.5) return;
      showSearchVolume(viewer, { ...b, label: 'Drawn box' });
      enterLocation({ west: b.west, south: b.south, east: b.east, north: b.north, id: `draw-${Date.now()}`, label: 'Drawn box', mandate: 'Custom box' });
      start = null;
      stopDraw();
    }, Cesium.ScreenSpaceEventType.LEFT_UP);
  };

  const backToGlobe = () => {
    stopDraw();
    setMode('globe');
    setActive(null);
    setError(null);
    clearLocationVolume(viewer);
    clearDepthLayers(viewer);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(78.0, 15.0, 20000000),
      duration: 2.0,
    });
  };

  return (
    <div className="location-search">
      <div className="location-row">
        <input
          className="location-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          placeholder="Search any ocean area…"
          aria-label="Search any ocean area"
        />
        <button className="mode-button" onClick={runSearch} disabled={busy || !query.trim()}>
          {busy ? '…' : 'Go'}
        </button>
        <button
          className={`mode-button${drawing ? ' active' : ''}`}
          onClick={drawing ? stopDraw : startDraw}
          title="Drag a box on the globe"
        >
          Draw
        </button>
        <div className="mode-toggle" role="group" aria-label="View mode">
          <button
            className={`mode-button${mode === 'globe' ? ' active' : ''}`}
            onClick={backToGlobe}
          >
            3D
          </button>
          <button
            className={`mode-button${mode === 'location' ? ' active' : ''}`}
            onClick={() => active && setMode('location')}
            disabled={!active}
            title={active ? 'Location volume' : 'Search or pick below first'}
          >
            4D
          </button>
        </div>
      </div>
      <div className="location-row">
        <select
          className="location-select"
          value=""
          onChange={(e) => e.target.value && selectPreset(e.target.value)}
          aria-label="Fallback presets (offline)"
        >
          <option value="">Presets (offline fallback)…</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {drawing && <div className="location-meta">Drag a box on the globe…</div>}
      {error && <div className="location-error">{error}</div>}
      {active && mode === 'location' && (
        <>
          <div className="location-meta">
            {active.mandate} · {active.west.toFixed(1)}–{active.east.toFixed(1)}E /{' '}
            {active.south.toFixed(1)}–{active.north.toFixed(1)}N
          </div>
          <DepthPanel
            viewer={viewer}
            west={active.west}
            south={active.south}
            east={active.east}
            north={active.north}
            active
          />
          <ProbePanel
            viewer={viewer}
            west={active.west}
            south={active.south}
            east={active.east}
            north={active.north}
            active
          />
        </>
      )}
    </div>
  );
}
