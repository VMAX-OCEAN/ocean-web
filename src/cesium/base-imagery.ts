import * as Cesium from 'cesium';

/**
 * Sharp, Google-Earth-like base imagery.
 *
 * Was: NASA GIBS Blue Marble Next Generation (500m, level 8 cap) — pretty
 * from space, blurry on zoom. Replaced with Esri World Imagery (up to
 * sub-meter in places, levels 0-19) — free, no key, CORS-enabled.
 *
 * ponytail: single Esri base ceiling now; re-add GIBS as space-view
 * underlay with height-based fade if oceans look patchy from far.
 */

const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';

/**
 * Replace the viewer's default base imagery layer (Bing Maps Aerial)
 * with Esri World Imagery.
 *
 * Returns the new base ImageryLayer.
 */
export async function setNaturalBaseImagery(viewer: Cesium.Viewer): Promise<Cesium.ImageryLayer> {
  const layer = Cesium.ImageryLayer.fromProviderAsync(
    Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI_URL),
  );

  // Remove the existing base layer (Bing Maps Aerial) — index 0 is
  // always the base layer, stretched to fill the globe.
  const layers = viewer.imageryLayers;
  if (layers.length > 0) {
    layers.remove(layers.get(0), true);
  }

  layer.gamma = 1.0;
  layer.contrast = 1.05;
  layer.saturation = 1.1;
  layers.add(layer, 0);

  return layer;
}
