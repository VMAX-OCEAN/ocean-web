/**
 * Border styling constants and altitude-based alpha computation.
 *
 * The fade bands mirror Google Earth's behavior: borders smoothly
 * fade in/out as the camera zooms, exactly like the cloud layer
 * (see clouds.ts). Each band has a fade-in and fade-out altitude
 * range with overlap to prevent hard "pop" transitions.
 */

import type { BandId } from './borders-data';

/** Visual style per band (pixel width, base color). */
export interface BandVisual {
  width: number;
  color: string;
}

/** Altitude fade range for a band. */
export interface FadeRange {
  /** Alpha goes 0→1 as camera descends through this range (zooming in). */
  fadeInStart: number;  // altitude where fade begins (alpha = 0)
  fadeInEnd: number;    // altitude where fade completes (alpha = 1)
  /** Alpha goes 1→0 as camera descends further (zooming in past this band). */
  fadeOutStart: number; // altitude where fade-out begins (alpha = 1)
  fadeOutEnd: number;   // altitude where fade-out completes (alpha = 0)
}

/** Visual style per band — Google Earth-matched colors and widths. */
export const BAND_VISUALS: Record<BandId, BandVisual> = {
  L0: { width: 1.0, color: '#9aa0a6' }, // continents — medium gray
  L1: { width: 1.2, color: '#b0b0b0' }, // countries — lighter gray
  L2: { width: 1.2, color: '#b0b0b0' }, // detailed countries — same as L1
  L3: { width: 0.8, color: '#c8c8c8' }, // states — lightest gray, thinnest
};

/**
 * Altitude fade ranges (meters) with overlap zones.
 *
 * The overlap (e.g. L0 fades out 8M→12M while L1 fades in 6M→8M)
 * means both bands are partially visible during the transition —
 * no hard pop, just a smooth crossfade like Google Earth.
 *
 * IMPORTANT: No borders appear above 8M altitude (where clouds are
 * visible). Borders fade in AFTER clouds fade out, so they don't
 * appear behind/through the cloud layer.
 *
 * Camera altitude decreases as you zoom IN:
 *
 *   20M ── no borders (clouds visible)
 *    8M ── L0 starts fading in (clouds fading out)
 *    6M ── L0 fully visible
 *    3M ── L1 holds, L2 starts fading in
 *    2M ── L1 starts fading out, L2 fully visible
 *  1.5M ── L1 fully gone, L3 starts fading in
 *  1.0M ── L2 starts fading out, L3 fully visible
 *  0.8M ── L2 fully gone, L3 holds
 */
export const FADE_RANGES: Record<BandId, FadeRange> = {
  // L0 Continents: fade in below 8M (after clouds), fade out below 5M
  L0: {
    fadeInStart: 8_000_000,
    fadeInEnd: 6_000_000,
    fadeOutStart: 5_000_000,
    fadeOutEnd: 3_000_000,
  },
  // L1 Countries: fades in below 6M (after L0), fades out below 2M
  L1: {
    fadeInStart: 6_000_000,
    fadeInEnd: 4_000_000,
    fadeOutStart: 2_000_000,
    fadeOutEnd: 1_500_000,
  },
  // L2 Detailed countries: fades in below 3M, fades out below 1M
  L2: {
    fadeInStart: 3_000_000,
    fadeInEnd: 2_000_000,
    fadeOutStart: 1_000_000,
    fadeOutEnd: 800_000,
  },
  // L3 States: fades in below 1.5M, stays visible
  L3: {
    fadeInStart: 1_500_000,
    fadeInEnd: 1_000_000,
    fadeOutStart: 0,
    fadeOutEnd: 0,
  },
};

/**
 * Compute alpha (0–1) for a band given the current camera altitude.
 *
 * Uses smoothstep for natural-feeling fades (ease-in/ease-out, not linear).
 * Same pattern as clouds.ts computeCloudAlpha().
 */
export function computeBandAlpha(height: number, range: FadeRange): number {
  // If band is always visible (no fade-in), start at 1.0
  let alpha = 1.0;

  // Fade-in: alpha goes 0→1 as height decreases from fadeInStart to fadeInEnd
  if (range.fadeInStart > range.fadeInEnd && height <= range.fadeInStart) {
    if (height <= range.fadeInEnd) {
      alpha = 1.0;
    } else {
      const t = (range.fadeInStart - height) / (range.fadeInStart - range.fadeInEnd);
      alpha = smoothstep(t);
    }
  } else if (height > range.fadeInStart) {
    alpha = 0.0;
  }

  // Fade-out: alpha goes 1→0 as height decreases from fadeOutStart to fadeOutEnd
  if (range.fadeOutStart > range.fadeOutEnd && height <= range.fadeOutStart) {
    if (height <= range.fadeOutEnd) {
      alpha = 0.0;
    } else {
      const t = (height - range.fadeOutEnd) / (range.fadeOutStart - range.fadeOutEnd);
      alpha = Math.min(alpha, smoothstep(t));
    }
  }

  return alpha;
}

/** smoothstep: smooth Hermite interpolation, same as GLSL smoothstep(). */
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}
