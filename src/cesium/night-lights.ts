import * as Cesium from 'cesium';
import { createGibsTilingScheme } from './gibs-tiling-scheme';

/**
 * NASA GIBS Black Marble night-lights imagery layer.
 *
 * Adds a city-lights texture that is only visible on the night side of
 * the globe, matching Google Earth's "Time of Day" night-side
 * appearance. Uses Cesium's built-in `dayAlpha`/`nightAlpha` imagery
 * layer properties — no custom shader needed. The globe's
 * `APPLY_DAY_NIGHT_ALPHA` shader path automatically blends this layer's
 * alpha based on the sun direction.
 *
 * Data source: NASA GIBS (Global Imagery Browse Services) — free, no
 * API key, no token, CORS-enabled, tile-based (progressive loading, no
 * pole pinching, no upfront download).
 * https://nasa-gibs.github.io/gibs-api-docs/
 *
 * See:
 * - day-night-terminator-deep-dive.md (research)
 * - NIGHT-LIGHTS-IMPL-PLAN.md (implementation plan)
 */

// GIBS WMTS endpoint for EPSG:4326 (geographic projection).
// TIME=2016-01-01 is the latest available date for VIIRS_Black_Marble
// (verified from the GIBS WMTS Capabilities XML).
const GIBS_WMTS_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?TIME=2016-01-01';

// GIBS layer identifier (verified from Capabilities XML).
const GIBS_LAYER = 'VIIRS_Black_Marble';

// Tile matrix set for 500m resolution (verified from Capabilities XML).
const GIBS_TILE_MATRIX_SET_ID = '500m';

/**
 * Add the NASA Black Marble night-lights layer to the viewer.
 *
 * The layer is configured with `dayAlpha = 0` (invisible on the day
 * side) and `nightAlpha = 1` (fully visible on the night side). Cesium's
 * built-in shader handles the blending automatically based on the sun
 * direction — no custom shader needed.
 *
 * Returns the created ImageryLayer so the caller can adjust or remove
 * it later if needed.
 */
export function addNightLightsLayer(viewer: Cesium.Viewer): Cesium.ImageryLayer {
  const provider = new Cesium.WebMapTileServiceImageryProvider({
    url: GIBS_WMTS_URL,
    layer: GIBS_LAYER,
    style: 'default',
    format: 'image/png',
    tileMatrixSetID: GIBS_TILE_MATRIX_SET_ID,
    maximumLevel: 8,
    tileWidth: 256,
    tileHeight: 256,
    tilingScheme: createGibsTilingScheme(),
    credit: new Cesium.Credit('NASA GIBS — VIIRS Black Marble'),
  });

  const layer = viewer.imageryLayers.addImageryProvider(provider);

  // Only show city lights on the night side of the globe.
  // This uses Cesium's built-in APPLY_DAY_NIGHT_ALPHA shader path,
  // which blends the layer alpha based on the sun direction.
  layer.dayAlpha = 0.0; // invisible on the day side
  layer.nightAlpha = 1.0; // fully visible on the night side

  // Boost the city lights brightness so they're clearly visible
  // against the dark night side (per Cesium's Earth-at-Night tutorial).
  layer.brightness = 2.0;

  return layer;
}
