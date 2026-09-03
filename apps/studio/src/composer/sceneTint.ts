import { normalizeTint } from './line.js';

/**
 * The most alive colour in an image, for tinting a brand-owned scene's chip.
 *
 * Catalog scenes get this from the server (packages/cli/src/swatch.ts), once
 * per process. A custom scene's preview is a brand asset the server never
 * decorates, so the same scoring runs here, once per image URL, on a 48px
 * canvas. Same buckets, same thresholds: the two paths must name the same
 * colour for the same picture. The one divergence is the fallback: where the
 * server asks sharp for a dominant bin, a picture with nothing colourful
 * enough simply gets no tint here, which is what normalizeTint would have
 * said about a muddy dominant anyway.
 */
const cache = new Map<string, Promise<string | null>>();
/** Pictures whose tint is remembered. Past this the oldest is forgotten; a Map keeps insertion order. */
export const TINT_CACHE_CAP = 64;

export function vibrantTintOf(url: string): Promise<string | null> {
  let p = cache.get(url);
  if (!p) {
    p = pixelsOf(url)
      .then((px) => (px ? vibrantFromPixels(px.data, 4) : null))
      .catch(() => null);
    cache.set(url, p);
    while (cache.size > TINT_CACHE_CAP) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

/** How many pictures the cache holds right now (tests). */
export function tintCacheSize(): number {
  return cache.size;
}

/**
 * Reads the colour and paints the chip when it arrives. Fire-and-forget on
 * purpose: chips are imperative DOM the line owns, and a repaint that
 * recreated the element simply asks again and hits the cache.
 */
export function applySceneTint(el: HTMLElement, url: string): void {
  void vibrantTintOf(url).then((hex) => {
    const tint = normalizeTint(hex ?? undefined);
    if (!tint || !el.isConnected) return;
    el.dataset.tinted = 'true';
    el.style.setProperty('--tint', tint);
  });
}

async function pixelsOf(url: string): Promise<ImageData | null> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const scale = Math.min(1, 48 / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  try {
    return ctx.getImageData(0, 0, w, h);
  } catch {
    // a tainted canvas means a cross-origin preview: no tint, never a throw
    return null;
  }
}

/** The scoring itself, kept pure so the buckets can be tested without a DOM. */
export function vibrantFromPixels(data: Uint8ClampedArray | number[], channels: number): string | null {
  // 24 hue buckets, each accumulating a score-weighted average
  const buckets = Array.from({ length: 24 }, () => ({ score: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i + channels - 1 < data.length; i += channels) {
    if (channels === 4 && data[i + 3] < 128) continue; // skip transparent
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < 0.18) continue; // greys carry no mood
    if (l < 0.12 || l > 0.92) continue; // near-black and blown-out highlights
    // favour saturated colours that sit in the readable middle of the range
    const score = s * (1 - Math.abs(l - 0.5) * 1.2);
    const bucket = buckets[Math.min(23, Math.floor((h / 360) * 24))];
    bucket.score += score;
    bucket.r += r * score;
    bucket.g += g * score;
    bucket.b += b * score;
  }
  const best = buckets.reduce((a, b) => (b.score > a.score ? b : a), buckets[0]);
  if (best.score <= 0) return null;
  return toHex(best.r / best.score, best.g / best.score, best.b / best.score);
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
