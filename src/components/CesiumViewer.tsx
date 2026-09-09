import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { createOptimizedViewer } from '../cesium/config';
import { addCloudLayer } from '../cesium/clouds';

interface CesiumViewerProps {
  onReady?: (viewer: Cesium.Viewer) => void;
  onError?: (message: string) => void;
}

export function CesiumViewer({ onReady, onError }: CesiumViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);

  // Ref pattern: hold the latest callbacks in refs so the init effect
  // can run exactly once (empty deps) without missing callback updates.
  // This avoids the inline-callback-in-deps anti-pattern that was
  // causing the effect to re-run on every parent render and leak
  // WebGL contexts. See LOAD-PERF-PLAN.md Fix 1.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    createOptimizedViewer(containerRef.current)
      .then((viewer) => {
        if (destroyed) {
          // Component unmounted while viewer was being created
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;

        // Signal "ready" immediately so the loading UI clears and the
        // globe/terrain/imagery requests get uncontested network
        // priority. The cloud layer's texture fetch + geometry build
        // are deferred to the next idle period so they don't compete
        // with the critical first-paint requests. See LOAD-PERF-PLAN.md
        // (cloud layer deferral).
        onReadyRef.current?.(viewer);

        const scheduleIdle =
          window.requestIdleCallback ??
          ((cb: () => void) => window.setTimeout(cb, 300));
        scheduleIdle(() => {
          if (!destroyed && !viewer.isDestroyed()) {
            addCloudLayer(viewer);
          }
        });
      })
      .catch((err) => {
        if (destroyed) return;
        const message = err instanceof Error ? err.message : 'Failed to initialize globe';
        console.error('CesiumViewer error:', err);
        onErrorRef.current?.(message);
      });

    return () => {
      destroyed = true;
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
      }
      viewerRef.current = null;
    };
    // Empty deps: run exactly once on mount. Callbacks are read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="cesium-container"
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
      }}
    />
  );
}
