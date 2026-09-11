/*
 * bench-harness.js — SIH-OCEAN render-latency + marker benchmark harness.
 *
 * Protocol: docs/performance/benchmark-protocol.md (D2 research, 2026-09-10)
 * Free-only. No paid tooling. No numbers are invented — every field is
 * measured in-browser.
 *
 * USAGE (manual, no extra deps):
 *   1. Patch app to expose viewer (see protocol "Instrumentation patch"):
 *        in CesiumViewer.tsx onReady handler: window.__VIEWER__ = viewer
 *   2. npm run build && npx vite preview --port 4173
 *   3. Open http://localhost:4173 in a clean profile.
 *   4. DevTools > Console > paste this whole file. It auto-attaches once
 *      window.__VIEWER__ appears.
 *   5. Drive with __BENCH.* — see protocol step tables.
 *
 * Lazy alternative: run bench-run.mjs (Playwright, free) to automate
 * clear-cache + CDP throttle + repeated reloads. Manual path above is
 * enough for a single pass and needs zero new deps.
 */
(() => {
  'use strict';

  const NS = 'bench';
  const state = {
    viewer: null,
    attachedAt: null,
    marks: {},           // name -> performance.now() timestamp
    frameSamples: [],    // rAF intervals (ms)
    rafId: null,
    rafStopAt: 0,
    markers: null,
    markerKind: null,
    gl: null,
  };

  const now = () => performance.now();

  // ── frame timing (rAF wall-clock intervals) ───────────────────────
  function frameTick(ts) {
    const last = state._lastTs;
    if (last != null) state.frameSamples.push(ts - last);
    state._lastTs = ts;
    if (now() < state.rafStopAt) {
      state.rafId = requestAnimationFrame(frameTick);
    } else {
      state.rafId = null;
      state._lastTs = null;
    }
  }

  function startFrames(ms) {
    if (state.rafId != null) cancelAnimationFrame(state.rafId);
    state.frameSamples = [];
    state._lastTs = null;
    state.rafStopAt = now() + ms;
    state.rafId = requestAnimationFrame(frameTick);
  }

  function stats(arr) {
    if (!arr.length) return { n: 0 };
    const s = [...arr].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    return {
      n: s.length,
      meanMs: +mean.toFixed(2),
      fps: +(1000 / mean).toFixed(1),
      p50Ms: +q(0.5).toFixed(2),
      p95Ms: +q(0.95).toFixed(2),
      p99Ms: +q(0.99).toFixed(2),
      maxMs: +s[s.length - 1].toFixed(2),
      pctOver33ms: +((s.filter((x) => x > 33.3).length / s.length) * 100).toFixed(1),
    };
  }

  // ── resource / byte accounting (free: PerformanceResourceTiming) ──
  // NOTE: transferSize is 0 when Timing-Allow-Origin is absent (opaque /
  // cross-origin without TAO). ion + GIBS send it; a bare R2 domain may
  // not — then decodedBodySize is also 0 and only the request count is
  // usable. Flag that case as "bytes UNMEASURABLE (TAO missing)".
  function resources(hostFilter) {
    return performance
      .getEntriesByType('resource')
      .filter((e) => (hostFilter ? e.name.includes(hostFilter) : true))
      .map((e) => ({
        name: e.name,
        initiatorType: e.initiatorType,
        transferSize: e.transferSize,
        encodedBodySize: e.encodedBodySize,
        decodedBodySize: e.decodedBodySize,
        durationMs: +e.duration.toFixed(1),
        startMs: +e.startTime.toFixed(1),
      }));
  }

  function byteTotals(hostFilter) {
    const rows = resources(hostFilter);
    const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    return {
      host: hostFilter || '*',
      requests: rows.length,
      transferBytes: sum('transferSize'),
      encodedBytes: sum('encodedBodySize'),
      decodedBytes: sum('decodedBodySize'),
      taoMissing: rows.length > 0 && sum('transferSize') === 0,
    };
  }

  // ── marker sweep (entities/billboards vs point primitives) ────────
  const DOT =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  function randPositions(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const lon = -180 + Math.random() * 360;
      const lat = -70 + Math.random() * 140;
      out.push([lon, lat]);
    }
    return out;
  }

  function addMarkers(kind, positions) {
    const v = state.viewer;
    if (kind === 'entity') {
      for (const [lon, lat] of positions) {
        v.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
          billboard: { image: DOT, width: 8, height: 8, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        });
      }
    } else {
      const coll = new Cesium.PointPrimitiveCollection();
      v.scene.primitives.add(coll);
      for (const [lon, lat] of positions) {
        coll.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
          pixelSize: 6,
          color: Cesium.Color.CYAN,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
      return coll;
    }
    return null;
  }

  function clearMarkers() {
    const v = state.viewer;
    v.entities.removeAll();
    if (state.markers) {
      v.scene.primitives.remove(state.markers);
      state.markers = null;
    }
    try { v.scene.requestRender(); } catch (_) {}
  }

  // ── scrape viewer alive state ─────────────────────────────────────
  function tileProgress() {
    const g = state.viewer && state.viewer.scene && state.viewer.scene.globe;
    return g ? g.tilesLoaded : null;
  }

  function waitTilesIdle(timeoutMs = 60000) {
    const v = state.viewer;
    return new Promise((resolve) => {
      const t0 = now();
      const g = v.scene.globe;
      let sawLoading = false;
      const remove = g.tileLoadProgressEvent.addEventListener((n) => {
        if (n > 0) sawLoading = true;
        if (sawLoading && n === 0) {
          remove();
          resolve({ ms: +(now() - t0).toFixed(1), sawLoading });
        }
        if (now() - t0 > timeoutMs) {
          remove();
          resolve({ ms: +(now() - t0).toFixed(1), sawLoading, timeout: true });
        }
      });
    });
  }

  // ── public API ────────────────────────────────────────────────────
  const BENCH = {
    version: '1.0.0',

    attach(viewer) {
      state.viewer = viewer;
      state.attachedAt = now();
      state.gl = viewer.scene.context && viewer.scene.context._gl;
      this.mark('attach');
      // First postRender after attach == globe ready (canvas painting).
      const once = viewer.scene.postRender.addEventListener(() => {
        if (!state.marks.globeReady) this.mark('globeReady');
      });
      return { attachedAt: state.attachedAt, tilesLoaded: tileProgress() };
    },

    mark(name) {
      state.marks[name] = now();
      performance.mark(`bench:${name}`);
      return state.marks[name];
    },

    // Call on scrubber/slider pointerup / change-release.
    markScrubRelease() { return this.mark('scrubRelease'); },

    // Call inside the data layer's provider requestImage .then(), once the
    // tile image has decoded and is handed to Cesium for display.
    markSliceTileRendered() { return this.mark('sliceTileRendered'); },

    sliceLatencyMs() {
      const a = state.marks.scrubRelease, b = state.marks.sliceTileRendered;
      return a != null && b != null ? +(b - a).toFixed(1) : null;
    },

    coldLoad() {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const t0 = nav.startTime || 0;
      const g = state.marks.globeReady;
      const tiles = this.marks.tilesSettled;
      return {
        navigationStartMs: 0,
        domContentLoadedMs: nav.domContentLoadedEventEnd != null ? +nav.domContentLoadedEventEnd.toFixed(1) : null,
        loadEventMs: nav.loadEventEnd != null ? +nav.loadEventEnd.toFixed(1) : null,
        globeReadyMs: g != null ? +(g - t0).toFixed(1) : null,
        tilesSettledMs: tiles != null ? +(tiles - t0).toFixed(1) : null,
        paint: performance.getEntriesByType('paint').map((p) => ({ name: p.name, ms: +p.startTime.toFixed(1) })),
      };
    },

    startFrames,
    stopFrames() {
      if (state.rafId != null) cancelAnimationFrame(state.rafId);
      state.rafId = null;
      return stats(state.frameSamples);
    },

    async waitTilesIdle(timeoutMs) {
      const r = await waitTilesIdle(timeoutMs);
      this.mark('tilesSettled');
      return r;
    },

    // Single marker sweep step: add count, settle, sample, teardown.
    async markerStep(kind, count, sampleMs = 10000, settleMs = 2000) {
      clearMarkers();
      state.markers = addMarkers(kind, randPositions(count));
      await new Promise((r) => setTimeout(r, settleMs));
      startFrames(sampleMs);
      await new Promise((r) => setTimeout(r, sampleMs + 200));
      const s = this.stopFrames();
      const v = state.viewer;
      const prim = v.scene.primitives.length;
      const ent = v.entities.values.length;
      clearMarkers();
      return { kind, count, primitives: prim, entities: ent, ...s };
    },

    async markerSweep(kinds = ['point', 'entity'], counts = [500, 1000, 2000, 3000, 4000, 5000], sampleMs = 10000) {
      const out = [];
      for (const k of kinds) for (const c of counts) out.push(await this.markerStep(k, c, sampleMs));
      return out;
    },

    terrainBytes() {
      // ion terrain streaming endpoint. Bathymetry + World Terrain share host.
      return byteTotals('assets.ion.cesium.com');
    },
    gibsBytes() { return byteTotals('gibs.earthdata.nasa.gov'); },
    r2Bytes() { return byteTotals('r2.dev'); },       // adjust to custom domain
    allBytes() { return byteTotals(null); },

    renderStats() {
      const s = state.viewer.scene;
      return {
        tilesLoaded: tileProgress(),
        maximumScreenSpaceError: s.globe.maximumScreenSpaceError,
        imageryLayers: state.viewer.imageryLayers.length,
        primitives: s.primitives.length,
        entities: state.viewer.entities.values.length,
        contextLost: s.context ? !!s.context._contextLost : null,
      };
    },

    report() {
      return {
        version: this.version,
        ua: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemoryGB: navigator.deviceMemory || null,
        devicePixelRatio,
        coldLoad: this.coldLoad(),
        sliceLatencyMs: this.sliceLatencyMs(),
        marks: { ...state.marks },
        renderStats: this.renderStats(),
        terrain: this.terrainBytes(),
        gibs: this.gibsBytes(),
        r2: this.r2Bytes(),
      };
    },

    // Runnable self-check for the non-trivial stats path.
    selftest() {
      const r = stats([16, 16, 16, 16, 50, 100]);
      const ok =
        r.n === 6 &&
        r.p50Ms === 16 &&
        r.maxMs === 100 &&
        Math.abs(r.pctOver33ms - 33.3) < 0.1 &&
        stats([]).n === 0;
      if (!ok) throw new Error('bench stats selftest FAILED: ' + JSON.stringify(r));
      return 'bench stats selftest PASS';
    },
  };

  // Auto-attach when the app exposes the viewer.
  const timer = setInterval(() => {
    if (window.__VIEWER__ && !state.viewer) {
      BENCH.attach(window.__VIEWER__);
      clearInterval(timer);
      console.info('[bench] attached', BENCH.report());
    }
  }, 250);

  window.__BENCH = BENCH;
  console.info('[bench] harness loaded. Awaiting window.__VIEWER__. Run __BENCH.selftest().');
})();
