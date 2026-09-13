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
import type { CheerioAPI } from 'cheerio';
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

/**
 * The class names the live document is actually wearing.
 *
 * A page builder ships every theme it offers in one stylesheet - a dozen
 * `--primary` declarations, one per variant - and marks the live one on the
 * html element. Counting them all flat is how a site whose palette is
 * `.style-blue-3 { --primary: #518ce8 }` came back with a pink primary lifted
 * from a theme it does not use.
 */
export function liveClassTokens($: CheerioAPI): string[] {
  const tokens = new Set<string>();
  for (const sel of ['html', 'body']) {
    for (const cls of ($(sel).first().attr('class') ?? '').split(/\s+/)) {
      if (cls) tokens.add(cls.toLowerCase());
    }
  }
  return [...tokens];
}

/** `style-blue-3` and `style-green-2` are siblings; `btn` is not related to either. */
const familyOf = (cls: string): string => cls.split('-')[0];

/**
 * Whether a rule belongs to a theme this page is not wearing.
 *
 * Deliberately narrow. Almost every selector names a class the html element
 * does not have - `.btn`, `.hero`, `.card` - and those are ordinary rules that
 * absolutely apply. What this catches is the one shape that lies to a counter:
 * a page builder shipping `.style-blue-3` beside `.style-green-2`, each with a
 * full palette, where the document wears exactly one of them. A rule is
 * refused only when its leading class is a sibling of a live class and is not
 * itself live.
 */
export function selectorIsLive(selector: string, live: readonly string[]): boolean {
  const sel = selector.toLowerCase();
  if (sel.includes(':root')) return true;
  const families = new Set(live.map(familyOf));
  // A comma list is many selectors; one live branch is enough.
  return sel.split(',').some((branch) => {
    // A :not() filters a rule, it never selects it.
    const positive = branch.replace(/:not\([^)]*\)/g, '').match(/\.[a-z0-9_-]+/g);
    if (!positive) return true;
    const leading = positive[0].slice(1);
    if (live.includes(leading)) return true;
    return !families.has(familyOf(leading));
  });
}

/** The slots a site can name for itself. `dark` and `light` are a theme's own, not greys. */
export type DeclaredRole = 'primary' | 'secondary' | 'accent' | 'dark' | 'light';

/** `--brand-primary-dark` -> `{ role: 'primary', variant: true }` */
export function roleOfProperty(property: string): { role: DeclaredRole; variant: boolean } | null {
  if (!property.startsWith('--')) return null;
  const name = property
    .slice(2)
    .toLowerCase()
    .replace(/^(brand|color|colour|theme|sc|c|ui)-/, '');
  const base =
    /^(primary|secondary|accent|dark|light)(?:-(\d+|dark|light|hover|active|soft|muted|contrast|foreground|fg|bg))?$/.exec(
      name,
    );
  if (!base) return null;
  return { role: base[1] as DeclaredRole, variant: Boolean(base[2]) };
}

export interface DeclaredPalette {
  primary?: string;
  secondary?: string;
  accent?: string;
  /** A theme's own dark and light: brand colours, not greys. */
  dark?: string;
  light?: string;
}

/**
 * What the site says its colours are, rather than what it happens to use most.
 *
 * The same doctrine as the logo scorer: a name a designer wrote is worth more
 * than any amount of counting. Later declarations win, as the cascade does,
 * and a `-dark` or `-hover` variant never takes the base slot.
 */
export function declaredPalette(hits: readonly CssColor[], live: readonly string[]): DeclaredPalette {
  const best = new Map<DeclaredRole, { hex: string; rank: number }>();
  for (const hit of hits) {
    const named = roleOfProperty(hit.property);
    if (!named || !selectorIsLive(hit.context, live)) continue;
    // Specificity in miniature, because it settles real disagreements. A rule
    // scoped to a class the document is actually wearing is this site stating
    // its own theme; a rule scoped to some other class is a component's
    // default; a bare `:root` is whatever library got bundled in last. The
    // page that prompted this ships all three, and the last one to appear was
    // a widget's Tailwind sky-500. A base name also outranks a `-dark` or
    // `-hover` variant of itself, and equal rank goes to the later rule, as
    // the cascade does.
    const classes = hit.context.toLowerCase().match(/\.[a-z0-9_-]+/g) ?? [];
    const onLiveRoot = classes.some((c) => live.includes(c.slice(1)));
    const rank = (onLiveRoot ? 4 : classes.length > 0 ? 2 : 0) + (named.variant ? 0 : 1);
    const seen = best.get(named.role);
    if (seen && seen.rank > rank) continue;
    best.set(named.role, { hex: hit.hex, rank });
  }
  return {
    primary: best.get('primary')?.hex,
    secondary: best.get('secondary')?.hex,
    accent: best.get('accent')?.hex,
    dark: best.get('dark')?.hex,
    light: best.get('light')?.hex,
  };
}

export function collectColors(
  sources: { css: string; weightScale?: number }[],
  live: readonly string[] = [],
): ColorHit[] {
  const counts = new Map<string, number>();
  for (const { css, weightScale = 1 } of sources) {
    for (const hit of extractColors(css)) {
      // A rule for a theme this page is not wearing is not this brand's
      // colour. Without this, a builder that ships a dozen palettes hands
      // back whichever one it happens to repeat most.
      if (live.length > 0 && !selectorIsLive(hit.context, live)) continue;
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

/**
 * The whole pass. What the site declares for its live theme takes the named
 * slots; counting fills whatever is left over.
 */
export function paletteFrom(sources: { css: string; weightScale?: number }[], live: readonly string[] = []): Palette {
  const hits = sources.flatMap((s) => extractColors(s.css));
  const declared = declaredPalette(hits, live);
  const counted = pickPalette(dropSingletons(dedupeNearby(collectColors(sources, live))));

  const taken = new Set<string>();
  const take = (hex: string | undefined): string | undefined => {
    if (!hex || taken.has(hex)) return undefined;
    taken.add(hex);
    return hex;
  };
  const primary = take(declared.primary) ?? take(counted.primary);
  const secondary = take(declared.secondary) ?? take(counted.secondary);
  // A declared accent often repeats the primary, which says something about
  // the theme and nothing to a person looking at swatches.
  //
  // And once a site has named its own colours, stop guessing: topping a
  // declared palette up by frequency is how a blue-and-pink brand came back
  // with a green in it, lifted out of an illustration.
  const named = Boolean(declared.primary || declared.secondary);
  const accent = (named ? [declared.accent, declared.dark, declared.light] : counted.accent)
    .map(take)
    .filter((h): h is string => Boolean(h))
    .slice(0, 2);
  const neutrals = counted.neutrals.filter((h) => !taken.has(h)).slice(0, 2);
  return { primary, secondary, accent, neutrals };
}
