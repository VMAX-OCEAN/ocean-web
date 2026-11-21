/**
 * Custom Cesium ImageryProvider that serves a pre-rendered HTMLCanvasElement
 * directly — no PNG encode/decode round-trip, no blob URL.
 *
 * Why this exists:
 *   The previous flow was:  canvas → canvas.toBlob('image/png') → blob URL →
 *   SingleTileImageryProvider → Cesium decodes PNG back to image → GPU texture.
 *   That PNG encode + decode wastes 1.5–3.5 seconds per frame on a 3600×1800
 *   canvas. Cesium's ImageryTypes explicitly includes HTMLCanvasElement, so we
 *   can hand the canvas straight to requestImage() and skip the round-trip.
 *
 * The provider owns a single tile (level 0, x=0, y=0) covering the given
 * rectangle. It mirrors SingleTileImageryProvider's shape but is constructed
 * synchronously from an already-rendered canvas.
 */
import * as Cesium from 'cesium';

export interface CanvasImageryProviderOptions {
  /** Pre-rendered canvas to display. */
  canvas: HTMLCanvasElement;
  /** Geographic rectangle (degrees) the canvas covers. */
  rectangle: Cesium.Rectangle;
  /** Optional tile size hint (defaults to canvas dimensions). */
  tileWidth?: number;
  tileHeight?: number;
}

export class CanvasImageryProvider implements Cesium.ImageryProvider {
  private _canvas: HTMLCanvasElement;
  private _tilingScheme: Cesium.GeographicTilingScheme;
  private _tileWidth: number;
  private _tileHeight: number;
  private _rectangle: Cesium.Rectangle;
  private _errorEvent: Cesium.Event;
  private _credit: Cesium.Credit;
  private _hasError = false;

  constructor(options: CanvasImageryProviderOptions) {
    this._canvas = options.canvas;
    this._rectangle = options.rectangle;
    this._tileWidth = options.tileWidth ?? options.canvas.width;
    this._tileHeight = options.tileHeight ?? options.canvas.height;

    this._tilingScheme = new Cesium.GeographicTilingScheme({
      rectangle: this._rectangle,
      numberOfLevelZeroTilesX: 1,
      numberOfLevelZeroTilesY: 1,
    });

    this._errorEvent = new Cesium.Event();
    this._credit = new Cesium.Credit('Ocean data overlay');
  }

  // Read-only properties required by the ImageryProvider interface.
  get rectangle(): Cesium.Rectangle { return this._rectangle; }
  get tileWidth(): number { return this._tileWidth; }
  get tileHeight(): number { return this._tileHeight; }
  get maximumLevel(): number { return 0; }
  get minimumLevel(): number { return 0; }
  get tilingScheme(): Cesium.GeographicTilingScheme { return this._tilingScheme; }
  get tileDiscardPolicy(): Cesium.TileDiscardPolicy { return undefined as unknown as Cesium.TileDiscardPolicy; }
  get errorEvent(): Cesium.Event { return this._errorEvent; }
  get credit(): Cesium.Credit { return this._credit; }
  get proxy(): Cesium.Proxy { return undefined as unknown as Cesium.Proxy; }
  get hasAlphaChannel(): boolean { return true; }

  getTileCredits(_x: number, _y: number, _level: number): Cesium.Credit[] {
    return [];
  }

  /**
   * Return the pre-rendered canvas for the single level-0 tile.
   * For any other tile coordinate (should not happen with maximumLevel=0),
   * return a 1×1 transparent canvas to avoid errors.
   */
  requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> {
    if (this._hasError) {
      return Promise.resolve(this._fallbackCanvas());
    }
    if (x === 0 && y === 0 && level === 0) {
      return Promise.resolve(this._canvas);
    }
    return Promise.resolve(this._fallbackCanvas());
  }

  private _fallbackCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return c;
  }

  pickFeatures(): undefined {
    return undefined;
  }

  /** Update the canvas (used for animation without recreating the provider). */
  updateCanvas(canvas: HTMLCanvasElement): void {
    this._canvas = canvas;
  }
}
