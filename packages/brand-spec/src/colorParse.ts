// SPDX-License-Identifier: Apache-2.0
/**
 * Colour written the way stylesheets actually write it.
 *
 * The rule this replaces read six-digit hex and nothing else, which was fine
 * in 2015. A site built on Tailwind v4 declares its whole palette in
 * `oklch()`, so the old regex found no colours at all and the kit came back
 * blank - not a bad palette, none. Hence the one piece of real arithmetic in
 * this package.
 */

const CLAMP = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
const hex2 = (n: number) => CLAMP(n).toString(16).padStart(2, '0');
const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** Below this the colour is mostly whatever is behind it, so it says nothing about a brand. */
const MIN_ALPHA = 0.35;

const NUM = String.raw`[-+]?[\d.]+%?`;
const RGB_RE = new RegExp(String.raw`^rgba?\(\s*(${NUM})[\s,]+(${NUM})[\s,]+(${NUM})(?:[\s,/]+(${NUM}))?\s*\)$`, 'i');
const HSL_RE = new RegExp(
  String.raw`^hsla?\(\s*(${NUM}|[-+]?[\d.]+deg)[\s,]+(${NUM})[\s,]+(${NUM})(?:[\s,/]+(${NUM}))?\s*\)$`,
  'i',
);
const OKLCH_RE = new RegExp(
  String.raw`^oklch\(\s*(${NUM})[\s,]+(${NUM})[\s,]+([-+]?[\d.]+)(?:deg)?(?:[\s,/]+(${NUM}))?\s*\)$`,
  'i',
);

function scalar(token: string, full: number): number {
  const t = token.trim();
  if (t.endsWith('%')) return (Number.parseFloat(t) / 100) * full;
  return Number.parseFloat(t);
}

function alphaOk(token: string | undefined): boolean {
  if (token == null) return true;
  const a = token.trim().endsWith('%') ? Number.parseFloat(token) / 100 : Number.parseFloat(token);
  return !Number.isNaN(a) && a >= MIN_ALPHA;
}

/** One colour token to a six-digit hex, or null when it is not one (or too transparent to mean anything). */
export function toHex(value: string): string | null {
  const v = value.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    const d = hex[1];
    if (d.length === 3 || d.length === 4) {
      if (d.length === 4 && !alphaOk(String(Number.parseInt(d[3] + d[3], 16) / 255))) return null;
      return `#${d[0]}${d[0]}${d[1]}${d[1]}${d[2]}${d[2]}`;
    }
    if (d.length === 6) return `#${d}`;
    if (d.length === 8) {
      if (!alphaOk(String(Number.parseInt(d.slice(6, 8), 16) / 255))) return null;
      return `#${d.slice(0, 6)}`;
    }
    return null;
  }

  const rgb = RGB_RE.exec(v);
  if (rgb) {
    if (!alphaOk(rgb[4])) return null;
    return rgbHex(scalar(rgb[1], 255), scalar(rgb[2], 255), scalar(rgb[3], 255));
  }

  const hsl = HSL_RE.exec(v);
  if (hsl) {
    if (!alphaOk(hsl[4])) return null;
    return hslHex(Number.parseFloat(hsl[1]), scalar(hsl[2], 1), scalar(hsl[3], 1));
  }

  const oklch = OKLCH_RE.exec(v);
  if (oklch) {
    if (!alphaOk(oklch[4])) return null;
    return oklchHex(scalar(oklch[1], 1), Number.parseFloat(oklch[2]), Number.parseFloat(oklch[3]));
  }
  return null;
}

function hslHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return rgbHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** oklch -> oklab -> linear sRGB -> sRGB, the published matrices. */
function oklchHex(L: number, C: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const gamma = (u: number) => (u <= 0.0031308 ? 12.92 * u : 1.055 * Math.abs(u) ** (1 / 2.4) - 0.055);
  return rgbHex(gamma(lr) * 255, gamma(lg) * 255, gamma(lb) * 255);
}

/** Every colour token in a blob of CSS, with the declaration it came from. */
const DECL_RE =
  /(--[\w-]+|[\w-]+)\s*:\s*([^;{}]*?(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\))[^;{}]*)/g;
const TOKEN_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/g;

export interface CssColor {
  hex: string;
  /** The property it was declared on, so a --brand-primary can outrank a border. */
  property: string;
  /** Roughly what it was declared inside, for the same reason. */
  context: string;
}

export function extractColors(css: string): CssColor[] {
  const out: CssColor[] = [];
  // Selector text for the declaration that follows it, so a .btn colour can be
  // weighted above one inside .footer-note.
  const blocks = css.split('}');
  for (const block of blocks) {
    const brace = block.lastIndexOf('{');
    const context = brace >= 0 ? block.slice(Math.max(0, brace - 200), brace) : '';
    const body = brace >= 0 ? block.slice(brace + 1) : block;
    DECL_RE.lastIndex = 0;
    let decl: RegExpExecArray | null = DECL_RE.exec(body);
    while (decl !== null) {
      const property = decl[1];
      TOKEN_RE.lastIndex = 0;
      let token: RegExpExecArray | null = TOKEN_RE.exec(decl[2]);
      while (token !== null) {
        const hex = toHex(token[0]);
        if (hex) out.push({ hex: hex.toLowerCase(), property, context });
        token = TOKEN_RE.exec(decl[2]);
      }
      decl = DECL_RE.exec(body);
    }
  }
  return out;
}
