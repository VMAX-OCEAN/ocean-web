import { useEffect, useState } from 'react';
import * as Cesium from 'cesium';
import { probePoint, probeProfile, type PointReading, type ProfileRow } from '../cesium/probe';
import { currentDepthState } from '../cesium/depth-layers';
import { VAM_ID } from '../cesium/erddap';
import { showFloats, clearFloats, type FloatPoint } from '../cesium/floats';

interface ProbePanelProps {
  viewer: Cesium.Viewer | null;
  west: number;
  south: number;
  east: number;
  north: number;
  active: boolean;
}

/**
 * Click readout + depth profile + Argo float markers, all live ERDDAP.
 * Legend cites dataset/units/time. Residual = model − obs gated: shown only
 * when a VAM model value AND a QC=1 float obs exist at the click.
 */
export function ProbePanel({ viewer, west, south, east, north, active }: ProbePanelProps) {
  const [reading, setReading] = useState<PointReading | null>(null);
  const [profile, setProfile] = useState<ProfileRow[] | null>(null);
  const [floatPick, setFloatPick] = useState<FloatPoint | null>(null);
  const [floatCount, setFloatCount] = useState<number | null>(null);
  const [floatsOn, setFloatsOn] = useState(false);
  const [residual, setResidual] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Float markers per bbox+month (Fani window default from time scrub).
  useEffect(() => {
    if (!viewer || !active) return;
    let cancelled = false;
    if (floatsOn) {
      setStatus('Loading live floats…');
      showFloats(
        viewer,
        { west, south, east, north },
        '2019-03-01T00:00:00Z',
        '2019-04-01T00:00:00Z',
        (p) => setFloatPick(p),
      ).then((r) => {
        if (cancelled) return;
        setFloatCount(r.count);
        setStatus(r.error ?? (r.count === 0 ? 'No floats in box/month.' : null));
      });
    } else {
      clearFloats(viewer);
      setFloatCount(null);
      setFloatPick(null);
    }
    return () => {
      cancelled = true;
      if (!viewer.isDestroyed()) clearFloats(viewer);
    };
  }, [viewer, active, floatsOn, west, south, east, north]);

  useEffect(() => {
    if (!viewer || !active) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(async (click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      // Float marker picked first (object-as-query).
      const picked = viewer.scene.pick(click.position);
      const floatProp = picked?.id?.properties?.float?.getValue?.();
      if (floatProp) {
        try {
          setFloatPick(JSON.parse(floatProp) as FloatPoint);
        } catch {
          /* keep prior pick */
        }
        return;
      }
      const state = currentDepthState();
      if (!state) {
        setStatus('Pick a location inside the VAM box first.');
        return;
      }
      const cart = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
      if (!cart) return;
      const c = Cesium.Cartographic.fromCartesian(cart);
      const lat = +Cesium.Math.toDegrees(c.latitude).toFixed(3);
      const lon = +Cesium.Math.toDegrees(c.longitude).toFixed(3);
      setStatus('Querying live VAM…');
      setProfile(null);
      setResidual(null);
      try {
        const [pt, prof] = await Promise.all([
          probePoint(lat, lon, state.zaxIndex, state.depthM, state.variable, state.time),
          probeProfile(lat, lon, state.variable, state.time),
        ]);
        setReading(pt);
        setProfile(prof);
        setStatus(null);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Query failed.');
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return () => handler.destroy();
  }, [viewer, active]);

  useEffect(() => {
    if (!active) {
      setReading(null);
      setProfile(null);
      setFloatPick(null);
      setFloatCount(null);
      setResidual(null);
      setStatus(null);
      setFloatsOn(false);
    }
  }, [active]);

  // Residual gated: VAM model value + QC=1 float obs at same click.
  useEffect(() => {
    if (
      reading?.value != null &&
      reading.variable === 'TEMP' &&
      floatPick?.tempC != null &&
      floatPick.qc === '1' &&
      Math.abs(floatPick.lat - reading.lat) < 1.0 &&
      Math.abs(floatPick.lon - reading.lon) < 1.0
    ) {
      setResidual(+(reading.value - floatPick.tempC).toFixed(3));
    } else {
      setResidual(null);
    }
  }, [reading, floatPick]);

  if (!viewer || !active) return null;

  const rows = (profile ?? []).filter((r) => r.value != null) as { depthM: number; value: number }[];
  const vals = rows.map((r) => r.value);
  const min = vals.length ? Math.min(...vals) : null;
  const max = vals.length ? Math.max(...vals) : null;
  const unit = reading?.units.includes('PSU') ? 'PSU' : '°C';

  return (
    <div className="probe-panel">
      <div className="depth-title">Click readout · live</div>
      {status && <div className="location-meta">{status}</div>}
      <div className="depth-row">
        <button className="depth-button" onClick={() => setFloatsOn((v) => !v)}>
          {floatsOn ? 'Hide floats' : 'Show floats'}
        </button>
        {floatCount != null && <span className="probe-sub">{floatCount} floats (Mar 2019)</span>}
      </div>
      {reading && (
        <div className="probe-reading">
          <span className="probe-value">
            {reading.value == null
              ? 'no data'
              : `${reading.value.toFixed(reading.variable === 'SAL' ? 3 : 2)} ${unit}`}
          </span>
          <span className="probe-sub">
            {reading.lat}N {reading.lon}E · {reading.depthM} m · {reading.time}
          </span>
          <span className="probe-sub">
            {reading.dataset} · {reading.variable} ({reading.units})
          </span>
        </div>
      )}
      {floatPick && (
        <div className="probe-reading">
          <span className="probe-sub">
            Float {floatPick.platform} · {floatPick.tempC ?? '—'}°C · {floatPick.psal ?? '—'} PSU ·{' '}
            {floatPick.pres ?? '—'} dbar · QC {floatPick.qc || '?'} · {floatPick.time.slice(0, 10)}
          </span>
        </div>
      )}
      {residual != null && (
        <div className="probe-reading">
          <span className="probe-value">Δ {residual > 0 ? '+' : ''}{residual.toFixed(2)} °C</span>
          <span className="probe-sub">residual = model − obs (gated: QC=1, ±1° box)</span>
        </div>
      )}
      {rows.length > 0 && (
        <svg className="probe-profile" viewBox="0 0 220 160" role="img" aria-label="Depth profile">
          {rows.map((r, i) => {
            const x = 10 + ((r.value - (min ?? 0)) / Math.max(0.001, (max ?? 1) - (min ?? 0))) * 180;
            const y = 8 + (i / Math.max(1, rows.length - 1)) * 144;
            return <circle key={r.depthM} cx={x} cy={y} r={2.5} fill="#7dd3fc" />;
          })}
          <text x={10} y={156} fill="#94a3b8" fontSize={9}>
            {min?.toFixed(reading?.variable === 'SAL' ? 2 : 1)}{unit} ·{' '}
            {max?.toFixed(reading?.variable === 'SAL' ? 2 : 1)}{unit} ·{' '}
            {reading?.time.slice(0, 10)}
          </text>
        </svg>
      )}
      <div className="probe-legend">
        <span>VAM {reading?.variable ?? 'TEMP'} · {VAM_ID}</span>
        <span>Fill -9999 / NaN = no data · green float = QC1</span>
      </div>
    </div>
  );
}
