# Rendering Pipeline

How a frame actually gets to the screen, end to end, and why lighting
is currently disabled.

## 1. Startup sequence (first paint to steady state)

```
mount
  │
  ├─ CesiumViewer useEffect runs once
  │     │
  │     └─ createOptimizedViewer(container)
  │           │
  │           ├─ new Cesium.Viewer(container, { terrain: undefined, ...minimal UI })
  │           │     → WGS84 ellipsoid + default imagery is visible almost immediately
  │           │
  │           ├─ scene.globe.maximumScreenSpaceError = 4   (coarse first paint)
  │           ├─ RequestScheduler HTTP/2 ceiling raised     (30 req/server)
  │           ├─ sky box / atmosphere enabled
  │           ├─ setNaturalBaseImagery(viewer)              (swap in GIBS Blue Marble)
  │           ├─ lighting disabled, clock frozen
  │           ├─ camera.setView(78°E, 15°N, 20,000km)
  │           ├─ wheel listener installed (trackpad fix)
  │           │
  │           ├─ Terrain.fromWorldTerrain() → scene.setTerrain()  (non-blocking)
  │           │     └─ terrain.readyEvent → after 1.5s, SSE 4 → 2 (crisper detail)
  │           │
  │           └─ return viewer
  │
  ├─ onReady(viewer) fires  → loading overlay clears
  │
  └─ requestIdleCallback → addCloudLayer(viewer)   (deferred, doesn't compete
                                                      with terrain/imagery requests
                                                      for bandwidth during first paint)
```

The guiding principle: **get pixels on screen before any network
round-trip completes**, then layer in terrain detail, then clouds,
each stage only starting once the previous one has stopped needing
uncontested resources.

## 2. Per-frame rendering

Cesium's `Viewer` runs a continuous render loop (we do not use
`requestRenderMode`, so it renders every frame, not just on demand —
see doc 04 §2 for why that trade-off is currently accepted).

Each frame:

1. **Camera/controller update** — Cesium's built-in
   `ScreenSpaceCameraController` handles drag-to-orbit, wheel/pinch
   zoom (with our `preventDefault()` patch so trackpad gestures reach
   it), and inertia.
2. **Globe surface** — the quadtree of terrain+imagery tiles is
   selected based on screen-space error against the current camera,
   requests are issued for any tiles not yet cached, and available
   tiles are drawn. Terrain tiles start as the flat ellipsoid and are
   progressively replaced by World Terrain height data as it streams
   in. The base color comes from the GIBS Blue Marble imagery layer.
3. **Cloud primitive** — on `clock.onTick` (fires every frame
   regardless of `clock.shouldAnimate`, since it's driven by the
   render loop, not simulation time), the cloud shell's rotation angle
   advances slightly, its alpha is recomputed from the camera's
   current altitude, and it's culled entirely (`primitive.show =
   false`) once fully faded.
4. **Atmosphere/skybox** — drawn using Cesium's built-in ground/sky
   atmosphere and starfield, unaffected by our lighting settings
   (those control *surface* shading, not the atmosphere shell itself).

## 3. Why lighting is off (and what that changes in the pipeline)

With `globe.enableLighting = false`:

- The globe's fragment shader skips its day/night Lambertian branch
  entirely — every surface texel is drawn at full, uniform brightness
  regardless of sun position. There is no terminator, no dark
  hemisphere, no night-side city-lights compositing.
- `dynamicAtmosphereLighting` / `dynamicAtmosphereLightingFromSun`
  being off means the atmosphere glow doesn't dim on a notional night
  side either — it's visually consistent with the uniformly-lit
  ground.
- The cloud shell's `MaterialAppearance` is separately set to
  `flat: true`, which skips *its own* per-fragment lighting branch
  (this is a different lighting system from the globe's — Cesium
  `Appearance`-level flat/lit shading — see doc 02). This is the
  change that actually fixed the pole artifact: with lighting off,
  the shader never evaluates a dot product against the cloud
  geometry's degenerate pole normals, so there's no broken math left
  to produce the dark blob.

Net effect on the pipeline: one fewer per-fragment branch evaluated
on both the globe and the cloud shell per frame (a small performance
win), and a visually simpler, unambiguous "always daytime" globe.

## 4. Imagery layer stack (bottom to top)

```
index 0:  NASA GIBS BlueMarble_NextGeneration   (base color, replaces Bing)
          [cloud primitive is a separate scene primitive, not an imagery layer —
           it's a translucent shell floating above the surface, not draped on it]
```

`night-lights.ts` exists as a ready-to-use second imagery layer
(`dayAlpha=0`/`nightAlpha=1`) but is not currently added to the
collection, since it has no day/night split to key off while lighting
is disabled.

## 5. Coordinate/timing notes relevant to rendering correctness

- The sun's direction (when lighting *is* enabled — currently it
  isn't) is computed in Earth-Centered-Earth-Fixed (ECEF) coordinates
  and compared against surface normals also in ECEF/model space
  inside Cesium's own globe shader — both operands are in the same
  coordinate frame, so (when lighting is on) the terminator is
  correctly sun-locked rather than following the camera. This was
  verified by reading Cesium's actual `GlobeFS.glsl` shader source
  during the day/night investigation (see the `ocean-docs`
  `day-night-terminator-deep-dive.md` for the full shader excerpt and
  citation). It's documented here because it's the reason the
  earlier "dark side follows the globe" report was **not** a
  world-space/view-space normal bug (a real, common bug in hand-rolled
  globe shaders) — Cesium's built-in lighting was already correct;
  the artifact was specifically the cloud shell's pole normals (doc 01
  §3/§4).
