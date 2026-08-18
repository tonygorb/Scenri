/**
 * The brand palette, flattened for editing and rebuilt for saving.
 *
 * Kept free of React/DOM so test/palette.test.ts can cover the actual logic
 * without a component harness — the same reason libraryRules.ts is a plain
 * module. Four surfaces read a palette (the Brand page, the composer's colour
 * chips, the attach panel, the setup wizard's preview) and each used to carry
 * its own copy of this flattening.
 *
 * `slot` is why this module exists rather than being four more copies. The old
 * read path flattened primary + secondary + accent[] + neutrals[] into one
 * positional list, and the write path rebuilt it as primary, secondary and
 * "everything else is an accent" — so every single palette edit silently moved
 * a brand's neutrals into its accents. Carrying the slot through means a
 * rebuild puts each colour back where it came from.
 */

export type PaletteSlot = 'primary' | 'secondary' | 'accent' | 'neutral';

export interface Swatch {
  hex: string;
  name: string;
  slot: PaletteSlot;
}

/**
 * Placeholder names for swatches a brand never named.
 *
 * By slot, not by position. The old positional list called the first neutral
 * "Accent 2" whenever a brand had one accent, which is exactly the confusion
 * that let neutrals get saved as accents in the first place.
 */
const SLOT_NAME: Record<PaletteSlot, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
  neutral: 'Neutral',
};

/** The first six placeholder names, in reading order — for tests and copy. */
export const ROLE_NAMES = ['Primary', 'Secondary', 'Accent', 'Accent 2', 'Neutral', 'Neutral 2'];

const placeholderName = (slot: PaletteSlot, ordinal: number): string =>
  ordinal <= 1 ? SLOT_NAME[slot] : `${SLOT_NAME[slot]} ${ordinal}`;

/**
 * Is this name one we generated?
 *
 * Placeholders exist so an unnamed swatch reads as something; persisting them
 * would turn a UI affordance into brand data, and then renaming a slot would
 * leave a stale "Accent 2" in the document forever.
 */
export function isPlaceholderName(name: string): boolean {
  return /^(Primary|Secondary|Accent|Neutral)( [2-9]\d*)?$/.test(String(name ?? '').trim());
}

const HEX = /^#[0-9A-F]{6}$/;

/**
 * `#RRGGBB` uppercase, or null when the input is not one.
 *
 * The schema's pattern is exactly six hex digits, and it rejects the whole
 * document on a miss — so one malformed swatch would stop every other section
 * of the Brand page from saving. This is the gate that keeps that impossible.
 * Shorthand is expanded because a person typing a colour by hand writes `#fff`;
 * 8-digit is rejected because alpha is not something a brand colour has.
 */
export function normalizeHex(input: string): string | null {
  const raw = String(input ?? '').trim();
  const body = (raw.startsWith('#') ? raw.slice(1) : raw).toUpperCase();
  if (/^[0-9A-F]{3}$/.test(body)) {
    const [r, g, b] = body;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const out = `#${body}`;
  return HEX.test(out) ? out : null;
}

const HEX_WORD = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

/**
 * A typed colour word: `#RGB` or `#RRGGBB`, or null.
 *
 * Stricter than `normalizeHex`, which also accepts a bare six-digit run.
 * The composer only chips a hash-prefixed word so `ffffff` and `cap#F5C518`
 * stay prose.
 */
export function hexWord(input: string): string | null {
  const raw = String(input ?? '').trim();
  return HEX_WORD.test(raw) ? normalizeHex(raw) : null;
}

/** Every colour in the kit, in the order a person reads them. */
export function flattenPalette(palette: any): Swatch[] {
  const out: Swatch[] = [];
  const seen: Record<PaletteSlot, number> = { primary: 0, secondary: 0, accent: 0, neutral: 0 };
  const push = (c: any, slot: PaletteSlot) => {
    const hex = normalizeHex(String(c?.hex ?? ''));
    if (!hex) return;
    seen[slot] += 1;
    const name = String(c?.name ?? '').trim();
    out.push({ hex, name: name || placeholderName(slot, seen[slot]), slot });
  };
  push(palette?.primary, 'primary');
  push(palette?.secondary, 'secondary');
  for (const c of Array.isArray(palette?.accent) ? palette.accent : []) push(c, 'accent');
  for (const c of Array.isArray(palette?.neutrals) ? palette.neutrals : []) push(c, 'neutral');
  return out;
}

/**
 * Rebuild the stored shape from an edited list.
 *
 * Slots are derived from position, not asked for. Only two distinctions in this
 * document change anything: a neutral is never sent to a model, and the primary
 * is the brand's avatar colour when it has no logo. Primary-vs-secondary-vs-
 * accent decides the order of names inside a single comma-separated sentence,
 * which is not a decision worth a control — so the first colour in the list is
 * the primary, the second the secondary, and the rest are accents.
 *
 * `prev` carries through the one palette field this editor does not own
 * (`usage`), so editing a colour cannot delete prose written elsewhere.
 */
export function rebuildPalette(swatches: Swatch[], prev?: any): any {
  const out: any = {};
  const inShots: { hex: string; name?: string }[] = [];
  const neutrals: { hex: string; name?: string }[] = [];
  const asColor = (s: Swatch) => {
    const name = s.name.trim();
    return name && !isPlaceholderName(name) ? { hex: s.hex, name } : { hex: s.hex };
  };
  for (const s of swatches) {
    const hex = normalizeHex(s.hex);
    if (!hex) continue;
    const c = asColor({ ...s, hex });
    if (s.slot === 'neutral') neutrals.push(c);
    else inShots.push(c);
  }
  const [primary, secondary, ...accent] = inShots;
  if (primary) out.primary = primary;
  if (secondary) out.secondary = secondary;
  if (accent.length) out.accent = accent;
  if (neutrals.length) out.neutrals = neutrals;
  const usage = String(prev?.usage ?? '').trim();
  if (usage) out.usage = usage;
  return out;
}

/**
 * Is this colour part of the palette instruction, or merely recorded in the kit?
 *
 * The one distinction a person is asked about. Everything else — which colour is
 * "primary", and so which tints the avatar when a brand has no logo — falls out
 * of list position, because that is all it was ever worth.
 */
export const isInShots = (s: Swatch): boolean => s.slot !== 'neutral';

/**
 * A starting colour for a new row that is not the one above it.
 *
 * A palette of identical greys was an earlier failure mode; rotating the
 * channels means consecutive adds are told apart at a glance, and a brand with
 * nothing yet starts on a neutral rather than on someone's idea of a nice blue.
 */
export function nextHex(colors: Swatch[]): string {
  const last = colors[colors.length - 1]?.hex;
  if (!last) return '#808080';
  const n = Number.parseInt(last.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return `#${[b, r, g]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

export interface AppendedColor {
  palette: any;
  added: boolean;
  swatch: Swatch | null;
}

/**
 * Add one colour to a stored palette, or report that it is already there.
 *
 * The Create rail and the Brand page both write the same document. This is the
 * one place that decides slot (first colour is primary, later ones are accents),
 * skips a duplicate, and rebuilds so neutrals and `usage` survive. A malformed
 * hex is a no-op: the schema rejects the whole document on a miss.
 */
export function appendColor(palette: any, hex: string): AppendedColor {
  const normalized = normalizeHex(hex);
  if (!normalized) return { palette, added: false, swatch: null };
  const current = flattenPalette(palette);
  const existing = current.find((c) => c.hex === normalized);
  if (existing) return { palette, added: false, swatch: existing };
  const next: Swatch[] = [...current, { hex: normalized, name: '', slot: current.length ? 'accent' : 'primary' }];
  const rebuilt = rebuildPalette(next, palette);
  const swatch = flattenPalette(rebuilt).find((c) => c.hex === normalized) ?? null;
  return { palette: rebuilt, added: true, swatch };
}

export interface RemovedColor {
  palette: any;
  removed: boolean;
}

/**
 * Take one colour out of a stored palette.
 *
 * Same writer as `appendColor`: rebuild so the remaining in-shot colours
 * re-derive primary/secondary/accent, and neutrals and `usage` survive. A
 * miss or a malformed hex is a no-op.
 */
export function removeColor(palette: any, hex: string): RemovedColor {
  const normalized = normalizeHex(hex);
  if (!normalized) return { palette, removed: false };
  const current = flattenPalette(palette);
  const next = current.filter((c) => c.hex !== normalized);
  if (next.length === current.length) return { palette, removed: false };
  return { palette: rebuildPalette(next, palette), removed: true };
}
