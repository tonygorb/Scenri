// SPDX-License-Identifier: Apache-2.0
/**
 * A small useful palette out of a whole website.
 *
 * Not every colour on the page: a homepage easily carries forty, most of them
 * greys a fraction apart, and handing someone that is the same as handing them
 * nothing. What survives is what the site said on purpose - the theme colour,
 * the custom properties a designer named, the fills on the things people
 * click - clustered so near-duplicates collapse into one.
 */
import { type CssColor, extractColors } from './colorParse.js';

export interface ColorHit {
  hex: string;
  weight: number;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/**
 * How much a colour counts for, by where it was written.
 *
 * A custom property named for the brand is a decision someone made once; a
 * border colour on a utility class is an accident of a framework. Counting
 * both as one occurrence is how a palette ends up being four greys.
 */
const BRANDISH_VAR = /--(?:[\w-]*)(brand|primary|accent|secondary|theme|main)/i;
const INTERACTIVE = /(btn|button|cta|primary|brand|badge|header|nav\b|link|hero)/i;

export function weightOf(hit: CssColor): number {
  if (hit.property.startsWith('--')) return BRANDISH_VAR.test(hit.property) ? 6 : 2;
  if (INTERACTIVE.test(hit.context) || INTERACTIVE.test(hit.property)) return 3;
  return 1;
}

export function collectColors(sources: { css: string; weightScale?: number }[]): ColorHit[] {
  const counts = new Map<string, number>();
  for (const { css, weightScale = 1 } of sources) {
    for (const hit of extractColors(css)) {
      counts.set(hit.hex, (counts.get(hit.hex) ?? 0) + weightOf(hit) * weightScale);
    }
  }
  return [...counts.entries()].map(([hex, weight]) => ({ hex, weight }));
}

/**
 * Collapse colours a person could not tell apart.
 *
 * Bucketed in HSL rather than compared pairwise: the point is that #4d61fc and
 * #4d62fd must not both take a slot in a five-swatch strip, and the heaviest
 * member of a bucket is the one the site leant on.
 */
export function dedupeNearby(hits: readonly ColorHit[]): ColorHit[] {
  const buckets = new Map<string, ColorHit>();
  for (const hit of [...hits].sort((a, b) => b.weight - a.weight)) {
    const { h, s, l } = hexToHsl(hit.hex);
    const key =
      s < 0.12 ? `grey:${Math.round(l * 8)}` : `${Math.round(h / 12)}:${Math.round(s * 8)}:${Math.round(l * 8)}`;
    const seen = buckets.get(key);
    if (seen) seen.weight += hit.weight;
    else buckets.set(key, { ...hit });
  }
  return [...buckets.values()].sort((a, b) => b.weight - a.weight);
}

/** A colour seen exactly once on a page full of colours is noise, not a decision. */
export function dropSingletons(hits: readonly ColorHit[]): ColorHit[] {
  if (hits.length < 12) return [...hits];
  const kept = hits.filter((h) => h.weight > 1);
  return kept.length > 0 ? kept : [...hits];
}

export interface Palette {
  primary?: string;
  secondary?: string;
  accent: string[];
  neutrals: string[];
}

/**
 * The shape the .brand document wants. Unchanged from the version that lived
 * in buildFromUrl: saturated colours lead, washed-out and near-black or
 * near-white ones are neutrals, and nothing is invented when nothing is
 * confident.
 */
export function pickPalette(hits: readonly ColorHit[]): Palette {
  const sorted = [...hits].sort((a, b) => b.weight - a.weight).map((h) => h.hex);
  const saturated: string[] = [];
  const neutrals: string[] = [];
  for (const c of sorted) {
    const { s, l } = hexToHsl(c);
    if (s < 0.12 || l < 0.06 || l > 0.96) neutrals.push(c);
    else saturated.push(c);
  }
  return {
    primary: saturated[0],
    secondary: saturated[1],
    accent: saturated.slice(2, 4),
    neutrals: neutrals.slice(0, 2),
  };
}

/** The whole pass, so a caller says what it collected and gets what to store. */
export function paletteFrom(sources: { css: string; weightScale?: number }[]): Palette {
  return pickPalette(dropSingletons(dedupeNearby(collectColors(sources))));
}
