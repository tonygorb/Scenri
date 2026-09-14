// SPDX-License-Identifier: Apache-2.0
/**
 * A brand kit, from a website.
 *
 * Any website. A shop is one kind of brand source and not the interesting
 * kind: a portfolio, an agency page or a company homepage all carry a name, a
 * mark and a palette, and none of them carry products. Nothing here knows what
 * a product is.
 *
 * The contract is a useful first draft, never a reverse-engineered brand
 * guideline. Everything found is reported, everything missing is said plainly,
 * and the kit editor is one click away either way.
 */
import * as cheerio from 'cheerio';
import { liveClassTokens, paletteFrom } from './colors.js';
import { type LogoCandidate, type LogoSource, logoCandidates, svgAsMark } from './logoCandidates.js';
import { type GuardOptions, type GuardedFetch, createGuardedFetch } from './safeFetch.js';
import { ScrapeError, urlRefusal } from './scrapeError.js';
import { normalizeSiteUrl } from './siteUrl.js';

export interface BuildOptions {
  fetchImpl?: typeof fetch;
  /** Persist a downloaded asset; returns a reference string stored in the .brand (e.g. "asset:<hash>"). */
  saveAsset?: (buf: Buffer, kind: 'logo' | 'image') => Promise<string>;
  /** Tool stamp for meta.createdWith, e.g. "scenri/0.2.0". The caller knows its version; this package does not. */
  createdWith?: string;
  /**
   * Long edge of the image as it will be STORED, injected by the caller (this
   * package stays sharp-free). Lets the scrape refuse to crown a favicon: a
   * 32px icon saved as the primary mark is a logo the compiler will promise
   * to reproduce exactly from pixels that cannot say what it looks like.
   */
  inspectMark?: (buf: Buffer) => Promise<MarkShape | null>;
  /** Bounds and address rules for everything this fetches. */
  guard?: GuardOptions;
}

export type NameSource = 'json-ld' | 'og:site_name' | 'title' | 'hostname';

/**
 * What an image turns out to be once it has actually been decoded, which is
 * the only place some of this can be known. Measured across a dozen real
 * sites: linear.app's header mark is a white-on-dark SVG that rasterises to
 * nothing on a light background, and paulgraham.com's only image is a 69x399
 * nav strip. Both were being crowned.
 */
export interface MarkShape {
  longEdge: number | null;
  width: number | null;
  height: number | null;
  /** Effectively invisible: transparent, or a single near-white field. */
  blank: boolean;
}

/** Taller than this and it is a column of something, not a wordmark or a mark. */
const MAX_PORTRAIT_RATIO = 2.5;

/**
 * How much evidence a candidate needs before it is called the logo.
 *
 * Measured across twelve real sites: every correct pick scored 93 or more and
 * every wrong one 67 or less, with nothing in between. Below the floor a mark
 * is still saved - it is usually the best thing on the page - but as an
 * alternate, so the kit asks instead of asserting. A confidently wrong logo is
 * worse than an honest blank, and it is the first thing a new user sees.
 */
const CONFIDENT_SCORE = 80;

/** Sources that say "this is the site's own icon" rather than guessing from position. */
const ICON_SOURCES = new Set<LogoSource>(['json-ld', 'manifest', 'apple-touch-icon', 'link-icon']);

/**
 * What the scrape found, as facts rather than prose.
 *
 * The warnings are kept because the kit editor already shows them; this is the
 * same information in a shape the setup screen can render without parsing
 * sentences. Partial is the normal case: a logo and no colours is a success.
 */
export interface ScrapeReport {
  /** The URL actually read, after redirects. */
  url: string;
  host: string;
  name: { value: string; source: NameSource };
  tagline: string | null;
  logo: { status: 'primary' | 'alternate' | 'none'; source: LogoSource | null; score?: number; note?: string };
  colors: { count: number };
}

export interface BuildResult {
  brand: Record<string, unknown>;
  warnings: string[];
  report: ScrapeReport;
}

/** How many candidate marks are worth a download before settling for what we have. */
const LOGO_TRIES = 3;
/** Stylesheets are read for colour. A site with forty-eight of them still keeps its palette in one. */
const MAX_SHEETS = 6;
// `root` and `variables` earn their place: basecamp.com keeps every colour it
// has in root.css, ships forty-eight sheets, and came back with none.
const SHEET_RANK = /(root|variables|tokens|colou?rs|palette|theme|main|app|style|tailwind|global|site|brand|base)/i;
const SHEET_SKIP = /(font|icon|fontawesome|bootstrap-icons|swiper|slick|slider|lightbox|print)/i;

export async function buildFromUrl(url: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const warnings: string[] = [];
  // Normalised here as well as at the route, so no caller can reach an
  // unguarded parse. This line used to be `new URL(url)`, and the TypeError it
  // threw is what a tester read as their website being rejected.
  const normalized = normalizeSiteUrl(url);
  if (!normalized.ok) throw urlRefusal(normalized.reason, normalized.message);

  // An injected fetch is a test or a fixture serving invented hostnames, and
  // resolving those would only fail. It wins over the caller's guard on that
  // one point; production passes no fetch and gets the whole thing.
  const get: GuardedFetch = createGuardedFetch({
    ...opts.guard,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl, allowPrivateHosts: true } : {}),
  });

  const page = await get(normalized.url, 'html');
  const origin = new URL(page.finalUrl);
  const $ = cheerio.load(page.text);
  const base = baseOf($, origin);

  const named = pickName($, origin);
  const tagline =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim();

  // ---- colours
  const sources: { css: string; weightScale?: number }[] = [];
  const themeColor = $('meta[name="theme-color"]').attr('content')?.trim();
  const tileColor = $('meta[name="msapplication-TileColor"]').attr('content')?.trim();
  // A declared theme colour is the one colour the site states outright, so it
  // is fed in as a named brand variable rather than as one more fill.
  for (const [value, scale] of [
    [themeColor, 2],
    [tileColor, 1],
  ] as const) {
    if (value) sources.push({ css: `:root{--brand-theme:${value}}`, weightScale: scale });
  }
  sources.push({ css: inlineCss($) });
  for (const href of sheetHrefs($, base)) {
    if (get.remaining() <= 0) break;
    try {
      const sheet = await get(href, 'css');
      sources.push({ css: sheet.text });
    } catch {
      warnings.push('Stylesheet fetch failed; palette from inline styles only.');
    }
  }
  // The classes the document is wearing decide which of a page builder's
  // dozen shipped themes is the live one.
  const palette = paletteFrom(sources, liveClassTokens($));
  if (!palette.primary) warnings.push('No confident palette found. Set colors manually.');
  const colorCount = [palette.primary, palette.secondary, ...palette.accent, ...palette.neutrals].filter(
    Boolean,
  ).length;

  // ---- the mark
  const manifest = await readManifest($, base, get);
  const candidates = logoCandidates($, base, manifest);
  const picked = await downloadMark(candidates, get, opts, warnings);

  const brand: Record<string, unknown> = {
    specVersion: '0.1',
    meta: {
      name: named.value,
      slug:
        named.value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 48) || origin.hostname,
      ...(tagline ? { tagline } : {}),
      website: origin.origin,
      createdWith: opts.createdWith ?? 'scenri',
      updatedAt: new Date().toISOString(),
    },
    ...(palette.primary
      ? {
          palette: {
            primary: { hex: palette.primary },
            ...(palette.secondary ? { secondary: { hex: palette.secondary } } : {}),
            ...(palette.accent.length ? { accent: palette.accent.map((hex) => ({ hex })) } : {}),
            ...(palette.neutrals.length ? { neutrals: palette.neutrals.map((hex) => ({ hex })) } : {}),
          },
        }
      : {}),
    ...(picked.ref
      ? {
          logos: [
            {
              role: picked.role,
              file: picked.ref,
              ...(picked.background ? { background: picked.background } : {}),
            },
          ],
        }
      : {}),
  };

  return {
    brand,
    warnings,
    report: {
      url: page.finalUrl,
      host: origin.hostname,
      name: named,
      tagline: tagline ?? null,
      logo: {
        status: picked.ref ? picked.role : 'none',
        source: picked.source,
        ...(picked.score != null ? { score: picked.score } : {}),
        ...(picked.note ? { note: picked.note } : {}),
      },
      colors: { count: colorCount },
    },
  };
}

function baseOf($: cheerio.CheerioAPI, origin: URL): URL {
  const declared = $('base[href]').attr('href');
  if (!declared) return origin;
  try {
    return new URL(declared, origin);
  } catch {
    return origin;
  }
}

function pickName($: cheerio.CheerioAPI, origin: URL): { value: string; source: NameSource } {
  const ld = jsonLdName($);
  if (ld) return { value: ld, source: 'json-ld' };
  const og = $('meta[property="og:site_name"]').attr('content')?.trim();
  if (og) return { value: og, source: 'og:site_name' };
  const title = nameFromTitle($('title').first().text());
  if (title) return { value: title, source: 'title' };
  return { value: origin.hostname.replace(/^www\./, ''), source: 'hostname' };
}

/**
 * A page title is usually two things with a separator between them, and the
 * brand is the short half. "Page Title | Site Name" is the near-universal
 * convention, so taking the first segment named a tester's company after its
 * homepage headline: "One Solution for All Your Business Finances" rather than
 * "Lucid". The short, few-worded end wins; a title with no separator is taken
 * whole.
 */
export function nameFromTitle(raw: string): string {
  const parts = raw
    .trim()
    .split(/\s+[|\u00b7\u2022\u2013\u2014]\s+|\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  const first = parts[0];
  const last = parts[parts.length - 1];
  const words = (v: string) => v.split(/\s+/).length;
  // "Home", "Index" and friends name the page, never the company.
  if (/^(home|homepage|index|welcome|start|main)$/i.test(first)) return last;
  if (words(last) <= 4 && words(first) > words(last)) return last;
  return first;
}

function jsonLdName($: cheerio.CheerioAPI): string | null {
  for (const node of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(node).text()) as unknown;
      const found = findOrgName(data, 0);
      if (found) return found;
    } catch {
      // A malformed block is not a reason to stop reading the page.
    }
  }
  return null;
}

function findOrgName(node: unknown, depth: number): string | null {
  if (depth > 6 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findOrgName(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const type = String(obj['@type'] ?? '');
  if (/Organization|Corporation|LocalBusiness/i.test(type) && typeof obj.name === 'string' && obj.name.trim())
    return obj.name.trim();
  for (const value of Object.values(obj)) {
    const found = findOrgName(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Inline styles and embedded blocks, as one sheet. */
function inlineCss($: cheerio.CheerioAPI): string {
  const attrs = $('[style]')
    .map((_, el) => `x{${$(el).attr('style')}}`)
    .get()
    .join('\n');
  const blocks = $('style')
    .map((_, el) => $(el).text())
    .get()
    .join('\n');
  return `${attrs}\n${blocks}`;
}

function sheetHrefs($: cheerio.CheerioAPI, base: URL): string[] {
  const hrefs: string[] = [];
  for (const el of $('link[rel="stylesheet"]').toArray()) {
    const href = $(el).attr('href');
    if (!href || SHEET_SKIP.test(href)) continue;
    try {
      hrefs.push(new URL(href, base).toString());
    } catch {
      // A stylesheet we cannot address is one we cannot read.
    }
  }
  return hrefs.sort((a, b) => Number(SHEET_RANK.test(b)) - Number(SHEET_RANK.test(a))).slice(0, MAX_SHEETS);
}

async function readManifest(
  $: cheerio.CheerioAPI,
  base: URL,
  get: GuardedFetch,
): Promise<{ icons?: { src?: string; sizes?: string }[] } | undefined> {
  const href = $('link[rel="manifest"]').attr('href');
  if (!href || get.remaining() <= 0) return undefined;
  try {
    const res = await get(new URL(href, base).toString(), 'css');
    return JSON.parse(res.text) as { icons?: { src?: string; sizes?: string }[] };
  } catch {
    return undefined;
  }
}

interface PickedMark {
  ref?: string;
  role: 'primary' | 'alternate';
  source: LogoSource | null;
  score?: number;
  background?: 'light' | 'dark';
  note?: string;
}

/**
 * Walk the ranked candidates, best first, until one decodes into something a
 * mark can be made from. A small one is kept as the fallback rather than
 * crowned: "primary" is what the compiler promises to reproduce exactly as
 * drawn, and 32px of favicon cannot say what to reproduce.
 */
async function downloadMark(
  candidates: readonly LogoCandidate[],
  get: GuardedFetch,
  opts: BuildOptions,
  warnings: string[],
): Promise<PickedMark> {
  if (!opts.saveAsset || candidates.length === 0) {
    if (candidates.length === 0) warnings.push('No logo captured. Add one manually.');
    return { role: 'primary', source: null };
  }
  let fallback: PickedMark | null = null;
  let tried = 0;
  let failed = false;

  for (const candidate of candidates) {
    if (tried >= LOGO_TRIES || get.remaining() <= 0) break;
    let buf: Buffer | null = null;
    if (candidate.svg) {
      const sized = svgAsMark(candidate.svg);
      if (!sized) continue;
      buf = Buffer.from(sized, 'utf8');
    } else if (candidate.url?.startsWith('data:')) {
      const comma = candidate.url.indexOf(',');
      const body = candidate.url.slice(comma + 1);
      buf = candidate.url.slice(0, comma).includes(';base64')
        ? Buffer.from(body, 'base64')
        : Buffer.from(decodeURIComponent(body), 'utf8');
    } else if (candidate.url) {
      tried++;
      try {
        buf = (await get(candidate.url, 'asset')).bytes;
      } catch {
        failed = true;
        continue;
      }
    }
    if (!buf || buf.length === 0) continue;

    // Saving is the caller's normaliser, and it refuses bytes that are not an
    // image it can render. That is a candidate that did not work out, not a
    // failed scrape: try the next one.
    let ref: string;
    try {
      ref = await opts.saveAsset(buf, 'logo');
    } catch {
      failed = true;
      continue;
    }
    const shape = opts.inspectMark ? await opts.inspectMark(buf).catch(() => null) : null;
    // An invisible mark is worse than none: it looks like a broken image
    // everywhere it is used, and nobody can tell why. Try the next candidate.
    if (shape?.blank) continue;
    // A vector was sized on the way in, so the floor does not apply to it.
    const edge = candidate.svg ? null : (shape?.longEdge ?? null);
    const tiny = edge !== null && edge < 256;
    const tall =
      shape?.width != null &&
      shape?.height != null &&
      shape.width > 0 &&
      shape.height / shape.width > MAX_PORTRAIT_RATIO;
    // Size is evidence the score cannot see: a 1024px icon a site went to the
    // trouble of shipping is a logo, whatever the markup around it said. Not
    // for a vector, because that size is one we synthesised on the way in. And
    // a caller that supplies no way to measure has opted out of this judgement
    // rather than failed it, so it is not held against the candidate.
    // ...but only where the source already claims to BE the site's icon. A
    // header image is a positional guess, and allbirds.com's first one is a
    // 2000px product photo, so size there is evidence of nothing.
    const declaredIcon = ICON_SOURCES.has(candidate.source);
    const unmeasured = !candidate.svg && shape === null;
    const bigEnough = edge !== null ? declaredIcon && edge >= 512 : unmeasured;
    const unsure = candidate.score < CONFIDENT_SCORE && !bigEnough;
    const role: 'primary' | 'alternate' =
      candidate.role === 'alternate' || tiny || tall || unsure ? 'alternate' : 'primary';
    const picked: PickedMark = {
      ref,
      role,
      source: candidate.source,
      score: candidate.score,
      ...(candidate.background ? { background: candidate.background } : {}),
    };
    if (role === 'primary') return picked;
    if (tiny)
      picked.note = `The site icon is favicon-sized (${edge}px), so it was saved as an alternate mark, not the logo. Upload your real logo in Settings.`;
    else if (tall)
      picked.note =
        'The only image we could find is much taller than it is wide, so it was saved as an alternate mark rather than the logo. Upload your real logo in Settings.';
    else if (unsure)
      picked.note =
        'We are not confident this is your logo, so it was saved as an alternate mark. Check it, or upload your real logo in Settings.';
    else if (candidate.source === 'og-image')
      picked.note =
        'No site icon was found; the social share image was saved as an alternate mark. Check it before treating it as the logo.';
    fallback ??= picked;
  }

  if (fallback) {
    if (fallback.note) warnings.push(fallback.note);
    return fallback;
  }
  if (failed) warnings.push('Logo download failed.');
  warnings.push('No logo captured. Add one manually.');
  return { role: 'primary', source: null };
}

export { ScrapeError };
