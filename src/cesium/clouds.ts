import * as Cesium from 'cesium';

/**
 * Real, moving cloud layer with altitude-based visibility fade.
 *
 * Technique: a slightly-larger, translucent ellipsoid shell textured with
 * a real cloud map, rotated slowly and independently from the Earth's
 * surface each frame.
 *
 * Texture source: matteason/live-cloud-maps — a free, near-real-time
 * (refreshed every 3 hours) satellite-derived global cloud map with an
 * alpha channel, available up to 8192×4096. We use the 4096×2048 tier.
 * https://github.com/matteason/live-cloud-maps
 *
 * Rendering is intentionally FLAT (unlit) — see CLOUD-WEDGE-FIX-PLAN.md.
 * An earlier version enabled normal-based (Lambertian) lighting on this
 * shell to darken clouds on the night side. That introduced a serious
 * artifact: EllipsoidGeometry's stack/slice tessellation converges to a
 * single point at each pole, where adjacent triangles have degenerate,
 * inconsistent vertex normals. Lighting math on those broken normals
 * produced a dark blob with radiating streaks right at the pole —
 * visible in normal use, not just at extreme zoom. Since the globe's
 * own day/night lighting is now disabled entirely (see config.ts), the
 * clouds no longer need lighting either — flat shading removes the
 * broken-normal math (and the artifact) at its source, not just its
 * symptom.
 *
 * Pole "pinwheel" texture artifact — classic equirectangular-to-sphere
 * UV pinching: at the poles, an entire row of texture pixels collapses
 * to a single point, but adjacent triangles still sample different
 * longitudes there, producing a radiating fan pattern in the *texture*
 * (separate from the lighting artifact above). This is why real systems
 * (Google Earth, NASA visualizations) use tiled quadtree imagery
 * instead of one equirectangular texture on a raw sphere — their tiling
 * scheme handles poles specially. Rather than rebuild our cloud layer
 * as a full tile provider, we fade the cloud alpha to zero near the
 * poles (|latitude| > ~80°) in the shader below, removing this artifact
 * at its source too.
 */
// 2048x1024 tier instead of 4096x2048: ~4x fewer pixels to download and
// decode. At the zoom levels where clouds are actually visible (>8000km,
// per the fade band below), the extra detail in the 4K tier is not
// perceptible, but the smaller download meaningfully speeds up first
// load, especially on the same connection competing with terrain/imagery
// requests. See LOAD-PERF-PLAN.md addendum (cloud texture sizing).
const CLOUD_TEXTURE_URL = 'https://clouds.matteason.co.uk/images/2048x1024/clouds-alpha.png';

// Radians per clock tick — slow, believable drift (not tied to Earth's
// own rotation, which is intentional: real cloud bands drift at their
// own pace relative to the ground).
const CLOUD_ROTATION_SPEED = 0.00003;

// Altitude fade band (meters) — matches Google Earth Studio docs:
// "When Time of Day is turned off, clouds begin to fade out at
// 20,000 km. Below 8,000 km, they don't render at all."
// See google-earth-darkside-clouds-research.md.
const FADE_OUT_COMPLETE_HEIGHT = 8_000_000;  // fully invisible at/below 8,000 km
const FADE_IN_COMPLETE_HEIGHT = 20_000_000; // fully visible at/above 20,000 km

/**
 * Custom material (Cesium Fabric) with:
 * - an explicit `alpha` uniform for the altitude fade
 * - a latitude-based pole fade to remove UV-pinching texture artifacts
 *
 * No lighting is applied here or by the Appearance (flat shading) —
 * see the file-level comment above for why.
 */
function createCloudMaterial(textureUrl: string): Cesium.Material {
  return new Cesium.Material({
    fabric: {
      type: 'CloudImage',
      uniforms: {
        image: textureUrl,
        alpha: 1.0,
      },
      source: `
        uniform sampler2D image;
        uniform float alpha;

        czm_material czm_getMaterial(czm_materialInput materialInput)
        {
            czm_material material = czm_getDefaultMaterial(materialInput);
            vec4 texColor = texture(image, materialInput.st);

            // Fade to transparent near the poles (st.t is 0 at one pole,
            // 1 at the other, 0.5 at the equator) to avoid the UV-sphere
            // pole-pinching "pinwheel" / "starburst" artifact.
            //
            // The earlier fade (0.88→0.98, i.e. ~80°→~88° lat) was too
            // late — the starburst was visible between 75° and 80° before
            // the fade kicked in. Research across open-source globe
            // projects (GL4SS, hcschuetz/sphere-texturing, deck.gl) shows
            // the fix is to fade earlier: start at ~70° (0.78) and
            // complete by ~78° (0.87). Real polar clouds are thin and
            // sparse, so losing clouds above 70° is visually acceptable.
            float distFromEquator = abs(materialInput.st.t - 0.5) * 2.0;
            float poleFade = 1.0 - smoothstep(0.78, 0.87, distFromEquator);

            material.diffuse = texColor.rgb;
            material.alpha = texColor.a * alpha * poleFade;
            return material;
        }
      `,
    },
    translucent: true,
  });
}

function computeCloudAlpha(height: number): number {
  if (height >= FADE_IN_COMPLETE_HEIGHT) return 1.0;
  if (height <= FADE_OUT_COMPLETE_HEIGHT) return 0.0;
  return (
    (height - FADE_OUT_COMPLETE_HEIGHT) /
    (FADE_IN_COMPLETE_HEIGHT - FADE_OUT_COMPLETE_HEIGHT)
  );
}

export function addCloudLayer(viewer: Cesium.Viewer): Cesium.Primitive {
  const ellipsoid = viewer.scene.globe.ellipsoid;

  // Slightly larger than the WGS84 ellipsoid so clouds float above
  // terrain/bathymetry instead of z-fighting with the surface.
  const cloudRadii = new Cesium.Cartesian3(
    ellipsoid.radii.x + 15000,
    ellipsoid.radii.y + 15000,
    ellipsoid.radii.z + 15000
  );

  // Load the cloud texture directly via Cesium's Resource API, which
  // uses crossOrigin='anonymous' for image loads. This works even when
  // XHR HEAD requests are CORS-blocked (many CDNs allow GET image
  // requests but not HEAD). The earlier synchronous XHR HEAD check was
  // too strict — it rejected URLs that would have loaded fine as images.
  const material = createCloudMaterial(CLOUD_TEXTURE_URL);

  const primitive = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.EllipsoidGeometry({
        radii: cloudRadii,
        // 64x128 instead of 24x48: the earlier low tessellation
        // produced visible flat facets at the globe's silhouette (the
        // "outlayer" limb where clouds meet space). Each facet sampled
        // the cloud texture differently, creating a "bubbles and mini
        // circles" pattern. 64x128 restores a smooth silhouette while
        // still being built on a worker (asynchronous:true below), so
        // the extra vertices don't block the main thread.
        stackPartitions: 64,
        slicePartitions: 128,
        // No NORMAL needed — flat (unlit) shading below doesn't use it,
        // and skipping it trims vertex data / build time.
        vertexFormat: Cesium.VertexFormat.POSITION_AND_ST,
      }),
    }),
    appearance: new Cesium.MaterialAppearance({
      material,
      translucent: true,
      closed: true,
      // Flat shading: no per-fragment lighting at all. This avoids the
      // pole normal-singularity artifact described above, and matches
      // the globe's own lighting being fully disabled (config.ts).
      flat: true,
    }),
    // Build geometry on a web worker instead of blocking the main
    // thread — keeps the cloud shell from delaying first interaction.
    asynchronous: true,
  });

  viewer.scene.primitives.add(primitive);

  let angle = 0;
  let lastAlpha = -1; // track changes so we only requestRender when needed
  viewer.clock.onTick.addEventListener(() => {
    // Altitude-based fade — hide clouds once zoomed in close to the surface
    const height = viewer.camera.positionCartographic.height;
    const alpha = computeCloudAlpha(height);

    // Fast path: clouds fully invisible. Skip all rotation, matrix
    // building, and uniform writes — just ensure the primitive is
    // hidden and return. This is the common case when the user is
    // zoomed in (below 8,000 km), where per-frame work here was pure
    // waste. Only request a render if visibility actually changed.
    if (alpha <= 0) {
      if (primitive.show) {
        primitive.show = false;
        viewer.scene.requestRender();
      }
      lastAlpha = 0;
      return;
    }

    // Clouds visible — rotate, update uniforms, and ensure showing.
    angle += CLOUD_ROTATION_SPEED;
    primitive.modelMatrix = Cesium.Matrix4.fromRotationTranslation(
      Cesium.Matrix3.fromRotationZ(angle),
      Cesium.Cartesian3.ZERO
    );

    const appearance = primitive.appearance as Cesium.MaterialAppearance;
    appearance.material.uniforms.alpha = alpha;

    if (!primitive.show) {
      primitive.show = true;
    }

    // Only request a render if alpha changed (e.g. crossing the fade
    // band). Once fully visible and the camera is stable at high
    // altitude, alpha stays 1.0 and we skip the requestRender call —
    // Cesium's requestRenderMode keeps the frame static.
    if (alpha !== lastAlpha) {
      viewer.scene.requestRender();
      lastAlpha = alpha;
    }
  });

  return primitive;
}
