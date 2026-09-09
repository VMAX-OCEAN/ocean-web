import * as Cesium from 'cesium';

/**
 * NASA GIBS uses a non-standard geographic tiling scheme for its
 * EPSG:4326 endpoint: tile counts per level are NOT powers of 2
 * (2x1, 3x2, 5x3, 10x5, ...) and tiles are 512px. Shared by any GIBS
 * WMTS layer we add (night lights, base imagery, future data layers).
 *
 * Ported from the official NASA GIBS Cesium example:
 * https://github.com/nasa-gibs/gibs-web-examples/blob/master/examples/cesium/gibs.js
 */
export function createGibsTilingScheme(): Cesium.GeographicTilingScheme {
  const scheme = new Cesium.GeographicTilingScheme();
  const tilePixels = 512;
  const rectangle = Cesium.Rectangle.MAX_VALUE;

  const levels = [
    { width: 2, height: 1, resolution: 0.009817477042468103 },
    { width: 3, height: 2, resolution: 0.004908738521234052 },
    { width: 5, height: 3, resolution: 0.002454369260617026 },
    { width: 10, height: 5, resolution: 0.001227184630308513 },
    { width: 20, height: 10, resolution: 0.0006135923151542565 },
    { width: 40, height: 20, resolution: 0.00030679615757712823 },
    { width: 80, height: 40, resolution: 0.00015339807878856412 },
    { width: 160, height: 80, resolution: 0.00007669903939428206 },
    { width: 320, height: 160, resolution: 0.00003834951969714103 },
  ];

  scheme.getNumberOfXTilesAtLevel = (level: number): number => {
    return levels[level].width;
  };

  scheme.getNumberOfYTilesAtLevel = (level: number): number => {
    return levels[level].height;
  };

  scheme.tileXYToRectangle = (
    x: number,
    y: number,
    level: number,
    result?: Cesium.Rectangle
  ): Cesium.Rectangle => {
    const resolution = levels[level].resolution;
    const xTileWidth = resolution * tilePixels;
    const west = x * xTileWidth + rectangle.west;
    const east = (x + 1) * xTileWidth + rectangle.west;
    const yTileHeight = resolution * tilePixels;
    const north = rectangle.north - y * yTileHeight;
    const south = rectangle.north - (y + 1) * yTileHeight;

    if (!result) {
      result = new Cesium.Rectangle(0, 0, 0, 0);
    }
    result.west = west;
    result.south = south;
    result.east = east;
    result.north = north;
    return result;
  };

  scheme.positionToTileXY = (
    position: Cesium.Cartographic,
    level: number,
    result?: Cesium.Cartesian2
  ): Cesium.Cartesian2 => {
    if (!Cesium.Rectangle.contains(rectangle, position)) {
      // Base class type requires a Cartesian2 return (not undefined).
      // Return a sentinel (-1, -1) which Cesium treats as "no tile".
      return new Cesium.Cartesian2(-1, -1);
    }
    const xTiles = levels[level].width;
    const yTiles = levels[level].height;
    const resolution = levels[level].resolution;
    const xTileWidth = resolution * tilePixels;
    const yTileHeight = resolution * tilePixels;

    let longitude = position.longitude;
    if (rectangle.east < rectangle.west) {
      longitude += Cesium.Math.TWO_PI;
    }

    let xTileCoordinate = (longitude - rectangle.west) / xTileWidth | 0;
    if (xTileCoordinate >= xTiles) {
      xTileCoordinate = xTiles - 1;
    }

    const latitude = position.latitude;
    let yTileCoordinate = (rectangle.north - latitude) / yTileHeight | 0;
    if (yTileCoordinate > yTiles) {
      yTileCoordinate = yTiles - 1;
    }

    if (!result) {
      result = new Cesium.Cartesian2(0, 0);
    }
    result.x = xTileCoordinate;
    result.y = yTileCoordinate;
    return result;
  };

  return scheme;
}
