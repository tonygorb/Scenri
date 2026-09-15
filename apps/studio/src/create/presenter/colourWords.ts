/**
 * The word for a colour, for a colour nobody tapped.
 *
 * A hex means nothing to a model and nothing to a reader, so a colour picked
 * from the wheel has to be said in words: the chip reads it back, and the
 * sentence the engine is given carries it. Twelve plain colours were not
 * enough for that, because half the wheel collapsed into "red" or "purple"
 * and a deep warm brown came back as "dyed red", which is neither what was
 * picked nor a thing a person would say.
 *
 * So the name is computed rather than snapped: hue picks the family, and
 * lightness and saturation qualify it the way people do, with the handful of
 * well-worn compounds that a hue band alone would miss (a dark orange is a
 * brown, a dark yellow is an olive, a pale orange is a beige).
 *
 * Deliberately words a person would use about hair, skin and clothes, not the
 * CSS colour list: "chestnut", not "sienna"; "sky blue", not "cornflower".
 */

/** Hue to family, in degrees, each band ending where the next begins. */
const HUES: { to: number; name: string }[] = [
  { to: 8, name: 'red' },
  { to: 16, name: 'scarlet' },
  { to: 30, name: 'orange' },
  { to: 36, name: 'amber' },
  { to: 46, name: 'gold' },
  { to: 64, name: 'yellow' },
  { to: 80, name: 'lime' },
  { to: 95, name: 'yellow-green' },
  { to: 158, name: 'green' },
  { to: 172, name: 'sea green' },
  { to: 183, name: 'teal' },
  { to: 196, name: 'cyan' },
  { to: 205, name: 'sky blue' },
  { to: 215, name: 'azure' },
  { to: 240, name: 'blue' },
  { to: 252, name: 'indigo' },
  { to: 268, name: 'violet' },
  { to: 285, name: 'purple' },
  { to: 300, name: 'orchid' },
  { to: 318, name: 'magenta' },
  { to: 330, name: 'fuchsia' },
  { to: 342, name: 'pink' },
  { to: 352, name: 'rose' },
  { to: 360, name: 'red' },
];

/** Grey by lightness: the whole of it, since a grey has no hue to name. */
const GREYS: { to: number; name: string }[] = [
  { to: 0.05, name: 'black' },
  { to: 0.16, name: 'charcoal' },
  { to: 0.32, name: 'dark grey' },
  { to: 0.62, name: 'grey' },
  { to: 0.76, name: 'light grey' },
  { to: 0.88, name: 'silver' },
  { to: 0.96, name: 'off-white' },
  { to: 1.01, name: 'white' },
];

export interface ColourWords {
  /** The whole name, as the chip and the sentence read it: "deep teal". */
  name: string;
  /** The family the name came from, before any qualifier: "teal". */
  family: string;
  h: number;
  s: number;
  l: number;
}

/** The families hair grows in. Anything else on a head was dyed there. */
const NATURAL_HAIR = new Set([
  'black',
  'charcoal',
  'dark grey',
  'grey',
  'light grey',
  'silver',
  'off-white',
  'white',
  'dark brown',
  'brown',
  'chestnut',
  'auburn',
  'copper',
  'tan',
  'beige',
  'cream',
  'amber',
  'gold',
  'blonde',
]);

const hexToRgb = (hex: string): [number, number, number] => {
  const v = String(hex ?? '')
    .replace('#', '')
    .trim();
  const parts = v.length === 3 ? v.split('').map((c) => c + c) : [v.slice(0, 2), v.slice(2, 4), v.slice(4, 6)];
  return parts.map((p) => {
    const n = Number.parseInt(p, 16);
    return Number.isFinite(n) ? n : 0;
  }) as [number, number, number];
};

/** Hue in degrees, saturation and lightness in 0 to 1. */
export function hsl(hex: string): { h: number; s: number; l: number } {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

/** The family a hue belongs to. */
const familyOf = (h: number): string => HUES.find((band) => h < band.to)?.name ?? 'red';

/**
 * The compounds a hue band cannot say on its own.
 *
 * A dark orange is not a dark orange to anyone: it is a brown. These are the
 * places where the everyday word replaces the family outright, and they are
 * exactly the ones that matter for hair and skin.
 */
function compound(family: string, s: number, l: number): string | null {
  const warm = family === 'orange' || family === 'amber' || family === 'scarlet';
  if (warm) {
    if (l < 0.2) return 'dark brown';
    if (l < 0.32) return family === 'scarlet' ? 'chestnut' : 'brown';
    if (l >= 0.86 && s < 0.6) return 'cream';
    if (l >= 0.72 && s < 0.6) return 'beige';
    if (l < 0.44 && s < 0.7) return 'brown';
    if (l < 0.62 && s < 0.55) return 'tan';
    return null;
  }
  if ((family === 'gold' || family === 'yellow') && l < 0.42) return 'olive';
  if ((family === 'indigo' || family === 'violet' || family === 'purple') && l >= 0.72 && s < 0.7) return 'lavender';
  if ((family === 'blue' || family === 'azure' || family === 'indigo') && l < 0.22) return 'navy';
  if (family === 'red' && l < 0.34) return s < 0.55 ? 'burgundy' : 'maroon';
  if (family === 'rose' && l < 0.34) return 'burgundy';
  return null;
}

/** How light or dark a colour reads, said the way a person says it. */
function shade(l: number): string {
  if (l < 0.18) return 'deep';
  if (l < 0.34) return 'dark';
  if (l >= 0.88) return 'pale';
  if (l >= 0.74) return 'light';
  return '';
}

/**
 * The words for a colour: its family, qualified by how light and how strong it
 * is. One qualifier at most, because "deep muted greyish teal" is not a name.
 */
export function colourWords(hex: string): ColourWords {
  const { h, s, l } = hsl(hex);
  // No hue worth naming: the whole of it is a grey, and grey is said by lightness.
  if (s < 0.09) {
    const name = GREYS.find((g) => l < g.to)?.name ?? 'grey';
    return { name, family: name, h, s, l };
  }
  const family = familyOf(h);
  const said = compound(family, s, l);
  if (said) {
    // a compound already carries its own darkness; only the far ends qualify it
    const far = l < 0.12 ? 'deep' : l >= 0.93 ? 'pale' : '';
    return { name: far ? `${far} ${said}` : said, family: said, h, s, l };
  }
  const dim = shade(l);
  if (dim) return { name: `${dim} ${family}`, family, h, s, l };
  if (s < 0.22) return { name: `muted ${family}`, family, h, s, l };
  if (s > 0.85 && l > 0.4 && l < 0.65) return { name: `vivid ${family}`, family, h, s, l };
  return { name: family, family, h, s, l };
}

/** Does hair grow in this colour, or was it put there? */
export function grownHair(hex: string): boolean {
  const { family, h, s, l } = colourWords(hex);
  if (NATURAL_HAIR.has(family)) return true;
  // a very pale warm colour is blonde however the wheel got there
  return (h >= 16 && h <= 60 && l >= 0.7 && s < 0.7) || s < 0.09;
}
