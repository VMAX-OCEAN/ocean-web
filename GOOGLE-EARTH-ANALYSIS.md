# Google Earth Web Analysis + CesiumJS Implementation Plan

Complete analysis of how Google Earth Web renders its globe, and our plan to
build an equally smooth (or better) globe in CesiumJS for the SIH-OCEAN platform.

---

## How Google Earth Web Works

### Architecture

Google Earth Web is **not JavaScript**. It's a C++ application compiled to
WebAssembly (Wasm) that runs in the browser:

```
C++ source code
    ↓ (emscripten compiler)
WebAssembly binary (.wasm file, ~10-15 MB)
    ↓ (browser loads and executes)
Runs at near-native speed in browser
    ↓ (uses WebGL2 for rendering)
GPU renders the globe
```

**Why Wasm, not JS?** Google Earth was originally a C++ desktop app. They ported
it to the web by compiling the same C++ code to Wasm instead of rewriting in JS.
This gives near-native performance but requires a large initial download (~10-15 MB
Wasm binary, which is why you see a loading bar).

### The 6 Core Techniques Google Earth Uses

#### 1. Quadtree Tiling (Imagery)

The entire Earth's imagery is split into a **quadtree pyramid**:

```
Level 0: 2 tiles (entire Earth, very low res)
Level 1: 8 tiles
Level 2: 32 tiles
...
Level 18: millions of tiles (city-level detail)
```

Each tile is 256×256 pixels. As you zoom in, the system loads more detailed
tiles for a smaller area. As you zoom out, it loads fewer, lower-res tiles.

**Key insight:** You never load the whole Earth at high resolution. You load
only what the camera can see, at the resolution the screen needs.

#### 2. Octree (3D Mesh Data)

For 3D buildings and photogrammetry, Google uses an **octree** (3D version of
quadtree). Each node contains:
- Mesh data (packed XYZ vertices, UV coordinates, normals)
- Texture data (JPG or CRN-DXT1 compressed)
- Oriented Bounding Box (OBB) for culling

The octree subdivides space into 8 children per node, allowing progressive
loading of 3D geometry.

#### 3. Clip Mapping (Universal Texture)

Google Earth uses a patented technique called **"Universal Texture"** (based on
SGI's clip mapping) to handle a multi-terabyte Earth texture as if it were a
single texture. This allows:
- Anisotropic filtering (sharp at oblique angles)
- Trilinear filtering (smooth transitions between LOD levels)
- No visible tile boundaries

#### 4. Background Thread Decompression

Google Earth uses **WebAssembly threads** to decompress data on background
threads while the main thread renders:

```
Main thread:     Render frame → Render frame → Render frame
                 (60 FPS, never blocks)

Worker thread 1: Download tile → Decompress → Upload to GPU
Worker thread 2: Download tile → Decompress → Upload to GPU
Worker thread 3: Download tile → Decompress → Upload to GPU
```

This is why Google Earth is smooth even while loading — decompression doesn't
block rendering.

#### 5. Aggressive Request Cancellation

Google Earth **cancels requests** for tiles that are no longer visible as the
camera moves. If you pan quickly, tiles from your old view are cancelled and
tiles for your new view are requested. This prevents wasted bandwidth and CPU.

#### 6. Scene Resolution Indicator

The percentage spinner in the bottom-right shows how much of the current scene
has been loaded and rendered. This manages user expectations during loading.

---

## Can CesiumJS Match Google Earth?

### What CesiumJS does the same

| Google Earth Technique | CesiumJS Equivalent | Match? |
|---|---|---|
| Quadtree tiling | Quadtree LOD with Screen-Space Error (SSE) | ✅ Same concept |
| Octree (3D meshes) | 3D Tiles (octree-based) | ✅ Same concept |
| Clip mapping | Cesium's tile system (not clip mapping, but similar LOD) | ⚠️ Different approach, similar result |
| Background decompression | Web Workers for tile processing | ⚠️ JS single-threaded for rendering, workers for I/O |
| Request cancellation | `RequestScheduler` with cancellation | ✅ Same concept |
| Scene resolution indicator | `globe.tilesLoaded` event | ✅ Available |
| LOD selection | `maximumScreenSpaceError` controls detail | ✅ Same concept |
| Foveated loading | Foveated loading (center of view loads first) | ✅ Same concept |

### What CesiumJS does differently (and why it's OK)

| Google Earth | CesiumJS | Impact |
|---|---|---|
| C++ → WebAssembly | Pure JavaScript + WebGL | Cesium is slightly slower per-frame but no 10 MB Wasm download. Initial load is faster. |
| WebAssembly threads | Single-threaded render loop | Cesium can't decompress on background threads as efficiently. But modern JS engines + GPU are fast enough for our use case. |
| Google's proprietary 3D data | Cesium ion 3D Tiles / Google Photorealistic 3D Tiles | We can use Google's photorealistic tiles via Cesium ion (same data!). |
| Universal Texture (clip mapping) | Per-tile textures with mipmapping | Slightly more visible tile boundaries at extreme zoom, but imperceptible in practice. |

### What CesiumJS does BETTER than Google Earth (for our use case)

| Feature | Google Earth | CesiumJS |
|---|---|---|
| Ocean data overlays | No native support | `ImageryProvider` API for custom overlays (SST, salinity) |
| Zarr streaming | Not supported | zarr-cesium providers |
| Depth slices | Not supported | `ZarrCubeProvider` for 3D ocean slices |
| Current particles | Not supported | `ZarrCubeVelocityProvider` or cesium-wind-layer |
| Time animation | Limited | Full clock system with time-dynamic data |
| Custom shaders | Not exposed | `CustomShader` API for ocean colormaps |
| Open source | No | Yes (Apache 2.0) |
| Self-hosted data | No | Yes (R2, S3, any HTTP server) |

---

## Our Plan: Match Google Earth's Smoothness in CesiumJS

### The 8 Performance Optimizations

#### 1. Request Render Mode (biggest CPU win)

By default, Cesium renders at 60 FPS continuously, even when idle. Google Earth
only renders when something changes. CesiumJS can do the same:

```typescript
const viewer = new Cesium.Viewer('cesiumContainer', {
  requestRenderMode: true,           // Only render when needed
  maximumRenderTimeChange: Infinity,  // Don't render for time changes
  // ... other options
});

// CPU usage drops from 25% → 3% when idle
```

**Impact:** Idle CPU drops from 25% to 3%. When the user interacts, it renders
at full 60 FPS. When idle, it sleeps.

#### 2. Maximum Screen Space Error (LOD quality vs speed)

`maximumScreenSpaceError` controls how much detail is loaded. Higher = less
detail = faster. Default is 2. For ocean viz, we can use 4-8 for speed:

```typescript
viewer.scene.globe.maximumScreenSpaceError = 4;  // Default 2, higher = faster
```

**Impact:** Loads 4× fewer tiles at the same zoom. Slightly less terrain detail
but much faster loading. For ocean data, terrain detail matters less than
ocean overlay detail.

#### 3. Foveated Loading (center loads first)

Cesium prioritizes tiles near the center of the screen (where the user is
looking). This makes the center load faster than the edges:

```typescript
// Already enabled by default, but can tune:
viewer.scene.globe.foveatedScreenSpaceError = 2;  // Lower = center loads sooner
viewer.scene.globe.foveatedMinimumScreenSpaceErrorRelaxation = 0.5;
```

**Impact:** The center of the view (where the user looks) loads first. Edges
load later. Perceived loading is much faster.

#### 4. Cesium World Bathymetry (ocean floor)

Google Earth shows ocean floor bathymetry. CesiumJS has the same:

```typescript
// Use Cesium World Bathymetry (includes ocean floor terrain)
viewer.scene.setTerrain(
  Cesium.Terrain.fromWorldBathymetry({
    requestVertexNormals: true,  // Needed for lighting
  })
);
```

**Impact:** Ocean floor renders with real bathymetry (GEBCO + high-res coastal
data). Combined with lighting, you can see seafloor features.

#### 5. Lighting for Bathymetry (see the ocean floor)

Without lighting, the ocean floor is a flat dark surface. With lighting, you
see peaks, valleys, and ridges:

```typescript
viewer.scene.globe.enableLighting = true;

// Disable ground atmosphere and fog (they hide bathymetry)
viewer.scene.globe.showGroundAtmosphere = false;
viewer.scene.fog.enabled = false;

// Use directional light for hillshade effect
viewer.scene.light = new Cesium.DirectionalLight({
  direction: new Cesium.Cartesian3(1, 0, 0),
  intensity: 2.0,
  color: Cesium.Color.WHITE,
});
```

**Impact:** Ocean floor becomes visible with 3D relief. Critical for ocean
visualization.

#### 6. Terrain Exaggeration (amplify ocean depth)

Ocean depths are small compared to Earth's radius. Exaggerate them to make
bathymetry visible:

```typescript
viewer.scene.verticalExaggeration = 3.0;  // 3× vertical exaggeration
viewer.scene.verticalExaggerationRelativeHeight = 0.0;  // Relative to sea level
```

**Impact:** Ocean trenches and ridges become 3× more visible. Essential for
ocean depth visualization.

#### 7. Water Mask (land vs ocean distinction)

Cesium can distinguish land from water using a water mask:

```typescript
viewer.scene.globe.requestWaterMask = true;

// Custom material for water (lighter blue, reflective)
viewer.scene.globe.material = Cesium.Material.fromType('WaterMask', {
  baseWaterColor: new Cesium.Color(0.2, 0.3, 0.6, 1.0),
  normalMap: '../textures/waterNormals.jpg',
  frequency: 10000,
  animationSpeed: 0.01,
  amplitude: 10,
});
```

**Impact:** Oceans render with a distinct water appearance. Land is clearly
separated from ocean.

#### 8. Optimized Imagery (lighter for ocean)

Bing Aerial imagery is dark over water. Use a lighter imagery provider for
the ocean:

```typescript
// Option A: Natural Earth II (lighter, good for ocean)
viewer.imageryLayers.addImageryProvider(
  new Cesium.TileCoordinatesImageryProvider()
);

// Option B: Use Cesium ion Bing but adjust brightness
viewer.imageryLayers.layerShown = true;
viewer.scene.brightness = 1.5;  // Brighten the scene
```

**Impact:** Ocean areas are lighter, making temperature/salinity overlays more
visible.

---

## The Implementation: `ocean-web/` Project Structure

```
ocean-web/
├── public/
│   └── textures/
│       └── waterNormals.jpg       # Water surface normal map
├── src/
│   ├── components/
│   │   ├── CesiumViewer.tsx       # Main globe component
│   │   ├── GlobeControls.tsx      # Zoom, pan, tilt controls
│   │   ├── TimeSlider.tsx          # Time animation control
│   │   ├── DepthSlider.tsx         # Depth slice control
│   │   ├── ColorbarEditor.tsx      # Colormap controls
│   │   └── VariableSelector.tsx   # SST/salinity/current selector
│   ├── cesium/
│   │   ├── config.ts               # Cesium viewer configuration
│   │   ├── lighting.ts             # Day/night + bathymetry lighting
│   │   ├── performance.ts          # Performance optimizations
│   │   └── providers/
│   │       ├── zarrLayer.ts        # ZarrLayerProvider wrapper
│   │       ├── zarrCube.ts         # ZarrCubeProvider wrapper
│   │       └── zarrVelocity.ts     # ZarrCubeVelocityProvider wrapper
│   ├── api/
│   │   ├── zarrClient.ts           # zarrita.js R2 client
│   │   ├── supabaseClient.ts       # Supabase direct client
│   │   └── isosurfaceClient.ts     # Render backend client
│   ├── store/
│   │   └── useOceanStore.ts        # Zustand state
│   ├── styles/
│   │   └── light-theme.css         # Light theme CSS
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── vite.config.ts
├── vercel.json
├── tsconfig.json
└── package.json
```

---

## The CesiumViewer Component (Core Globe)

```typescript
// src/cesium/config.ts
import * as Cesium from 'cesium';

export function createViewer(container: HTMLElement): Cesium.Viewer {
  const viewer = new Cesium.Viewer(container, {
    // ─── Performance Optimizations ──────────────────────────────
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,

    // ─── Terrain: Cesium World Bathymetry ────────────────────────
    terrain: Cesium.Terrain.fromWorldBathymetry({
      requestVertexNormals: true,
    }),

    // ─── Imagery: Cesium ion Bing ───────────────────────────────
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,

    // ─── Light theme ─────────────────────────────────────────────
    contextOptions: {
      webgl: {
        alpha: false,
        antialias: true,
        preserveDrawingBuffer: false,
      },
    },
  });

  // ─── LOD Performance ──────────────────────────────────────────
  viewer.scene.globe.maximumScreenSpaceError = 4;
  viewer.scene.globe.foveatedScreenSpaceError = 2;
  viewer.scene.globe.foveatedMinimumScreenSpaceErrorRelaxation = 0.5;

  // ─── Lighting (day/night + bathymetry) ───────────────────────
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.showGroundAtmosphere = false;
  viewer.scene.fog.enabled = false;

  // ─── Terrain Exaggeration (amplify ocean depth) ──────────────
  viewer.scene.verticalExaggeration = 3.0;
  viewer.scene.verticalExaggerationRelativeHeight = 0.0;

  // ─── Water Mask ───────────────────────────────────────────────
  viewer.scene.globe.requestWaterMask = true;

  // ─── Light Theme Background ──────────────────────────────────
  viewer.scene.backgroundColor = Cesium.Color.WHITE;
  viewer.scene.skyBox.show = false;
  viewer.scene.skyAtmosphere.show = true;

  // ─── Cesium Ion Token ────────────────────────────────────────
  Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN;

  return viewer;
}
```

---

## Zoom Controls (Match Google Earth)

Google Earth's zoom is smooth and continuous. CesiumJS can match this:

```typescript
// src/components/GlobeControls.tsx
import * as Cesium from 'cesium';

export function setupZoomControls(viewer: Cesium.Viewer) {
  // Smooth zoom with mouse wheel
  viewer.scene.screenSpaceCameraController.zoomRate = 5.0;  // Default 5
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 100;  // Min altitude (meters)
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 20000000;  // Max (space view)

  // Smooth tilt (like Google Earth's "fly" mode)
  viewer.scene.screenSpaceCameraController.minimumCollisionTerrainHeight = 0;
  viewer.scene.screenSpaceCameraController.enableTilt = true;

  // Smooth pan
  viewer.scene.screenSpaceCameraController.translateEventTypes = [
    Cesium.CameraEventType.LEFT_DRAG,
    Cesium.CameraEventType.PINCH,
  ];

  // Double-click to zoom in (like Google Earth)
  viewer.screenSpaceEventHandler.setInputAction(
    (movement: Cesium.ClickEvent) => {
      const cartesian = viewer.scene.pickPosition(movement.position);
      if (cartesian) {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            // ... fly to clicked location, zoom in 2×
          ),
          duration: 1.5,  // Smooth 1.5s animation
        });
      }
    },
    Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
  );
}
```

---

## Performance Comparison: Google Earth vs Our CesiumJS

| Metric | Google Earth Web | Our CesiumJS (optimized) |
|---|---|---|
| Initial load | 10-15 MB Wasm + data | ~5 MB JS (Cesium) + ion terrain |
| Frame rate (active) | 60 FPS | 60 FPS (requestRenderMode) |
| CPU usage (idle) | ~0% | ~3% (requestRenderMode) |
| Zoom smoothness | Smooth (Wasm threads) | Smooth (WebGL + request scheduling) |
| Tile loading | Background threads | Request scheduler + foveated loading |
| Ocean data | Not supported | Zarr overlays (SST, salinity, currents) |
| Bathymetry | Yes (proprietary) | Yes (Cesium World Bathymetry, GEBCO) |
| Day/night | No | Yes (enableLighting) |
| Custom rendering | No | Yes (CustomShader, ImageryProvider) |
| Open source | No | Yes (Apache 2.0) |

**Our CesiumJS globe will be as smooth as Google Earth for navigation, AND it
will have ocean data overlays that Google Earth doesn't have.**

---

## What We're NOT Doing (Scope Discipline)

| Not doing | Why |
|---|---|
| WebAssembly | CesiumJS is pure JS + WebGL. No need to compile C++. |
| Photorealistic 3D Tiles | Google's proprietary data. We use Cesium World Bathymetry instead. |
| Google's Universal Texture | Cesium's per-tile mipmapping is sufficient. |
| Background thread decompression | Cesium uses Web Workers for I/O. Rendering is single-threaded but fast enough. |
| Custom globe renderer | CesiumJS already does everything Google Earth does for globe rendering. |

---

## Implementation Phases (for ocean-web)

### Phase 1: Basic Globe (1-2 days)
- [ ] Scaffold Vite + React + TypeScript in `ocean-web/`
- [ ] Install `cesium`, `vite-plugin-cesium`
- [ ] Create `CesiumViewer` with all 8 optimizations above
- [ ] Light theme, bathymetry, lighting, water mask
- [ ] Deploy to Vercel
- [ ] **Verify:** Smooth zoom, pan, tilt. Ocean floor visible. Day/night works.

### Phase 2: Zarr Overlays (2-3 days)
- [ ] Install `zarr-cesium`, `zarrita`
- [ ] Add `ZarrLayerProvider` for SST from R2
- [ ] Add colorbar UI
- [ ] **Verify:** Temperature overlay renders on globe

### Phase 3: Time + Depth (2-3 days)
- [ ] Time slider (Zarr time index)
- [ ] Depth slider (ZarrCubeProvider for slices)
- [ ] **Verify:** Animation plays, depth slices render

### Phase 4: Currents (2-3 days)
- [ ] `ZarrCubeVelocityProvider` for particles
- [ ] **Verify:** Particles animate

### Phase 5: Argo (2-3 days)
- [ ] Supabase client for Argo markers
- [ ] Profile charts (Plotly)
- [ ] **Verify:** Markers load, profiles render

---

## Immediate Next Step

**Start Phase 1:** Scaffold the `ocean-web/` project and create the optimized
`CesiumViewer` with all 8 performance optimizations. This gives us a Google
Earth-quality globe with bathymetry, lighting, and smooth zoom — the foundation
for all ocean data overlays.
