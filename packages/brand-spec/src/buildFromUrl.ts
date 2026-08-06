import * as cheerio from 'cheerio';

export interface BuildOptions {
  fetchImpl?: typeof fetch;
  /** Persist a downloaded asset; returns a reference string stored in the .brand (e.g. "asset:<hash>"). */
  saveAsset?: (buf: Buffer, kind: 'logo' | 'image') => Promise<string>;
}

export interface BuildResult {
  brand: Record<string, unknown>;
  warnings: string[];
}

const HEX_RE = /#[0-9a-fA-F]{6}\b/g;
const FETCH_TIMEOUT_MS = 15_000;

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
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

function pickPalette(colors: string[]): { primary?: string; secondary?: string; accent: string[]; neutrals: string[] } {
  const counts = new Map<string, number>();
  for (const c of colors) counts.set(c.toLowerCase(), (counts.get(c.toLowerCase()) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
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

export async function buildFromUrl(url: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const origin = new URL(url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'scenri/0.1 (+https://scenri.dev)' },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Timed out fetching ${url}`);
    }
    throw new Error(`Could not reach that site: ${url}`);
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) throw new Error(`Could not fetch ${url}: HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const name =
    $('meta[property="og:site_name"]').attr('content')?.trim() ||
    $('title')
      .first()
      .text()
      .trim()
      .split(/\s+[|–—-]\s+/)[0] ||
    origin.hostname.replace(/^www\./, '');
  const tagline =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim();

  // colors: theme-color first (weighted), then inline styles + <style> blocks
  const colorSources: string[] = [];
  const themeColor = $('meta[name="theme-color"]').attr('content');
  if (themeColor && /^#[0-9a-fA-F]{6}$/.test(themeColor.trim())) {
    for (let i = 0; i < 5; i++) colorSources.push(themeColor.trim());
  }
  const styleText =
    $('[style]')
      .map((_, el) => $(el).attr('style'))
      .get()
      .join('\n') +
    '\n' +
    $('style')
      .map((_, el) => $(el).text())
      .get()
      .join('\n');
  colorSources.push(...(styleText.match(HEX_RE) ?? []));

  // first same-site stylesheet, best-effort
  const cssHref = $('link[rel="stylesheet"]').first().attr('href');
  if (cssHref) {
    try {
      const cssUrl = new URL(cssHref, origin).toString();
      const cssRes = await fetchImpl(cssUrl, { redirect: 'follow' });
      if (cssRes.ok) colorSources.push(...((await cssRes.text()).match(HEX_RE) ?? []));
    } catch {
      warnings.push('Stylesheet fetch failed; palette from inline styles only.');
    }
  }
  const palette = pickPalette(colorSources);
  if (!palette.primary) warnings.push('No confident palette found — set colors manually.');

  // logo: largest icon, else og:image
  let logoRef: string | undefined;
  const iconHref =
    $('link[rel="apple-touch-icon"]').attr('href') ||
    $('link[rel~="icon"]').attr('href') ||
    $('meta[property="og:image"]').attr('content');
  if (iconHref && opts.saveAsset) {
    try {
      const iconRes = await fetchImpl(new URL(iconHref, origin).toString(), { redirect: 'follow' });
      if (iconRes.ok) {
        const buf = Buffer.from(await iconRes.arrayBuffer());
        if (buf.length > 0) logoRef = await opts.saveAsset(buf, 'logo');
      }
    } catch {
      warnings.push('Logo download failed.');
    }
  }
  if (!logoRef) warnings.push('No logo captured — add one manually.');

  const brand: Record<string, unknown> = {
    specVersion: '0.1',
    meta: {
      name,
      slug:
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 48) || origin.hostname,
      ...(tagline ? { tagline } : {}),
      website: origin.origin,
      createdWith: 'scenri/0.1.0',
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
    ...(logoRef ? { logos: [{ role: 'primary', file: logoRef }] } : {}),
  };
  return { brand, warnings };
}
