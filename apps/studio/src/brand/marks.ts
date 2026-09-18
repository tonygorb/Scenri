/**
 * The brand's marks (logos), as the UI needs them.
 *
 * Pure, for the same reason palette.ts is: the rules about which mark can reach
 * a model are worth testing directly rather than through a component.
 *
 * A mark is attachable only when it is an `asset:` ref this app stored. A brand
 * scraped before uploads existed, or hand-authored against the bare `.brand`
 * form, can hold an `https://` logo — perfectly valid in the format, and
 * perfectly unusable as a reference image, because the compiler resolves
 * attachments through the content-addressed store and nothing else.
 */

export type MarkRole = 'primary' | 'mark' | 'wordmark' | 'monochrome' | 'alternate';
export type MarkBackground = 'light' | 'dark' | 'any';

export interface Mark {
  /** Content hash, and the mark's identity: `logos[]` entries have no id. */
  hash: string | null;
  /** The raw ref as stored, so a non-asset logo can still be shown and removed. */
  file: string;
  role: MarkRole;
  background: MarkBackground;
  clearSpace?: string;
  /** False for an http/relative ref: displayable, but it cannot reach a model. */
  attachable: boolean;
}

export const MARK_ROLES: MarkRole[] = ['primary', 'mark', 'wordmark', 'monochrome', 'alternate'];
export const MARK_BACKGROUNDS: MarkBackground[] = ['light', 'dark', 'any'];

export const MARK_ROLE_LABEL: Record<MarkRole, string> = {
  primary: 'Primary logo',
  mark: 'Mark',
  wordmark: 'Wordmark',
  monochrome: 'Monochrome',
  alternate: 'Alternate',
};

const HASH = /^[a-f0-9]{32}$/;

const assetHash = (ref: unknown): string | null => {
  const s = String(ref ?? '');
  if (!s.startsWith('asset:')) return null;
  const h = s.slice(6);
  return HASH.test(h) ? h : null;
};

const asRole = (v: unknown): MarkRole => (MARK_ROLES.includes(v as MarkRole) ? (v as MarkRole) : 'primary');
const asBackground = (v: unknown): MarkBackground =>
  MARK_BACKGROUNDS.includes(v as MarkBackground) ? (v as MarkBackground) : 'any';

/** Every mark in the kit, in stored order. */
export function marksOf(json: any): Mark[] {
  const logos = Array.isArray(json?.logos) ? json.logos : [];
  return logos
    .filter((l: any) => l && String(l.file ?? '').trim())
    .map((l: any) => {
      const hash = assetHash(l.file);
      const clearSpace = String(l.clearSpace ?? '').trim();
      return {
        hash,
        file: String(l.file),
        role: asRole(l.role),
        background: asBackground(l.background),
        ...(clearSpace ? { clearSpace } : {}),
        attachable: hash !== null,
      };
    });
}

/** The subset a composer may offer as a chip. */
export function attachableMarks(json: any): Mark[] {
  return marksOf(json).filter((m) => m.attachable);
}

/**
 * The kit's one canonical mark: the entry tagged `primary` when there is one,
 * else the first in stored order. Every surface that asks "which is THE logo"
 * goes through here, so re-tagging a mark moves the answer everywhere at once
 * instead of the nav and Settings disagreeing about it.
 */
export function primaryOf(marks: Mark[]): Mark | null {
  return marks.find((m) => m.role === 'primary') ?? marks[0] ?? null;
}

/** The canonical mark straight from a brand document. */
export function primaryMark(json: any): Mark | null {
  return primaryOf(marksOf(json));
}

/**
 * The kit's small square form: the entry tagged `mark`, else the canonical one.
 *
 * `primaryMark` answers "which is THE logo", and a logo is whatever shape the
 * brand draws it. LEGO's is a wordmark five times wider than it is tall, which
 * is correct and unusable in a 22px circle: scaled to fit, it is three
 * illegible pixels of red. The site's own icon is stored as `mark` for exactly
 * this, so any surface that needs a square asks here, and a brand that has no
 * icon falls back to its logo rather than to nothing.
 */
export function iconMark(json: any): Mark | null {
  const marks = marksOf(json);
  return marks.find((m) => m.role === 'mark') ?? primaryOf(marks);
}

/**
 * What a small circle draws for a brand. A circle needs a square, so the kit's
 * own icon leads (a site's favicon, stored as `mark`) and counts as square because
 * the kit says it is. Without one the canonical logo is put on trial: `square:
 * false` means measure it before drawing it. A declared wordmark is never tried,
 * being wider than any circle by definition. Only stored assets qualify, since a
 * bare URL has no small derivative to draw.
 */
export function avatarMark(json: any): { mark: Mark; square: boolean } | null {
  const stored = marksOf(json).filter((m) => m.hash);
  const icon = stored.find((m) => m.role === 'mark');
  if (icon) return { mark: icon, square: true };
  const logo = primaryOf(stored);
  if (!logo || logo.role === 'wordmark') return null;
  return { mark: logo, square: false };
}

/** Wider than this, a logo is a few illegible pixels in a circle, and the initial says more. */
export const CIRCLE_MAX_RATIO = 1.6;
export const fitsCircle = (width: number, height: number): boolean => height > 0 && width / height <= CIRCLE_MAX_RATIO;

/**
 * Where to look to tell a full-bleed icon from a logo on transparency: the middle
 * of each edge, and a point just inside each corner. Inside, not on, because an
 * app icon's rounded corners are transparent while everything a circle would
 * show of it is solid.
 */
export function bleedPoints(width: number, height: number): [number, number][] {
  const at = (f: number, size: number) => Math.min(size - 1, Math.max(0, Math.round(f * (size - 1))));
  const edge = 0.03;
  const corner = 0.12;
  return [
    [at(0.5, width), at(edge, height)],
    [at(0.5, width), at(1 - edge, height)],
    [at(edge, width), at(0.5, height)],
    [at(1 - edge, width), at(0.5, height)],
    [at(corner, width), at(corner, height)],
    [at(1 - corner, width), at(corner, height)],
    [at(corner, width), at(1 - corner, height)],
    [at(1 - corner, width), at(1 - corner, height)],
  ];
}

/**
 * Solid at every point that looks: the icon is its own ground (a white swoosh on
 * black, say) and should fill the circle, where a logo on transparency needs the
 * white plate behind it. Alpha 0 to 255.
 */
export const isFullBleed = (alphas: number[]): boolean => alphas.length > 0 && alphas.every((a) => a >= 200);

/** Display name for one mark, e.g. "Acme Coffee wordmark". Matches the compiler's label. */
export function markLabel(json: any, mark: Pick<Mark, 'role'>): string {
  const kind: Record<MarkRole, string> = {
    primary: 'logo',
    mark: 'mark',
    wordmark: 'wordmark',
    monochrome: 'monochrome logo',
    alternate: 'alternate logo',
  };
  const name = String(json?.meta?.name ?? '').trim();
  return name ? `${name} ${kind[mark.role]}` : `Brand ${kind[mark.role]}`;
}
