import * as Cesium from 'cesium';
import { glorysSurfaceUV, GLORYS_BBOX } from './glorys';

/**
 * GLORYS surface current particles — canvas 2D advection over live u/v.
 * GPU wind-layer deferred (needs cesium-wind-layer dep); this proves the
 * vector field is real (decoded Zarr uo/vo, mean 0.11 m/s) with zero deps.
 */

const TAG = 'glorys-currents';
const N = 1500;

interface Particle {
  x: number;
  y: number;
  age: number;
}

let entities: Cesium.Entity[] = [];
let timer: number | null = null;
let canvas: HTMLCanvasElement | null = null;
let field: { u: Float32Array; v: Float32Array; width: number; height: number } | null = null;

function stopShow(viewer: Cesium.Viewer): void {
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
  for (const e of entities) viewer.entities.remove(e);
  entities = [];
  canvas = null;
}

/** Toggle live current particles inside the Fani box. Returns on/off + error. */
export async function toggleCurrents(viewer: Cesium.Viewer): Promise<{
  on: boolean;
  error: string | null;
}> {
  if (timer != null || entities.length) {
    stopShow(viewer);
    return { on: false, error: null };
  }
  try {
    field = await glorysSurfaceUV(0);
  } catch (e) {
    return { on: false, error: e instanceof Error ? e.message : 'u/v decode failed.' };
  }
  canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const rand = (n: number) => Math.random() * n;
  const parts: Particle[] = Array.from({ length: N }, () => ({
    x: rand(canvas!.width),
    y: rand(canvas!.height),
    age: rand(80),
  }));

  const rect = Cesium.Rectangle.fromDegrees(
    GLORYS_BBOX.west,
    GLORYS_BBOX.south,
    GLORYS_BBOX.east,
    GLORYS_BBOX.north,
  );

  const step = () => {
    // Guard against viewer being destroyed while the interval is
    // still active — without this, requestRender() throws on a
    // destroyed scene. The interval is cleared in stopShow(), but
    // if the viewer is destroyed externally (e.g. React unmount
    // without calling clearCurrents first), the interval keeps
    // firing. This check makes the leak harmless.
    if (viewer.isDestroyed()) {
      stopShow(viewer);
      return;
    }
    if (!canvas || !field) return;
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(140,220,255,0.85)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    const { u, v, width, height } = field;
    for (const p of parts) {
      const gx = Math.min(width - 1, Math.max(0, Math.round((p.x / canvas.width) * (width - 1))));
      const gy = Math.min(height - 1, Math.max(0, Math.round((p.y / canvas.height) * (height - 1))));
      const uu = u[gy * width + gx];
      const vv = v[gy * width + gx];
      const sp = Math.hypot(uu, vv);
      // scale: 0.11 m/s mean → visible drift; cap runaway
      const k = Math.min(6, sp * 22);
      const ang = Math.atan2(-vv, uu);
      const nx = p.x + Math.cos(ang) * k;
      const ny = p.y + Math.sin(ang) * k;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      p.x = nx;
      p.y = ny;
      if (++p.age > 90 || p.x < 0 || p.y < 0 || p.x > canvas.width || p.y > canvas.height) {
        p.x = rand(canvas.width);
        p.y = rand(canvas.height);
        p.age = 0;
      }
    }
    ctx.stroke();
    // requestRenderMode is on — Cesium won't re-render unless asked.
    // The canvas texture changed, so trigger a render to show it.
    viewer.scene.requestRender();
  };

  step();
  timer = window.setInterval(step, 50);

  const ent = viewer.entities.add({
    id: `${TAG}:particles`,
    name: 'GLORYS surface currents 2019-05-02 (live u/v)',
    rectangle: {
      coordinates: rect,
      material: new Cesium.ImageMaterialProperty({
        image: canvas,
        transparent: true,
      }),
      height: 4000,
    },
  });
  entities = [ent];
  return { on: true, error: null };
}

export function clearCurrents(viewer: Cesium.Viewer): void {
  stopShow(viewer);
}
