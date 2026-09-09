import * as Cesium from 'cesium';
import { createGibsTilingScheme } from './gibs-tiling-scheme';

/**
 * Natural, Google-Earth-like land/ocean base imagery.
 *
 * Replaces Cesium's default Bing Maps Aerial base layer with NASA GIBS
 * "Blue Marble: Next Generation" — a cloud-free, seasonal, true-color
 * mosaic derived from MODIS data. This is the same lineage of dataset
 * (NASA true-color Earth imagery) that Google's own early Earth base
 * maps were built from, and it gives the natural blue-ocean /
 * green-brown-land look the research asked for, without:
 *
 * - Cesium's default gamma=1.3 "washed out" look applied to Bing Maps
 *   Aerial (see Cesium issue #3279 — this gamma was tuned for old
 *   displays and makes colors look flat/pale).
 * - Daily-satellite-pass artifacts (clouds, snow misclassification)
 *   that the *daily* MODIS true-color layer has — Blue Marble: Next
 *   Generation is a pre-processed, cloud-free monthly composite, which
 *   is why NASA/Google-style "whole Earth" visualizations use it
 *   instead of the raw daily feed.
 *
 * Data source: NASA GIBS (free, no API key, no token, CORS-enabled,
 * tile-based — progressive loading, no pole pinching, no upfront
 * download, unlike a single equirectangular texture).
 * https://nasa-gibs.github.io/gibs-api-docs/
 *
 * See LAND-COLOR-AND-DAYNIGHT-PLAN.md for the full research and the
 * alternatives considered (Bing gamma fix, Google Maps via ion, hybrid).
 */

const GIBS_WMTS_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi';

// Verified from the GIBS WMTS Capabilities XML (epsg4326/best):
// "Blue Marble (MODIS)" -> identifier BlueMarble_NextGeneration,
// tile matrix set 500m, format image/jpeg. No TIME dimension (static).
const GIBS_LAYER = 'BlueMarble_NextGeneration';
const GIBS_TILE_MATRIX_SET_ID = '500m';
const GIBS_FORMAT = 'image/jpeg';

/**
 * Replace the viewer's default base imagery layer (Bing Maps Aerial)
 * with the NASA Blue Marble: Next Generation layer.
 *
 * Returns the new base ImageryLayer.
 */
export function setNaturalBaseImagery(viewer: Cesium.Viewer): Cesium.ImageryLayer {
  const provider = new Cesium.WebMapTileServiceImageryProvider({
    url: GIBS_WMTS_URL,
    layer: GIBS_LAYER,
    style: 'default',
    format: GIBS_FORMAT,
    tileMatrixSetID: GIBS_TILE_MATRIX_SET_ID,
    maximumLevel: 8,
    tileWidth: 256,
    tileHeight: 256,
    tilingScheme: createGibsTilingScheme(),
    credit: new Cesium.Credit('NASA GIBS — Blue Marble: Next Generation'),
  });

  // Remove the existing base layer (Bing Maps Aerial) — index 0 is
  // always the base layer, stretched to fill the globe.
  const layers = viewer.imageryLayers;
  if (layers.length > 0) {
    layers.remove(layers.get(0), true);
  }

  const layer = new Cesium.ImageryLayer(provider);
  layers.add(layer, 0);

  return layer;
}
