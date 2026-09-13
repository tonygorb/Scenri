// SPDX-License-Identifier: Apache-2.0
/**
 * Finding the logo on a page, in the order the page itself says it.
 *
 * The rule this replaces looked at two `<link>` tags and an og:image. On the
 * site a tester actually pasted that meant the only candidate was a 16x16
 * favicon, which the size rule then demoted to an alternate - so the brand
 * ended up with no primary mark at all, on a page with a real logo in its nav.
 *
 * Scored rather than ordered, because the signals disagree: a nav `<img>` on
 * one site is the wordmark and on another it is a customer's logo in a wall of
 * them. Every clause is its own term so it can be argued with, and tested, one
 * at a time. Nothing here fetches; a caller decides how many candidates are
 * worth a download.
 */
import type { CheerioAPI } from 'cheerio';

export type LogoSource =
  | 'json-ld'
  | 'manifest'
  | 'apple-touch-icon'
  | 'header-img'
  | 'header-svg'
  | 'link-icon'
  | 'og-image';

export interface LogoCandidate {
  /** Absolute, or a data: URL. Null when `svg` carries the mark itself. */
  url: string | null;
  svg?: string;
  source: LogoSource;
  score: number;
  declaredEdge: number | null;
  /** The most this candidate is ever allowed to become. */
  role: 'primary' | 'alternate';
  background?: 'light' | 'dark';
  why: string[];
}

/**
 * Starting points, before evidence. `json-ld` sits above anything the DOM
 * heuristics can add up to (75 in the header, 20 for being first, 40 for being
 * called a logo, and the small terms after that): a site that states its own
 * logo in machine-readable form has settled the question, and no amount of
 * guessing should outvote it.
 */
const BASE: Record<LogoSource, number> = {
  'json-ld': 170,
  manifest: 85,
  'apple-touch-icon': 80,
  'header-img': 75,
  'header-svg': 60,
  'link-icon': 45,
  'og-image': 10,
};

/** The words a logo is called, in a file name, an alt, a class or an id. */
const LOGOISH = /(^|[^a-z])(logo|wordmark|brandmark|lockup|masthead)([^a-z]|$)/i;
/** Sections that are full of other people's logos. */
const NOT_OURS =
  /(client|customer|partner|sponsor|press|award|integrat|collab|affiliat|featured-in|trusted-by|logos?-(wall|grid|cloud|strip)|testimonial|marquee|as-seen)/i;
const SOCIAL = /(facebook|instagram|twitter|linkedin|youtube|tiktok|pinterest|threads|whatsapp|x-logo|social)/i;
/**
 * A region switcher, not a brand.
 *
 * allbirds.com opens with a country picker, and its first header image is the
 * flag of the United States. Nothing about a flag says logo, and handing one to
 * someone as their brand mark is the kind of wrong that is worse than empty.
 */
const FLAGGISH = /(\bflags?\b|locale|country|region|currency|\blang(uage)?\b)/i;
const TRACKER = /(pixel|1x1|spacer|blank|beacon|analytics|doubleclick|facebook\.com\/tr)/i;
const PHOTOISH = /(hero|banner|cover|photo|screenshot|slide|\bbg\b|background)/i;
const DARKISH = /(dark|inverse|inverted|white|light-on)/i;
const HEADER_SCOPE = 'header, nav, [role="banner"], .site-header, .navbar, .masthead, .topbar';
/** Past this many images, a page is body content and a logo is not hiding in it. */
const IMG_HORIZON = 40;

function absolute(href: string | undefined, base: URL): string | null {
  if (!href) return null;
  const raw = href.trim();
  if (raw === '') return null;
  if (raw.startsWith('data:'))
    return raw.length <= 262_144 && /^data:image\/(svg\+xml|png|jpeg|webp)/i.test(raw) ? raw : null;
  try {
    const u = new URL(raw, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The biggest source in a srcset, by width descriptor then by density. */
export function largestFromSrcset(srcset: string): string | null {
  const entries = srcset
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, descriptor = ''] = part.split(/\s+/);
      const w = /^(\d+)w$/.exec(descriptor);
      const x = /^([\d.]+)x$/.exec(descriptor);
      return { url, rank: w ? Number(w[1]) : x ? Number(x[1]) * 1000 : 1 };
    });
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b.rank - a.rank)[0].url;
}

function declaredEdgeOf(sizes: string | undefined, w?: string, h?: string): number | null {
  const fromSizes = sizes ? Math.max(...(sizes.match(/\d+/g) ?? ['0']).map(Number)) : 0;
  const fromAttrs = Math.max(Number(w ?? 0) || 0, Number(h ?? 0) || 0);
  const edge = Math.max(fromSizes, fromAttrs);
  return edge > 0 ? edge : null;
}

/**
 * A `sizes` attribute on a link, or a manifest entry, is a claim about the
 * FILE. An img's width and height are a claim about the layout: a wordmark 35
 * pixels tall in a nav is a normal wordmark, not a favicon, and penalising it
 * as one is how a real page's logo lost to a circular team photo. Only a
 * genuinely icon-shaped box says anything, and it says it quietly.
 */
function layoutTerm(w: string | undefined, h: string | undefined, why: string[]): number {
  const width = Number(w ?? 0) || 0;
  const height = Number(h ?? 0) || 0;
  if (width > 0 && height > 0 && width <= 32 && height <= 32) {
    why.push('icon-shaped');
    return -20;
  }
  return 0;
}

function sizeTerm(edge: number | null, why: string[]): number {
  if (edge === null) return 0;
  if (edge >= 512) {
    why.push('large');
    return 15;
  }
  if (edge >= 256) {
    why.push('big enough');
    return 8;
  }
  if (edge <= 64) {
    why.push('favicon-sized');
    return -25;
  }
  return 0;
}

export interface ManifestLike {
  icons?: { src?: string; sizes?: string; type?: string }[];
}

export function logoCandidates($: CheerioAPI, base: URL, manifest?: ManifestLike): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const host = base.hostname.replace(/^www\./, '').split('.')[0];

  const push = (c: Omit<LogoCandidate, 'score'> & { score: number }) => {
    if (c.score <= 0) return;
    if (c.url && out.some((o) => o.url === c.url)) return;
    out.push(c);
  };

  // 1. An explicit, machine-readable claim beats every guess on the page.
  for (const node of $('script[type="application/ld+json"]').toArray()) {
    for (const href of jsonLdLogos($(node).text())) {
      const url = absolute(href, base);
      if (url)
        push({
          url,
          source: 'json-ld',
          score: BASE['json-ld'],
          declaredEdge: null,
          role: 'primary',
          why: ['declared as the organisation logo'],
        });
    }
  }

  // 2. A manifest icon is sized on purpose.
  for (const icon of manifest?.icons ?? []) {
    const url = absolute(icon.src, base);
    const edge = declaredEdgeOf(icon.sizes);
    if (!url || (edge ?? 0) < 192) continue;
    const why = ['from the web app manifest'];
    push({
      url,
      source: 'manifest',
      score: BASE.manifest + sizeTerm(edge, why),
      declaredEdge: edge,
      role: 'primary',
      why,
    });
  }

  // 3. Touch icons are usually 180px or better, unlike a favicon.
  for (const el of $('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').toArray()) {
    const url = absolute($(el).attr('href'), base);
    const edge = declaredEdgeOf($(el).attr('sizes'));
    const why = ['a touch icon'];
    if (url)
      push({
        url,
        source: 'apple-touch-icon',
        score: BASE['apple-touch-icon'] + sizeTerm(edge, why),
        declaredEdge: edge,
        role: 'primary',
        why,
      });
  }

  // 4. The mark a person actually sees at the top of the page.
  const imgs = $('img').toArray();
  imgs.forEach((el, index) => {
    const node = $(el);
    const inHeader = node.closest(HEADER_SCOPE).length > 0;
    if (!inHeader && index > IMG_HORIZON) return;
    const src =
      node.attr('src') ??
      node.attr('data-src') ??
      node.attr('data-lazy-src') ??
      largestFromSrcset(node.attr('srcset') ?? node.attr('data-srcset') ?? '') ??
      undefined;
    const url = absolute(src, base);
    if (!url) return;
    const text = [url, node.attr('alt') ?? '', node.attr('class') ?? '', node.attr('id') ?? ''].join(' ');
    const ancestry = node
      .parents()
      .slice(0, 6)
      .map((_i, p) => `${$(p).attr('class') ?? ''} ${$(p).attr('id') ?? ''}`)
      .get()
      .join(' ');
    const why: string[] = [];
    let score = inHeader ? BASE['header-img'] : BASE['header-img'] - 20;
    if (inHeader) why.push('in the header');
    // The mark is the first thing in the bar, and everything after it is
    // content. A page whose whole body sits inside <header class="header-29">
    // makes "in the header" say nothing on its own; document order still does.
    if (index <= 2) {
      why.push('first image on the page');
      score += 20;
    } else if (index <= 6) {
      score += 6;
    }
    score += layoutTerm(node.attr('width'), node.attr('height'), why);
    score += semanticTerms(text, ancestry, host, why);
    if (node.parent().children('img').length >= 3) {
      why.push('one of a row of logos');
      score -= 50;
    }
    push({
      url,
      source: 'header-img',
      score,
      declaredEdge: null,
      role: 'primary',
      ...(DARKISH.test(text) ? { background: 'dark' as const } : {}),
      why,
    });
  });

  // 5. An inline mark, which is how a modern header draws one.
  for (const el of $(`${HEADER_SCOPE}`).find('svg').toArray().slice(0, 4)) {
    const node = $(el);
    const text = [node.attr('class') ?? '', node.attr('id') ?? '', node.attr('aria-label') ?? ''].join(' ');
    const why = ['drawn in the header'];
    const score = BASE['header-svg'] + semanticTerms(text, '', host, why);
    const markup = $.html(el);
    if (markup) push({ url: null, svg: markup, source: 'header-svg', score, declaredEdge: null, role: 'primary', why });
  }

  // 6. The favicon, which is better than nothing and rarely better than that.
  for (const el of $('link[rel~="icon"]').toArray()) {
    const url = absolute($(el).attr('href'), base);
    const edge = declaredEdgeOf($(el).attr('sizes'));
    const why = ['the site icon'];
    if (url)
      push({
        url,
        source: 'link-icon',
        score: BASE['link-icon'] + sizeTerm(edge, why),
        declaredEdge: edge,
        role: 'primary',
        why,
      });
  }

  // 7. A social card is a picture of the brand, not the brand's mark.
  const og = absolute($('meta[property="og:image"]').attr('content'), base);
  if (og)
    push({
      url: og,
      source: 'og-image',
      score: BASE['og-image'],
      declaredEdge: null,
      role: 'alternate',
      why: ['the social share image'],
    });

  return out.sort((a, b) => b.score - a.score);
}

/** Everything after the host, so a CDN's own name never counts as the brand's. */
function pathOf(text: string): string {
  return text.replace(/https?:\/\/[^/\s]+/gi, '');
}

function semanticTerms(text: string, ancestry: string, host: string, why: string[]): number {
  let score = 0;
  // The strongest DOM signal there is, and it used to be worth less than
  // sitting inside something called a header. A real page named its wordmark
  // nav-02__logo_img and lost to a circular team photo two elements later.
  if (LOGOISH.test(text)) {
    why.push('called a logo');
    score += 40;
  }
  // The PATH, never the host: a site served from lucidreams.b-cdn.net was
  // handing this bonus to every asset it owns, logo or not.
  if (host.length >= 3 && pathOf(text).toLowerCase().includes(host.toLowerCase())) {
    why.push('named after the site');
    score += 6;
  }
  if (/\.svg(\?|$)/i.test(text)) score += 8;
  if (/\.ico(\?|$)/i.test(text)) score -= 15;
  if (/\.jpe?g(\?|$)/i.test(text)) score -= 10;
  if (NOT_OURS.test(ancestry) || NOT_OURS.test(text)) {
    why.push('inside a section of other companies');
    score -= 40;
  }
  if (SOCIAL.test(text)) {
    why.push('a social icon');
    score -= 60;
  }
  if (FLAGGISH.test(text)) {
    why.push('a flag or a region switcher');
    score -= 60;
  }
  if (TRACKER.test(text)) {
    why.push('a tracking pixel');
    score -= 80;
  }
  if (PHOTOISH.test(text)) {
    why.push('photography');
    score -= 30;
  }
  if (DARKISH.test(text)) score -= 15;
  return score;
}

/** Organization.logo, wherever it is nested. */
function jsonLdLogos(text: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const found: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const logo = obj.logo;
    if (typeof logo === 'string') found.push(logo);
    else if (logo && typeof logo === 'object') {
      const url = (logo as Record<string, unknown>).url;
      if (typeof url === 'string') found.push(url);
    }
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };
  walk(data, 0);
  return found;
}

/**
 * An inline `<svg>` lifted out of a nav is not ready to be a mark.
 *
 * toMarkPng rasterises at a fixed density, and that density scales from
 * viewBox units - so a `viewBox="0 0 24 24"` icon comes out about 96px, falls
 * under the size floor, and gets demoted to an alternate exactly as a favicon
 * does. The logo would be found and then quietly thrown away. Sizing it here
 * is what stops that.
 */
export function svgAsMark(markup: string, longEdge = 1024): string | null {
  if (/<script|<foreignObject|(?:xlink:)?href\s*=\s*["']https?:/i.test(markup)) return null;
  const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(markup);
  const width = /\bwidth\s*=\s*["']([\d.]+)/i.exec(markup);
  const height = /\bheight\s*=\s*["']([\d.]+)/i.exec(markup);
  const w = viewBox ? Number(viewBox[1]) : Number(width?.[1] ?? 0);
  const h = viewBox ? Number(viewBox[2]) : Number(height?.[1] ?? 0);
  if (!(w > 0 && h > 0)) return null;
  const scale = longEdge / Math.max(w, h);
  let out = markup
    .replace(/\s\bwidth\s*=\s*["'][^"']*["']/i, '')
    .replace(/\s\bheight\s*=\s*["'][^"']*["']/i, '')
    .replace(/<svg\b/i, `<svg width="${Math.round(w * scale)}" height="${Math.round(h * scale)}"`);
  // The HTML parser implies the namespace away, and librsvg refuses without it.
  if (!/xmlns\s*=/.test(out)) out = out.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return out;
}
