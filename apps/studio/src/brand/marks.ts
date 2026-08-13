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
