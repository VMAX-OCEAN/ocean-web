import * as Cesium from 'cesium';
import { zoomBy } from '../cesium/config';

interface ZoomControlsProps {
  viewer: Cesium.Viewer | null;
}

/**
 * Fallback on-screen zoom buttons.
 *
 * Guarantees zoom always works regardless of trackpad/OS/browser gesture
 * quirks we can't fully predict or test for. See ZOOM-AND-CLOUD-FADE-PLAN.md.
 */
export function ZoomControls({ viewer }: ZoomControlsProps) {
  if (!viewer) return null;

  return (
    <div className="zoom-controls">
      <button
        className="zoom-button"
        onClick={() => zoomBy(viewer, 0.3)}
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        className="zoom-button"
        onClick={() => zoomBy(viewer, -0.3)}
        aria-label="Zoom out"
      >
        −
      </button>
    </div>
  );
}
