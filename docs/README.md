# ocean-web — Documentation Index

This folder documents the engineering decisions behind the Cesium-based
ocean globe visualization: what approaches were considered, what we
ultimately built and why, how it renders, and how it's optimized.

Read in this order:

1. **[01-approaches-considered.md](./01-approaches-considered.md)** —
   every alternative approach evaluated for the globe engine, land
   imagery, clouds, and day/night lighting, and the reasoning for
   picking (or rejecting) each one.
2. **[02-current-architecture.md](./02-current-architecture.md)** —
   what is actually running today: file-by-file breakdown of the
   `src/` tree and how the pieces fit together.
3. **[03-rendering-pipeline.md](./03-rendering-pipeline.md)** — how a
   frame gets to the screen: viewer bootstrap, terrain/imagery
   streaming, cloud layer, and why lighting is currently off.
4. **[04-optimization-and-performance.md](./04-optimization-and-performance.md)** —
   every performance problem found (WebGL context leak, slow first
   paint, artifact-causing lighting, oversized textures) and the fix
   for each, with before/after numbers where available.
5. **[05-d2-teammate-bench.md](./05-d2-teammate-bench.md)** —
   benchmarking harness and results.
6. **[06-analytics-panel.md](./06-analytics-panel.md)** — the right-side
   analytics/visualization panel: variable-specific charts, globe↔graph
   synchronization, color-scale unification, size controls, and the
   full analytics module architecture (types, configs, data-adapter,
   chart engine, panel component).
7. **[07-globe-colormaps.md](./07-globe-colormaps.md)** — variable-specific
   colormaps for the Cesium globe, replacing the generic blue→green→red
   gradient with per-variable scientific color scales. Includes bug
   fixes for stack overflow, wheel handler crash, and colormap safety
   guards.

## Companion root-level plan documents

The `docs/` files above are the consolidated, durable reference. The
repository root also has narrower, point-in-time planning documents
written while each specific fix was being investigated — kept for
detailed history/citations:

- `GOOGLE-EARTH-ANALYSIS.md` — original Google Earth Web architecture
  research (Wasm, quadtree imagery, octree meshes, clip mapping).
- `LOAD-PERF-PLAN.md` — the WebGL-context-leak fix and staged LOD.
- `FETCH-PERFORMANCE-PLAN.md` — HTTP/2 request ceiling tuning.
- `CLOUD-SHADER-FIX-PLAN.md` — Cesium Fabric shader compile fix
  (`texture2D` → `texture`, explicit uniform declarations).
- `ZOOM-AND-CLOUD-FADE-PLAN.md` — touchpad zoom fix, altitude cloud
  fade v1.
- `NIGHT-LIGHTS-IMPL-PLAN.md` — NASA Black Marble night-lights layer
  (implemented, later removed — see doc 01 for why).
- `LAND-COLOR-AND-DAYNIGHT-PLAN.md` — Blue Marble base imagery switch,
  clock-animation day/night experiment (later removed — see doc 01).
- `CLOUD-WEDGE-FIX-PLAN.md` — root cause and fix for the pole
  lighting-artifact ("dark blob with radiating streaks").
